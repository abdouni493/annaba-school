"use client";

/**
 * IMPRIMER LE REÇU D'UN ANCIEN VERSEMENT — depuis le tableau de bord.
 *
 * Deux temps, et deux seulement :
 *  1. la réception CHERCHE l'élève (nom, prénom, téléphone, e-mail ou numéro
 *     d'inscription) et le CHOISIT ;
 *  2. l'écran affiche alors TOUS ses versements, du plus récent au plus
 *     ancien, chacun sous SON NOM — le nom du frais réglé, ou celui de
 *     l'emploi du temps crédité, exactement celui que le reçu imprimera.
 *
 * Un clic sur la ligne sort le papier de l'école, celui-là même qui sort au
 * moment de l'encaissement, mais qui ne dit ici que CE QUE L'ÉLÈVE A VERSÉ ce
 * jour-là (jamais un solde, qui n'est plus celui du jour du paiement).
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Hash,
  Phone,
  Printer,
  Receipt,
  Search,
  User,
  Wallet,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { Badge, type Tone } from "@/components/ui/Badge";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import {
  formatDateFr,
  paymentName,
  receiptNumberOf,
  registrationNumberOf,
  studentMatches,
  studentName,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { paymentReceiptHtml } from "@/lib/reports/documents";
import type { Payment, PaymentSource, Student } from "@/lib/types";

/** Combien de fiches on propose au plus : au-delà, on affine la recherche. */
const MAX_RESULTS = 40;
/** À partir de combien de versements la liste mérite son propre filtre. */
const FILTER_FROM = 6;

/** D'où venait l'argent — dit en un mot sur la ligne du versement. */
const SOURCE_LABEL: Record<PaymentSource, string> = {
  cash: "Caisse",
  teacher_salary: "Retenu sur salaire",
  teacher_debt: "Porté sur salaire",
  school_cash: "Avancé par l'école",
};

