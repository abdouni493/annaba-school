"use client";

/**
 * « Situation d'un élève » — la question que la réception pose vingt fois par
 * jour, en trois clics et sans quitter son écran.
 *
 *   on cherche l'élève (nom, n° d'inscription ou téléphone)
 *      -> UN SEUL GRAND TABLEAU, lu comme la feuille de présence d'un groupe :
 *         une ligne par emploi du temps — ceux qu'il suit ET ceux qu'il a
 *         quittés — avec ses séances du mois, ce qu'il a versé, ce qui reste dû,
 *         ce qu'il traîne des mois précédents et le solde de cet emploi ;
 *      -> on encaisse sur place, sur la ligne concernée, avec son reçu ;
 *      -> on remonte les mois d'un bouton pour lire — et régler — un mois passé.
 *
 * Le navigateur de mois travaille en DÉCALAGE, pas en numéro : « mois en cours »
 * puis « 1 mois avant ». Deux emplois du temps ne vivent pas le même mois au
 * même moment (l'un en est à son M5, l'autre à son M2), et afficher « M2 » pour
 * les deux mentirait sur l'un des deux.
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/SearchInput";
import { PrintAsk } from "@/components/attendance/PresenceSheet";
import { soldReceiptHtml } from "@/lib/reports/documents";
import { formatDA } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Search,
  UserMinus,
  Wallet,
} from "lucide-react";
import type { AttendanceRecord, AttendanceStatus, Student } from "@/lib/types";
import {
  currentCycleIndex,
  cycleLead,
  cycleOf,
  cycleSizeOf,
  cycleSlots,
  formatDateFr,
  formatDays,
  groupName,
  moduleName as moduleNameOf,
  monthCodeLabel,
  registrationNumberOf,
  salleName,
  sessionSalleOn,
  sessionTimeLabel,
  soldFor,
  studentCaseLabel,
  studentCaseTone,
  studentListPrice,
  studentMatches,
  studentName,
  studentSubscriptionHistory,
  teacherName,
  unsubscribedAtOf,
} from "@/lib/helpers";

const STATUS_LABEL: Record<AttendanceStatus, { short: string; label: string; cls: string }> = {
  present: { short: "P", label: "Présent", cls: "bg-success/15 text-success border-success/40" },
  late: { short: "R", label: "Retard", cls: "bg-warning/15 text-warning border-warning/40" },
  absent: { short: "A", label: "Absent", cls: "bg-danger/15 text-danger border-danger/40" },
  cancelled: { short: "×", label: "Annulée", cls: "bg-primary/15 text-primary border-primary/40" },
};

/** Une ligne du tableau : UN emploi du temps de l'élève, sur le mois affiché. */
interface SituationRow {
  subId: string;
  sessionId: string;
  label: string;
  groupName: string;
  salleName: string;
  teacherName: string;
  daysLabel: string;
  timeLabel: string;
  active: boolean;
  leftOn?: string;
  /** le mois de CET emploi qui correspond au décalage choisi */
  code: string;
  index: number;
  currentIndex: number;
  size: number;
  lead: number;
  slots: AttendanceRecord[];
  unitPrice: number;
  done: number;
  presents: number;
  absents: number;
  cancelled: number;
  consumed: number;
  credited: number;
  /** ce qu'il doit encore sur CE mois */
  due: number;
  /** ce qu'il a d'avance sur ce mois */
  advance: number;
  complete: boolean;
  /** ce que les mois PRÉCÉDENTS de cet emploi doivent encore */
  previousDue: number;
  /** le solde de l'emploi, tous mois confondus */
  balance: number;
}

/** Ce que la modale d'encaissement porte le temps de la saisie. */
interface PayTarget {
  subId: string;
  label: string;
  monthCode: string;
  amount: number;
  suggestion: number;
  description?: string;
}

