-- =============================================================================
-- ALTECH SCHOOL — PHASE 2 — OPÉRATIONS TRANSACTIONNELLES (RPC)
-- =============================================================================
-- ⚠️  À APPLIQUER MANUELLEMENT, puis à activer côté app UNIQUEMENT via les
--     drapeaux (lib/featureFlags.ts). Tant qu'un drapeau est à false, c'est le
--     miroir Zustand actuel qui écrit : JAMAIS les deux à la fois pour la même
--     opération (pas de double écriture).
--
-- PRINCIPE DE FIDÉLITÉ FINANCIÈRE
-- -------------------------------
-- Ces fonctions NE RECALCULENT AUCUNE FORMULE. Le client calcule déjà le
-- versement et le mouvement de caisse (règles métier inchangées) et les passe
-- en JSONB, colonnes snake_case (exactement ce que produit `toRow`). La RPC se
-- contente de les COMMITTER ENSEMBLE, de façon atomique, idempotente et
-- autorisée. Le gain : plus de « versement enregistré mais caisse perdue » (ou
-- l'inverse) si le réseau coupe au milieu.
--
-- Idempotent à l'installation (create or replace / if not exists).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. JOURNAL D'IDEMPOTENCE — un envoi rejoué ne s'applique qu'une fois
-- -----------------------------------------------------------------------------
create table if not exists public.operation_log (
  idempotency_key text primary key,
  operation       text        not null,
  actor           text,
  result          jsonb,
  created_at      timestamptz not null default now()
);

alter table public.operation_log enable row level security;
-- Seul le personnel lit le journal ; l'écriture passe par les RPC SECURITY DEFINER.
drop policy if exists operation_log_read on public.operation_log;
create policy operation_log_read on public.operation_log
  for select to authenticated using ((select public.is_staff()));


-- -----------------------------------------------------------------------------
-- 1. ENCAISSEMENT DE SCOLARITÉ — payment + mouvement de caisse, EN UNE TRANSACTION
-- -----------------------------------------------------------------------------
-- Entrées :
--   p_payment : la ligne `payments` complète (colonnes snake_case), déjà calculée.
--   p_cash    : la ligne `cash_transactions` correspondante (ou NULL si aucune).
--   p_idempotency_key : clé unique de l'opération (ex. l'id du versement).
-- Sorties : jsonb { payment, cash } tel qu'enregistré (lignes autoritatives).
create or replace function public.record_tuition_payment(
  p_payment          jsonb,
  p_cash             jsonb,
  p_idempotency_key  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student   text;
  v_prev      jsonb;
  v_payment   public.payments;
  v_cash      public.cash_transactions;
  v_result    jsonb;
begin
  -- Autorisation : seul le personnel encaisse.
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Idempotence : un rejeu (retry après timeout) renvoie le résultat initial.
  select result into v_prev from public.operation_log
    where idempotency_key = p_idempotency_key;
  if found then
    return v_prev;
  end if;

  -- Validation minimale (sans toucher aux formules).
  v_student := p_payment->>'student_id';
  if v_student is null then
    raise exception 'INVALID_INPUT: student_id manquant' using errcode = '22000';
  end if;
  if coalesce((p_payment->>'amount_paid')::numeric, 0) < 0 then
    raise exception 'INVALID_INPUT: amount_paid négatif' using errcode = '22000';
  end if;

  -- Verrou par élève : sérialise les encaissements concurrents du même élève,
  -- donc pas de double-crédit si deux postes saisissent en même temps.
  perform 1 from public.students where id = v_student for update;
  if not found then
    raise exception 'STUDENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Écritures atomiques.
  insert into public.payments
    select * from jsonb_populate_record(null::public.payments, p_payment)
    returning * into v_payment;

  if p_cash is not null and p_cash <> 'null'::jsonb then
    insert into public.cash_transactions
      select * from jsonb_populate_record(null::public.cash_transactions, p_cash)
      returning * into v_cash;
  end if;

  v_result := jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'cash',    case when v_cash.id is not null then to_jsonb(v_cash) else null end
  );

  insert into public.operation_log(idempotency_key, operation, actor, result)
    values (p_idempotency_key, 'record_tuition_payment', auth.uid()::text, v_result);

  return v_result;
end;
$$;

revoke all on function public.record_tuition_payment(jsonb, jsonb, text) from public;
grant execute on function public.record_tuition_payment(jsonb, jsonb, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. ANNULATION DE VERSEMENT — retire le versement ET son mouvement de caisse
-- -----------------------------------------------------------------------------
-- La caisse ne stocke pas d'`payment_id` : le client fournit les deux ids, et
-- la RPC les supprime ENSEMBLE. Idempotent (rejouer ne casse rien).
create or replace function public.reverse_payment(
  p_payment_id       text,
  p_cash_id          text,
  p_idempotency_key  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev    jsonb;
  v_student text;
  v_result  jsonb;
begin
  if not public.is_staff() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select result into v_prev from public.operation_log
    where idempotency_key = p_idempotency_key;
  if found then
    return v_prev;
  end if;

  -- Verrou par élève concerné (si le versement existe encore).
  select student_id into v_student from public.payments where id = p_payment_id;
  if v_student is not null then
    perform 1 from public.students where id = v_student for update;
  end if;

  delete from public.payments where id = p_payment_id;
  if p_cash_id is not null then
    delete from public.cash_transactions where id = p_cash_id;
  end if;

  v_result := jsonb_build_object(
    'reversed_payment', p_payment_id,
    'reversed_cash',    p_cash_id
  );

  insert into public.operation_log(idempotency_key, operation, actor, result)
    values (p_idempotency_key, 'reverse_payment', auth.uid()::text, v_result);

  return v_result;
end;
$$;

revoke all on function public.reverse_payment(text, text, text) from public;
grant execute on function public.reverse_payment(text, text, text) to authenticated;

commit;


-- =============================================================================
-- VÉRIFICATION (lecture seule)
-- =============================================================================
-- Les deux fonctions existent, SECURITY DEFINER, search_path fixé :
select proname, prosecdef, array_to_string(proconfig, ', ') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('record_tuition_payment','reverse_payment');
-- Attendu : prosecdef = true, config contient search_path=public.

-- Test manuel d'idempotence (sur STAGING, jamais en prod) :
--   select public.record_tuition_payment('{"id":"pay_test","student_id":"<id>","amount_paid":100}'::jsonb,
--                                         '{"id":"csh_test","type":"student_payment","amount":100}'::jsonb,
--                                         'test-key-1');
--   -- Rejouer avec la MÊME clé : doit renvoyer le même résultat, sans 2e insert.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop function if exists public.record_tuition_payment(jsonb, jsonb, text);
-- drop function if exists public.reverse_payment(text, text, text);
-- -- Ne PAS supprimer operation_log si d'autres opérations l'utilisent.
-- -- drop table if exists public.operation_log;
