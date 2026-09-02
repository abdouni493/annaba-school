"use client";

/**
 * CRÉER OU MODIFIER UN TRAVAILLEUR — tout se règle sur ce seul écran.
 *
 * Trois choses s'y font qui demandaient auparavant du code ou un autre écran :
 *
 *  1. LE MÉTIER SE CRÉE ICI. Il n'y avait que « réception », « sécurité » et
 *     « ménage » : le chauffeur, le cuisinier ou le surveillant n'existaient
 *     pas. On les ajoute — et on les retire — sans quitter le formulaire.
 *
 *  2. LE COMPTE DE CONNEXION S'ACTIVE EXPLICITEMENT. Il n'apparaissait avant
 *     que parce qu'un email avait été tapé. On dit maintenant OUI ou NON, et
 *     l'email, le nom d'utilisateur et le mot de passe ne sont demandés que si
 *     la réponse est oui.
 *
 *  3. AUCUN DROIT N'EST DONNÉ D'OFFICE. Un travailleur créé ici ne voit rien
 *     du tout : c'est le bouton « Droits d'accès » de sa carte qui ouvre ses
 *     écrans et ses boutons, un par un.
 */

import { useMemo, useState } from "react";
import { Briefcase, KeyRound, Plus, Scan, ShieldAlert, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { useData, uid } from "@/lib/store/data";
import {
  accountIdForEntity,
  createAccountForEntity,
  deleteRoleUser,
  resetUserPassword,
  updateUserEmail,
  updateUsername,
} from "@/lib/accounts/users";
import type { Day, ReceptionPaymentType, ReceptionStaff } from "@/lib/types";
import { DAYS } from "@/lib/types";
import { DAY_LABELS_FR } from "@/lib/helpers";
import { WORKER_PAYMENT_LABELS } from "@/lib/workers";

const CONTRACTS: ReceptionPaymentType[] = ["monthly", "daily", "half_day", "hourly"];

export function WorkerFormModal({
  worker,
  canManageRoles,
  canManageAccount,
  onClose,
  onSaved,
}: {
  /** absent = création */
  worker?: ReceptionStaff | null;
  canManageRoles: boolean;
  canManageAccount: boolean;
  onClose: () => void;
  onSaved: (worker: ReceptionStaff, created: boolean) => void;
}) {
  const { reception, workerRoles, push, updateItem, deleteFrom } = useData();
  const editing = !!worker;

  const [firstName, setFirstName] = useState(worker?.firstName ?? "");
  const [lastName, setLastName] = useState(worker?.lastName ?? "");
  const [phone, setPhone] = useState(worker?.phone ?? "");
  // « Aucun métier choisi » et « le métier vide » ne sont pas la même chose :
  // `null` veut dire que la réception n'a pas tranché, et le formulaire propose
  // alors le premier métier de la liste — y compris celui qu'elle vient de
  // créer, sans qu'un effet ait à le poser après coup.
  const [rolePick, setRolePick] = useState<string | null>(worker?.role ?? null);
  const role = rolePick ?? workerRoles[0]?.id ?? "";
  const setRole = (id: string) => setRolePick(id);
  const [rfid, setRfid] = useState(worker?.rfid ?? "");
  const [paymentType, setPaymentType] = useState<ReceptionPaymentType>(
    worker?.paymentType ?? "monthly",
  );
  const [salary, setSalary] = useState<number>(worker?.salary ?? 0);
  const [hourlyRate, setHourlyRate] = useState<number>(worker?.hourlyRate ?? 0);
  // Les jours de la semaine où il travaille — pour un mensuel, un journalier ou
  // un demi-journalier. Un contrat horaire, lui, est réglé sur ses pointages.
  const [workDays, setWorkDays] = useState<Day[]>(worker?.workDays ?? []);
  const toggleWorkDay = (d: Day) =>
    setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const [startDate, setStartDate] = useState(
    worker?.startDate || new Date().toLocaleDateString("fr-CA"),
  );

  // ---- compte de connexion --------------------------------------------------
  const [hasAccount, setHasAccount] = useState<boolean>(worker?.hasAccount ?? false);
  const [email, setEmail] = useState(worker?.email ?? "");
  const [username, setUsername] = useState(worker?.username ?? "");
  const [password, setPassword] = useState("");

  // ---- métiers, gérés sur place --------------------------------------------
  const [rolesOpen, setRolesOpen] = useState(false);
  const [newRole, setNewRole] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Combien de fiches portent ce métier — supprimer n'est pas anodin. */
  const roleUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of reception) {
      if (!w.role) continue;
      counts.set(w.role, (counts.get(w.role) ?? 0) + 1);
    }
    return counts;
  }, [reception]);

  const addRole = () => {
    const name = newRole.trim();
    if (!name) return;
    if (workerRoles.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      setError(`Le métier « ${name} » existe déjà.`);
      return;
    }
    const id = uid("wrole");
    push("workerRoles", { id, name, createdAt: new Date().toISOString() });
    setRole(id);
    setNewRole("");
    setError(null);
  };

  const removeRole = (id: string) => {
    const used = roleUsage.get(id) ?? 0;
    const name = workerRoles.find((r) => r.id === id)?.name ?? id;
    if (used > 0) {
      const ok = confirm(
        `${used} travailleur(s) portent le métier « ${name} ». ` +
          `Le supprimer les laissera sans métier — leur fiche, leur paie et leur historique ne bougent pas. Continuer ?`,
      );
      if (!ok) return;
    }
    deleteFrom("workerRoles", id);
    if (role === id) setRole("");
  };

  // ---- enregistrement -------------------------------------------------------

  const submit = async () => {
    setError(null);
    if (!firstName.trim() && !lastName.trim()) {
      setError("Indiquez au moins un nom ou un prénom.");
      return;
    }

    const mail = email.trim().toLowerCase();
    if (hasAccount) {
      if (!mail) {
        setError("Un compte de connexion demande un email.");
        return;
      }
      if (!editing || !worker?.hasAccount) {
        if (password.length < 6) {
          setError("Le mot de passe doit contenir au moins 6 caractères.");
          return;
        }
      } else if (password && password.length < 6) {
        setError("Le nouveau mot de passe doit contenir au moins 6 caractères.");
        return;
      }
    }

    const fields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: hasAccount ? mail : "",
      role: role || undefined,
      rfid: rfid.trim() || undefined,
      paymentType,
      salary: paymentType === "hourly" ? 0 : Math.max(0, salary),
      hourlyRate: paymentType === "hourly" ? Math.max(0, hourlyRate) : undefined,
      // Les jours travaillés ne concernent pas un contrat horaire (piloté par le
      // pointage) ; ailleurs, une liste vide veut dire « tous les jours ».
      workDays: paymentType === "hourly" || workDays.length === 0 ? undefined : workDays,
      startDate,
      hasAccount,
      username: hasAccount ? username.trim() || mail : undefined,
    };

    setBusy(true);
    try {
      if (!editing) {
        // La fiche porte SON identifiant, que le compte existe ou non : c'est lui
        // que ses pointages, ses acomptes et ses règlements suivront, et il ne
        // bougera plus jamais — même le jour où on lui ouvrira un accès.
        const id = uid("wrk");
        if (hasAccount) {
          await createAccountForEntity(id, {
            role: "reception",
            email: mail,
            password,
            firstName: fields.firstName,
            lastName: fields.lastName,
            username: fields.username,
          });
        }
        const row: ReceptionStaff = {
          id,
          ...fields,
          // Un travailleur naît SANS AUCUN DROIT. Le tableau vide le dit
          // explicitement — c'est ce qui le distingue d'une fiche ancienne, qui
          // n'a jamais été réglée et garde l'ancien menu de la réception.
          navKeys: [],
          actionKeys: [],
          createdAt: new Date().toISOString(),
        };
        push("reception", row);
        onSaved(row, true);
        return;
      }

      // ---- modification -----------------------------------------------------
      const before = worker!;
      const accountId = before.hasAccount ? await accountIdForEntity(before.id) : null;

      if (hasAccount && !before.hasAccount) {
        await createAccountForEntity(before.id, {
          role: "reception",
          email: mail,
          password,
          firstName: fields.firstName,
          lastName: fields.lastName,
          username: fields.username,
        });
      } else if (!hasAccount && before.hasAccount) {
        if (accountId) await deleteRoleUser(accountId);
      } else if (hasAccount && accountId) {
        if (mail && mail !== before.email) await updateUserEmail(accountId, mail);
        if (password) await resetUserPassword(accountId, password);
        if (fields.username && fields.username !== before.username) {
          await updateUsername(accountId, fields.username);
        }
      }

      updateItem("reception", before.id, fields);
      onSaved({ ...before, ...fields }, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={editing ? "Modifier le travailleur" : "Créer un travailleur"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Enregistrement…" : editing ? "Enregistrer" : "Créer le travailleur"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-[11px] leading-relaxed text-danger">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---- identité ---------------------------------------------------- */}
        <section className="space-y-3 rounded-2xl border border-line bg-canvas/30 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Identité</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Prénom">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
            </Field>
            <Field label="Nom">
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
            </Field>
            <Field label="Téléphone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+213 XXXXXXXXX" />
            </Field>
            <Field label="Carte RFID (badge de pointage)" hint="Obligatoire pour le pointage horaire.">
              <div className="relative">
                <Scan className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={rfid}
                  onChange={(e) => setRfid(e.target.value)}
                  placeholder="Passez la carte devant le lecteur…"
                  className="pl-9 font-mono"
                />
              </div>
            </Field>
          </div>
        </section>

        {/* ---- métier ------------------------------------------------------ */}
        <section className="space-y-3 rounded-2xl border border-line bg-canvas/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <Briefcase className="h-3.5 w-3.5" /> Métier
            </h3>
            {canManageRoles && (
              <button
                onClick={() => setRolesOpen(!rolesOpen)}
                className="rounded-lg border border-line px-2.5 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary-50"
              >
                {rolesOpen ? "Fermer la gestion des métiers" : "Créer / supprimer un métier"}
              </button>
            )}
          </div>

          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-full">
            <option value="">— Sans métier —</option>
            {workerRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>

          {canManageRoles && rolesOpen && (
            <div className="space-y-2 rounded-xl border border-primary/25 bg-primary-50/40 p-3">
              <p className="text-[10px] leading-relaxed text-muted">
                Les métiers appartiennent à l&apos;école : ajoutez un chauffeur, un cuisinier, un
                surveillant. Supprimer un métier laisse les fiches qui le portaient sans métier —
                leur paie et leur historique ne bougent pas.
              </p>
              <div className="flex gap-2">
                <Input
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRole();
                    }
                  }}
                  placeholder="Nom du nouveau métier — ex. Chauffeur"
                />
                <Button size="sm" onClick={addRole} className="shrink-0 gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {workerRoles.length === 0 ? (
                  <span className="text-[10px] italic text-muted">Aucun métier pour l&apos;instant.</span>
                ) : (
                  workerRoles.map((r) => (
                    <span
                      key={r.id}
                      className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-ink"
                    >
                      {r.name}
                      <span className="font-mono text-[9px] font-normal text-muted">
                        {roleUsage.get(r.id) ?? 0}
                      </span>
                      <button
                        onClick={() => removeRole(r.id)}
                        title={`Supprimer le métier « ${r.name} »`}
                        className="text-danger transition-colors hover:text-danger/70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {/* ---- contrat ----------------------------------------------------- */}
        <section className="space-y-3 rounded-2xl border border-line bg-canvas/30 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Contrat</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Type de rémunération">
              <Select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as ReceptionPaymentType)}
                className="w-full"
              >
                {CONTRACTS.map((c) => (
                  <option key={c} value={c}>
                    {WORKER_PAYMENT_LABELS[c]}
                    {c === "hourly" ? " (pointage arrivée / sortie)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {paymentType === "hourly" ? (
              <Field label="Prix d'une heure (DA)">
                <Input
                  type="number"
                  min={0}
                  value={hourlyRate || ""}
                  onChange={(e) => setHourlyRate(Number(e.target.value))}
                  placeholder="Ex : 400"
                />
              </Field>
            ) : (
              <Field label={`Salaire par ${WORKER_PAYMENT_LABELS[paymentType].toLowerCase()} (DA)`}>
                <Input
                  type="number"
                  min={0}
                  value={salary || ""}
                  onChange={(e) => setSalary(Number(e.target.value))}
                  placeholder="Ex : 35000"
                />
              </Field>
            )}
            <Field
              label="Date de début de travail"
              hint="C'est de ce jour que partent les périodes dues."
            >
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          </div>

          {/* Les jours travaillés — un mensuel, un journalier ou un demi-journalier
              ne vient pas sept jours sur sept. Sans ce réglage, l'écran de
              règlement comptait tous les jours comme dus (vendredis compris). */}
          {paymentType !== "hourly" && (
            <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                  Jours de travail dans la semaine
                </span>
                <span className="text-[10px] text-muted">
                  {workDays.length === 0
                    ? "Aucun jour choisi → tous les jours sont comptés"
                    : `${workDays.length} jour(s) sélectionné(s)`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = workDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleWorkDay(d)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        on
                          ? "border-primary bg-primary text-white"
                          : "border-line bg-canvas text-muted hover:border-primary/40 hover:text-ink"
                      }`}
                    >
                      {DAY_LABELS_FR[d]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] leading-snug text-muted">
                {paymentType === "monthly"
                  ? "Le salaire mensuel reste dû par mois entier ; ces jours servent de repère pour son emploi du temps."
                  : "Seules les journées de ces jours-là seront dues au règlement. Un jour de repos n'est jamais compté comme une journée non payée."}
              </p>
            </div>
          )}
        </section>

        {/* ---- compte de connexion ----------------------------------------- */}
        <section className="space-y-3 rounded-2xl border border-line bg-canvas/30 p-3">
          <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            <KeyRound className="h-3.5 w-3.5" /> Compte de connexion
          </h3>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              hasAccount ? "border-success/40 bg-success/5" : "border-line bg-surface"
            } ${canManageAccount ? "" : "pointer-events-none opacity-60"}`}
          >
            <input
              type="checkbox"
              checked={hasAccount}
              disabled={!canManageAccount}
              onChange={(e) => setHasAccount(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-ink">
                Activer un accès à l&apos;application
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                Sans accès, ce travailleur est une fiche, un salaire et un badge — il ne se
                connecte pas. Avec un accès, il ne verra QUE ce que vous cocherez ensuite dans
                « Droits d&apos;accès » : rien n&apos;est ouvert d&apos;office.
              </span>
            </span>
          </label>

          {hasAccount && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Email (identifiant de connexion) *">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom@ecole.com"
                  autoComplete="off"
                />
              </Field>
              <Field label="Nom d'utilisateur" hint="L'email quand il est laissé vide.">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex. karim.reception"
                  autoComplete="off"
                />
              </Field>
              <Field
                label={
                  editing && worker?.hasAccount ? "Nouveau mot de passe" : "Mot de passe *"
                }
                hint={
                  editing && worker?.hasAccount
                    ? "Laissez vide pour ne pas le changer."
                    : "6 caractères au minimum."
                }
              >
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="new-password"
                />
              </Field>
            </div>
          )}

          {editing && worker?.hasAccount && !hasAccount && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-[11px] leading-relaxed text-danger">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                En enregistrant, le compte de connexion sera <strong>supprimé</strong> : ce
                travailleur ne pourra plus ouvrir l&apos;application. Sa fiche, ses pointages et
                son historique restent intacts.
              </span>
            </div>
          )}

          {!editing && hasAccount && (
            <div className="rounded-xl border border-line bg-surface p-2.5 text-[10px] leading-relaxed text-muted">
              <Badge tone="warning" className="mr-1.5 text-[9px]">
                À faire ensuite
              </Badge>
              Le compte sera créé <strong>sans aucun droit</strong>. Ouvrez « Droits d&apos;accès »
              sur sa carte pour choisir ses écrans et ses boutons.
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[9px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}