export function StudentSituationModal({ onClose }: { onClose: () => void }) {
  const db = useData();
  const { addSold } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [query, setQuery] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  /** 0 = le mois en cours de chaque emploi, 1 = celui d'avant, etc. */
  const [back, setBack] = useState(0);
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as Student[];
    return db.students
      .filter((st) => studentMatches(db, st, q))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.students, query]);

  /** Tous ses emplois du temps — actuels ET quittés — sur le mois affiché. */
  const rows = useMemo<SituationRow[]>(() => {
    if (!student) return [];
    return studentSubscriptionHistory(db, student).map((subId) => {
      const sub = db.subscriptions.find((x) => x.id === subId)!;
      const session = db.sessions.find((x) => x.id === sub.sessionId);
      const currentIndex = currentCycleIndex(db, student.id, subId);
      // Le décalage ne descend jamais sous le premier mois de l'emploi.
      const index = Math.max(0, currentIndex - back);
      const code = `M${index + 1}`;
      const cycle = cycleOf(db, student.id, subId, code);
      const slots = cycleSlots(db, student.id, subId, code);
      const previousDue = Array.from({ length: index }, (_, i) =>
        Math.max(0, -cycleOf(db, student.id, subId, `M${i + 1}`).balance),
      ).reduce((s, v) => s + v, 0);

      return {
        subId,
        sessionId: sub.sessionId,
        label: session?.title || moduleNameOf(db, session?.moduleId ?? "") || "Emploi du temps",
        groupName: groupName(db, session?.groupId ?? ""),
        salleName: session ? salleName(db, sessionSalleOn(session, session.days[0])) : "—",
        teacherName: teacherName(db, session?.teacherId ?? ""),
        daysLabel: formatDays(session?.days ?? []) || "—",
        timeLabel: session ? sessionTimeLabel(session) : "—",
        active: student.subscriptionIds.includes(subId),
        leftOn: unsubscribedAtOf(db, student.id, subId),
        code,
        index,
        currentIndex,
        size: cycleSizeOf(sub),
        lead: cycleLead(db, student.id, subId, code),
        slots,
        unitPrice: studentListPrice(student, sub),
        done: cycle.done,
        presents: slots.filter((a) => a.status === "present" || a.status === "late").length,
        absents: slots.filter((a) => a.status === "absent").length,
        cancelled: slots.filter((a) => a.status === "cancelled").length,
        consumed: cycle.consumed,
        credited: cycle.credited,
        due: Math.max(0, -cycle.balance),
        advance: Math.max(0, cycle.balance),
        complete: cycle.complete,
        previousDue,
        balance: soldFor(db, student.id, subId),
      } satisfies SituationRow;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, back, db.subscriptions, db.sessions, db.students, db.attendance, db.payments, db.enrollments]);

  const slotCount = rows.reduce((mx, r) => Math.max(mx, r.size, r.lead + r.slots.length), 0);
  const totalDue = rows.reduce((s, r) => s + r.due, 0);
  const totalPrevious = rows.reduce((s, r) => s + r.previousDue, 0);
  const totalCredited = rows.reduce((s, r) => s + r.credited, 0);
  /** Le décalage ne peut pas remonter plus haut que le plus vieux mois lisible. */
  const maxBack = rows.reduce((mx, r) => Math.max(mx, r.currentIndex), 0);

  const pick = (st: Student) => {
    setStudent(st);
    setBack(0);
  };

  const submitPay = async () => {
    if (!pay || !student) return;
    const amount = Math.max(0, Math.round(pay.amount || 0));
    if (amount <= 0) {
      addToast({ type: "danger", title: "Montant invalide", message: "Saisissez un montant." });
      return;
    }
    setBusy(true);
    const res = await addSold({
      studentId: student.id,
      subscriptionId: pay.subId,
      amount,
      monthCode: pay.monthCode,
      description: pay.description,
    });
    setBusy(false);
    if (!res.ok) {
      addToast({ type: "danger", title: "Échec", message: "Le paiement n'a pas pu être enregistré." });
      return;
    }
    const left = res.balance ?? 0;
    addToast({
      type: "success",
      title: "Paiement encaissé",
      message:
        `${formatDA(amount)} sur ${pay.label} (${pay.monthCode}) — ` +
        (left < 0
          ? `il doit encore ${formatDA(-left)}`
          : `${formatDA(left)} d'avance conservés sur cet emploi du temps`),
      studentName: studentName(student),
    });
    setReceipt(
      soldReceiptHtml(db, {
        student,
        language,
        lines: [
          {
            label: pay.label,
            monthCode: res.monthCode ?? pay.monthCode,
            amount,
            balanceAfter: left,
          },
        ],
        note: pay.description,
      }),
    );
    setPay(null);
  };

  return (
    <>
      <Modal open onClose={onClose} title="Situation d'un élève" full>
        <div className="space-y-4">
          {/* ---- 1. chercher l'élève -------------------------------------- */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setStudent(null);
                }}
                placeholder="Nom, n° d'inscription (00001) ou numéro de téléphone…"
                className="pl-9"
              />
            </div>

            {!student && query.trim() && (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
                {matches.length === 0 ? (
                  <p className="py-6 text-center text-xs italic text-muted">
                    Aucun élève ne correspond.
                  </p>
                ) : (
                  matches.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => pick(st)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg p-2.5 text-left hover:bg-primary-50/60"
                    >
                      <span className="min-w-0">
                        <strong className="block text-xs text-ink">{studentName(st)}</strong>
                        <span className="text-[10px] text-muted">
                          N° {registrationNumberOf(db, st)}
                          {st.phone ? ` · ${st.phone}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {!student ? (
            <p className="rounded-2xl border border-dashed border-line py-12 text-center text-xs italic text-muted">
              Cherchez un élève par son nom, son n° d&apos;inscription ou son téléphone pour lire
              toute sa situation, emploi du temps par emploi du temps.
            </p>
          ) : (
            <>
              {/* ---- 2. l'élève et son mois ------------------------------ */}
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-primary-50/60 p-4">
                <div className="min-w-0">
                  <h3 className="text-base font-black text-ink sm:text-lg">
                    {studentName(student)}
                    {studentCaseLabel(student) && (
                      <Badge tone={studentCaseTone(student)} className="ml-2 text-[9px]">
                        {studentCaseLabel(student)}
                      </Badge>
                    )}
                  </h3>
                  <p className="text-[11px] text-muted sm:text-xs">
                    N° {registrationNumberOf(db, student)}
                    {student.phone ? ` · ${student.phone}` : ""} · {rows.length} emploi(s) du temps
                    {rows.filter((r) => !r.active).length > 0 &&
                      ` (dont ${rows.filter((r) => !r.active).length} quitté(s))`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
                    <button
                      onClick={() => setBack((b) => Math.min(maxBack, b + 1))}
                      disabled={back >= maxBack}
                      className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                      title="Mois précédent"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[132px] text-center text-[11px] font-bold text-ink">
                      {back === 0
                        ? "Mois en cours"
                        : back === 1
                          ? "1 mois avant"
                          : `${back} mois avant`}
                    </span>
                    <button
                      onClick={() => setBack((b) => Math.max(0, b - 1))}
                      disabled={back === 0}
                      className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                      title="Mois suivant"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  {back > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setBack(0)}>
                      Revenir au mois en cours
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setStudent(null)}>
                    Changer d&apos;élève
                  </Button>
                </div>
              </div>

              {/* ---- 3. ses totaux -------------------------------------- */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Emplois du temps" value={String(rows.length)} tone="text-ink" />
                <Tile
                  label="Versé sur le mois affiché"
                  value={formatDA(totalCredited)}
                  tone="text-success"
                />
                <Tile
                  label="Reste à payer (mois affiché)"
                  value={formatDA(totalDue)}
                  tone={totalDue > 0 ? "text-danger" : "text-success"}
                  hint={totalDue > 0 ? "à encaisser" : "à jour ✅"}
                />
                <Tile
                  label="Arriérés (mois précédents)"
                  value={formatDA(totalPrevious)}
                  tone={totalPrevious > 0 ? "text-danger" : "text-success"}
                  hint={totalPrevious > 0 ? "remontez les mois pour régler" : "rien en retard"}
                />
              </div>

              {/* ---- 4. LE TABLEAU -------------------------------------- */}
              {rows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line py-10 text-center text-xs italic text-muted">
                  Cet élève n&apos;est inscrit sur aucun emploi du temps.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full min-w-[1080px] text-xs">
                    <thead className="bg-canvas/60">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-2 py-2.5">Emploi du temps</th>
                        <th className="px-2 py-2.5">Mois</th>
                        {Array.from({ length: slotCount }, (_, i) => (
                          <th
                            key={i}
                            className="px-1 py-2.5 text-center"
                            title={`Séance ${i + 1} du mois`}
                          >
                            S{i + 1}
                          </th>
                        ))}
                        <th className="px-2 py-2.5">Versé / Reste</th>
                        <th className="px-2 py-2.5">Mois préc.</th>
                        <th className="px-2 py-2.5">Solde emploi</th>
                        <th className="px-2 py-2.5 text-center">Encaisser</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.subId}
                          className={`border-t border-line/60 align-middle hover:bg-primary-50/30 ${
                            r.due > 0 ? "bg-danger/5" : ""
                          }`}
                        >
                          <td className="px-2 py-2">
                            <strong className="block text-ink">{r.label}</strong>
                            <span className="block text-[10px] text-muted">
                              Groupe {r.groupName} · {r.salleName} · {r.teacherName}
                            </span>
                            <span className="block text-[10px] text-muted">
                              {r.daysLabel} · <span className="font-mono">{r.timeLabel}</span> ·
                              séance à {formatDA(r.unitPrice)}
                            </span>
                            {!r.active && (
                              <Badge tone="warning" className="mt-0.5 gap-1 text-[9px]">
                                <UserMinus className="h-2.5 w-2.5" /> désinscrit
                                {r.leftOn ? ` le ${formatDateFr(r.leftOn)}` : ""}
                              </Badge>
                            )}
                          </td>

                          <td className="px-2 py-2">
                            <Badge
                              tone={r.index === r.currentIndex ? "primary" : "neutral"}
                              className="font-mono text-[10px]"
                            >
                              {monthCodeLabel(r.code)}
                            </Badge>
                            <span className="mt-0.5 block text-[9px] text-muted">
                              {r.done}/{Math.max(0, r.size - r.lead)} séance(s)
                              {r.complete ? " · mois clos" : ""}
                              {r.lead > 0 ? ` · entré à la séance ${r.lead + 1}` : ""}
                            </span>
                            <span className="block text-[9px] text-muted">
                              {r.presents} P / {r.absents} A
                              {r.cancelled > 0 ? ` / ${r.cancelled} ×` : ""}
                            </span>
                          </td>

                          {Array.from({ length: slotCount }, (_, i) => {
                            // Au-delà du pack de CET emploi, la colonne n'existe
                            // pas pour lui : elle reste vide plutôt que d'inventer
                            // une séance jamais programmée.
                            const beyond = i >= Math.max(r.size, r.lead + r.slots.length);
                            const before = !beyond && i < r.lead;
                            const rec = beyond || before ? undefined : r.slots[i - r.lead];
                            return (
                              <td key={i} className="px-1 py-2 text-center">
                                {beyond ? (
                                  <span className="text-[10px] text-muted/30">·</span>
                                ) : (
                                  <span
                                    title={
                                      before
                                        ? `Séance tenue avant son inscription (inscrit à la séance ${r.lead + 1})`
                                        : rec
                                          ? `${STATUS_LABEL[rec.status].label} — ${formatDateFr(rec.timestamp.slice(0, 10))}`
                                          : "Pas encore pointé"
                                    }
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                                      before
                                        ? "border-dashed border-line bg-canvas/40 text-muted/40"
                                        : rec
                                          ? STATUS_LABEL[rec.status].cls
                                          : "border-line bg-canvas text-muted/50"
                                    }`}
                                  >
                                    {before ? "" : rec ? STATUS_LABEL[rec.status].short : "–"}
                                  </span>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-2 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone="success" className="font-mono" title={`Versé sur ${r.code}`}>
                                {formatDA(r.credited)}
                              </Badge>
                              {r.due > 0 ? (
                                <Badge tone="danger" className="font-mono" title="Reste dû sur ce mois">
                                  reste {formatDA(r.due)}
                                </Badge>
                              ) : (
                                <Badge tone="success" title={`${r.code} réglé`}>
                                  ✅
                                </Badge>
                              )}
                            </div>
                            <span className="mt-0.5 block text-[9px] text-muted">
                              consommé {formatDA(r.consumed)}
                              {r.advance > 0 ? ` · ${formatDA(r.advance)} d'avance` : ""}
                            </span>
                          </td>

                          <td className="px-2 py-2">
                            {r.index === 0 ? (
                              <span className="text-[10px] text-muted">—</span>
                            ) : r.previousDue > 0 ? (
                              <button
                                onClick={() => setBack((b) => Math.min(maxBack, b + 1))}
                                title="Remonter d'un mois pour le régler"
                                className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/20"
                              >
                                {formatDA(r.previousDue)}
                              </button>
                            ) : (
                              <span className="text-sm" title="Mois précédents réglés">
                                ✅
                              </span>
                            )}
                          </td>

                          <td className="px-2 py-2">
                            <span
                              className={`font-mono text-[11px] font-bold ${
                                r.balance < 0 ? "text-danger" : "text-success"
                              }`}
                            >
                              {r.balance < 0
                                ? `${formatDA(-r.balance)} dus`
                                : `${formatDA(r.balance)} d'avance`}
                            </span>
                          </td>

                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() =>
                                  setPay({
                                    subId: r.subId,
                                    label: r.label,
                                    monthCode: r.code,
                                    amount: r.due || 0,
                                    suggestion: r.due,
                                  })
                                }
                                title={`Encaisser un solde sur ${r.code}`}
                                className="flex h-7 items-center gap-1 rounded-lg bg-primary px-2 text-[10px] font-bold text-white transition-colors hover:brightness-110"
                              >
                                <Wallet className="h-3.5 w-3.5" /> Encaisser
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-success/40 bg-success/15" />{" "}
                  Présent
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-danger/40 bg-danger/15" />{" "}
                  Absent
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-primary/40 bg-primary/15" />{" "}
                  Annulée
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-line bg-canvas" /> Pas
                  encore pointé
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded border border-dashed border-line bg-canvas/40" />{" "}
                  Séance tenue avant son inscription
                </span>
                <span className="flex items-center gap-1">
                  <History className="h-3 w-3" /> Chaque emploi du temps compte SES propres mois :
                  « 1 mois avant » recule d&apos;un cran sur chaque ligne, pas sur un mois du
                  calendrier.
                </span>
              </div>
            </>
          )}

          <div className="flex justify-end border-t border-line pt-3">
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- encaisser un solde, sur la ligne concernée ------------------- */}
      {pay && student && (
        <Modal open onClose={() => setPay(null)} title="Encaisser un solde">
          <div className="space-y-3">
            <div className="rounded-xl bg-primary-50/60 p-3">
              <strong className="block text-sm text-ink">{studentName(student)}</strong>
              <span className="text-[11px] text-muted">
                N° {registrationNumberOf(db, student)} · {pay.label}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Mois concerné
                </label>
                <Select
                  value={pay.monthCode}
                  onChange={(e) => setPay({ ...pay, monthCode: e.target.value })}
                  className="w-full"
                >
                  {Array.from(
                    { length: Math.max(6, maxBack + 3) },
                    (_, i) => `M${i + 1}`,
                  ).map((c) => (
                    <option key={c} value={c}>
                      {monthCodeLabel(c)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                  Montant versé (DA)
                </label>
                <Input
                  type="number"
                  min={0}
                  autoFocus
                  value={pay.amount || ""}
                  onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) || 0 })}
                  placeholder="Ex: 4000"
                />
              </div>
            </div>
            {pay.suggestion > 0 && (
              <button
                onClick={() => setPay({ ...pay, amount: pay.suggestion })}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Régler la totalité ({formatDA(pay.suggestion)})
              </button>
            )}

            {/* Ce que ce versement laisse derrière lui : un élève qui donne 2000
                sur un mois à 1800 garde 200 sur le solde de CET emploi. */}
            {(() => {
              const amount = Math.max(0, Math.round(pay.amount || 0));
              if (amount <= 0) return null;
              const after = soldFor(db, student.id, pay.subId) + amount;
              const rest = Math.max(0, pay.suggestion - amount);
              const advance = Math.max(0, amount - pay.suggestion);
              return (
                <div
                  className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${
                    rest > 0
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-success/40 bg-success/10 text-success"
                  }`}
                >
                  {rest > 0 ? (
                    <>
                      Il restera <strong>{formatDA(rest)}</strong> à payer sur {pay.monthCode}.
                    </>
                  ) : advance > 0 ? (
                    <>
                      {pay.monthCode} est soldé et <strong>{formatDA(advance)}</strong> restent
                      d&apos;avance : cet argent est gardé sur le solde de cet emploi du temps et
                      paiera ses prochaines séances.
                    </>
                  ) : (
                    <>{pay.monthCode} sera exactement soldé.</>
                  )}
                  <span className="mt-0.5 block text-[10px] opacity-80">
                    Solde de l&apos;emploi après encaissement :{" "}
                    <strong>
                      {after < 0 ? `${formatDA(-after)} dus` : `${formatDA(after)} d'avance`}
                    </strong>
                  </span>
                </div>
              );
            })()}

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
                Description (optionnel)
              </label>
              <Input
                value={pay.description ?? ""}
                onChange={(e) => setPay({ ...pay, description: e.target.value })}
                placeholder="Laisser vide pour la description automatique"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setPay(null)}>
                Annuler
              </Button>
              <Button onClick={submitPay} disabled={busy}>
                Encaisser
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {receipt && <PrintAsk html={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-base ${tone}`}>{value}</strong>
      {hint && <span className="block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}