export function StudentPaymentsPrintModal({ onClose }: { onClose: () => void }) {
  const db = useData();
  const { language } = useSettings();
  const { addToast } = useToast();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [payQuery, setPayQuery] = useState("");

  // Les élèves qui répondent à la recherche : nom, prénom, téléphone, second
  // téléphone, numéro d'inscription — et l'e-mail, comme sur l'écran Élèves.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Student[];
    return db.students
      .filter(
        (s) =>
          studentMatches(db, s, query) || (s.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, db.students]);

  /** La nature du versement, dite par une pastille. */
  const kindOf = (p: Payment): { label: string; tone: Tone } =>
    p.chargeId
      ? { label: "Frais", tone: "warning" }
      : p.type === "debt_payment"
        ? { label: "Règlement de dette", tone: "success" }
        : { label: "Achat de séances", tone: "primary" };

  // Tout l'historique de l'élève, du plus récent au plus ancien, chaque
  // versement portant déjà son nom et son numéro de reçu.
  const payments = useMemo(() => {
    if (!selected) return [];
    return db.payments
      .filter((p) => p.studentId === selected.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => ({
        payment: p,
        // Le nom du versement vient du même endroit que celui du reçu.
        name: paymentName(db, p),
        kind: kindOf(p),
        receipt: receiptNumberOf(db, p.id),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, db.payments, db.enrollments, db.subscriptions, db.studentCharges]);

  // Le filtre de la liste : par nom de versement, mois, date, montant ou
  // numéro de reçu — la réception cherche rarement deux fois la même chose.
  const shown = useMemo(() => {
    const q = payQuery.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((row) =>
      [
        row.name,
        row.kind.label,
        row.receipt,
        row.payment.monthCode ?? "",
        row.payment.description ?? "",
        formatDateFr(row.payment.date.substring(0, 10)),
        String(row.payment.amountPaid),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [payments, payQuery]);

  const totalPaid = payments.reduce((s, r) => s + r.payment.amountPaid, 0);

  const pickStudent = (s: Student) => {
    setSelected(s);
    setPayQuery("");
  };

  const printReceipt = (p: Payment) => {
    try {
      printHtmlDocument(paymentReceiptHtml(db, { payment: p, language }));
    } catch {
      addToast({
        type: "danger",
        title: "Impression impossible",
        message: "Ce versement ne porte sur aucun élève connu.",
      });
    }
  };

  return (
    <Modal open onClose={onClose} wide title="Imprimer un ancien paiement">
      {!selected ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            <strong className="text-ink">1.</strong> Cherchez l&apos;élève par nom, prénom,
            téléphone, e-mail ou numéro d&apos;inscription et choisissez-le —{" "}
            <strong className="text-ink">2.</strong> tous ses versements s&apos;affichent alors,
            chacun sous son nom, prêts à réimprimer.
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Entrée choisit le premier résultat : au comptoir, on tape et
                // on valide sans lâcher le clavier.
                if (e.key === "Enter" && results.length > 0) {
                  e.preventDefault();
                  pickStudent(results[0]);
                }
              }}
              placeholder="Nom, téléphone, e-mail, N° d'inscription…"
              className="pl-9"
            />
          </div>

          {query.trim().length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Tapez quelque chose pour rechercher un élève.
            </p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Aucun élève ne correspond à cette recherche.
            </p>
          ) : (
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
              {results.map((s, i) => {
                const count = db.payments.filter((p) => p.studentId === s.id).length;
                return (
                  <button
                    key={s.id}
                    onClick={() => pickStudent(s)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-canvas/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-50/40 ${
                      i === 0 ? "border-primary/40 ring-2 ring-primary/20" : "border-line"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary">
                        <User className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-ink">
                          {studentName(s)}
                        </strong>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Hash className="h-2.5 w-2.5" />
                            {registrationNumberOf(db, s)}
                          </span>
                          {s.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-2.5 w-2.5" />
                              {s.phone}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <Badge
                      tone={count > 0 ? "primary" : "neutral"}
                      className="shrink-0 text-[10px]"
                    >
                      {count} versement(s)
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-primary-50 hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Changer d&apos;élève
            </button>
            <span className="flex flex-col items-end">
              <strong className="text-sm text-ink">{studentName(selected)}</strong>
              <span className="font-mono text-[10px] text-muted">
                N° {registrationNumberOf(db, selected)}
              </span>
            </span>
          </div>

          {/* Ce que l'élève a versé en tout : la question qui suit toujours la
              réimpression d'un reçu. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              {payments.length} versement(s)
            </span>
            <strong className="text-sm text-success">{formatDA(totalPaid)} encaissés</strong>
          </div>

          {payments.length > FILTER_FROM && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                autoFocus
                value={payQuery}
                onChange={(e) => setPayQuery(e.target.value)}
                placeholder="Filtrer : nom du versement, mois, date, montant, N° de reçu…"
                className="pl-9"
              />
            </div>
          )}

          <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {payments.length === 0 ? (
              <p className="py-8 text-center text-xs italic text-muted">
                Cet élève n&apos;a aucun versement enregistré.
              </p>
            ) : shown.length === 0 ? (
              <p className="py-8 text-center text-xs italic text-muted">
                Aucun versement ne correspond à ce filtre.
              </p>
            ) : (
              shown.map(({ payment: p, name, kind, receipt }) => (
                // La ligne entière imprime : au comptoir, viser une icône de
                // 32 pixels fait perdre le client de vue.
                <button
                  key={p.id}
                  onClick={() => printReceipt(p)}
                  title={`Imprimer le reçu N° ${receipt} — ${name}`}
                  className="group flex w-full items-start justify-between gap-3 rounded-xl border border-line bg-canvas/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-50/40"
                >
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={kind.tone} className="px-1.5 py-0 text-[9px]">
                        {kind.label}
                      </Badge>
                      <span className="font-mono text-[9px] text-muted">Reçu N° {receipt}</span>
                    </span>
                    {/* LE NOM DU VERSEMENT — ce que la réception lit d'abord. */}
                    <strong className="block truncate text-sm text-ink">{name}</strong>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                      <span className="font-mono">
                        {formatDateFr(p.date.substring(0, 10))}
                        {p.date.substring(11, 16) ? ` · ${p.date.substring(11, 16)}` : ""}
                      </span>
                      {p.monthCode && <span>Mois {p.monthCode}</span>}
                      <span>{SOURCE_LABEL[p.paidFrom ?? "cash"]}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <strong className="font-bold text-success">+{formatDA(p.amountPaid)}</strong>
                    {p.rest > 0 && (
                      <span className="text-[10px] font-semibold text-danger">
                        reste {formatDA(p.rest)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10px] font-bold text-primary transition-colors group-hover:bg-primary-50">
                      <Printer className="h-3.5 w-3.5" /> Imprimer
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <p className="flex items-center gap-1.5 border-t border-line pt-3 text-[10px] text-muted">
            <Receipt className="h-3.5 w-3.5" /> Le reçu réimprimé ne montre que le montant versé ce
            jour-là, jamais un solde.
          </p>
        </div>
      )}
    </Modal>
  );
}
