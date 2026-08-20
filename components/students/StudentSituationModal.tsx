"use client";

/**
 * « Situation d'un élève » — la question que la réception pose vingt fois par
 * jour, en trois clics et sans quitter l'écran Élèves.
 *
 *   on cherche l'élève (nom, n° d'inscription ou téléphone)
 *      -> on voit TOUS ses emplois du temps, ceux qu'il suit et ceux qu'il a
 *         quittés (avec la date de sortie)
 *      -> on en choisit un
 *      -> on lit ses présences du mois, séance par séance, et ce qu'il lui
 *         RESTE À PAYER sur ce mois-là.
 *
 * Rien ne s'écrit ici : c'est un écran de lecture, celui qu'on tourne vers le
 * parent qui demande « il en est où ? ».
 */

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { formatDA } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  UserMinus,
  Wallet,
} from "lucide-react";
import type { AttendanceStatus, Student } from "@/lib/types";
import {
  currentCycleIndex,
  cycleLead,
  cycleOf,
  cycleSizeOf,
  cycleSlots,
  dayKeyOf,
  formatDateFr,
  formatDays,
  groupName,
  moduleName as moduleNameOf,
  monthCodeLabel,
  monthOrder,
  registrationNumberOf,
  salleName,
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

export function StudentSituationModal({ onClose }: { onClose: () => void }) {
  const db = useData();
  const [query, setQuery] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [monthCode, setMonthCode] = useState("M1");

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as Student[];
    return db.students
      .filter((st) => studentMatches(db, st, q))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.students, query]);

  /** Tous ses emplois du temps — actuels ET quittés. */
  const rows = useMemo(() => {
    if (!student) return [];
    return studentSubscriptionHistory(db, student).map((id) => {
      const sub = db.subscriptions.find((x) => x.id === id)!;
      const session = db.sessions.find((x) => x.id === sub.sessionId);
      return {
        subId: id,
        sub,
        session,
        label: session?.title || moduleNameOf(db, session?.moduleId ?? "") || "Emploi du temps",
        active: student.subscriptionIds.includes(id),
        leftOn: unsubscribedAtOf(db, student.id, id),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, db.subscriptions, db.sessions, db.students]);

  const pick = (st: Student) => {
    setStudent(st);
    const first = studentSubscriptionHistory(db, st)[0];
    setSubId(first ?? null);
    if (first) setMonthCode(`M${currentCycleIndex(db, st.id, first) + 1}`);
  };

  const chooseSub = (id: string) => {
    setSubId(id);
    if (student) setMonthCode(`M${currentCycleIndex(db, student.id, id) + 1}`);
  };

  const row = rows.find((r) => r.subId === subId);
  const monthIndex = Math.max(0, monthOrder(monthCode));

  return (
    <Modal open onClose={onClose} title="Situation d'un élève" wide>
      <div className="space-y-4">
        {/* ---- 1. chercher l'élève ---------------------------------------- */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setStudent(null);
                setSubId(null);
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

        {student && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-50/60 p-3">
              <div className="min-w-0">
                <strong className="block text-sm text-ink">{studentName(student)}</strong>
                <span className="text-[11px] text-muted">
                  N° {registrationNumberOf(db, student)}
                  {student.phone ? ` · ${student.phone}` : ""} · {rows.length} emploi(s) du temps
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => setStudent(null)}>
                Changer d&apos;élève
              </Button>
            </div>

            {/* ---- 2. choisir l'emploi du temps --------------------------- */}
            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-8 text-center text-xs italic text-muted">
                Cet élève n&apos;est inscrit sur aucun emploi du temps.
              </p>
            ) : (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  Ses emplois du temps
                </span>
                {rows.map((r) => {
                  const picked = r.subId === subId;
                  return (
                    <button
                      key={r.subId}
                      onClick={() => chooseSub(r.subId)}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors ${
                        picked
                          ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                          : "border-line bg-surface hover:bg-primary-50/40"
                      }`}
                    >
                      <span className="min-w-0">
                        <strong className="block text-xs text-ink">
                          {r.label}
                          {!r.active && (
                            <Badge tone="warning" className="ml-1.5 gap-1 text-[9px]">
                              <UserMinus className="h-2.5 w-2.5" /> désinscrit
                              {r.leftOn ? ` le ${formatDateFr(r.leftOn)}` : ""}
                            </Badge>
                          )}
                        </strong>
                        <span className="block text-[10px] text-muted">
                          Groupe {groupName(db, r.session?.groupId ?? "")} ·{" "}
                          {salleName(db, r.session?.salleId ?? "")} ·{" "}
                          {teacherName(db, r.session?.teacherId ?? "")}
                        </span>
                        <span className="block text-[10px] text-muted">
                          {formatDays(r.session?.days ?? []) || "—"} ·{" "}
                          <span className="font-mono">
                            {r.session?.startTime}–{r.session?.endTime}
                          </span>{" "}
                          · séance à {formatDA(studentListPrice(student, r.sub))}
                        </span>
                      </span>
                      <Badge tone={picked ? "primary" : "neutral"} className="shrink-0 text-[10px]">
                        {picked ? "affiché" : "voir"}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ---- 3. le mois : présences + reste à payer ------------------ */}
            {row && (
              <MonthPanel
                student={student}
                subId={row.subId}
                label={row.label}
                monthCode={monthCode}
                monthIndex={monthIndex}
                onMonth={setMonthCode}
              />
            )}
          </>
        )}

        <div className="flex justify-end border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MonthPanel({
  student,
  subId,
  label,
  monthCode,
  monthIndex,
  onMonth,
}: {
  student: Student;
  subId: string;
  label: string;
  monthCode: string;
  monthIndex: number;
  onMonth: (code: string) => void;
}) {
  const db = useData();
  const sub = db.subscriptions.find((s) => s.id === subId);
  const cycle = cycleOf(db, student.id, subId, monthCode);
  const slots = cycleSlots(db, student.id, subId, monthCode);
  const lead = cycleLead(db, student.id, subId, monthCode);
  const size = cycleSizeOf(sub);
  const unit = studentListPrice(student, sub);

  const presents = slots.filter((a) => a.status === "present" || a.status === "late").length;
  const absents = slots.filter((a) => a.status === "absent").length;
  const cancelled = slots.filter((a) => a.status === "cancelled").length;
  /** Ce que le mois lui coûte pour de vrai : les séances qui ont été facturées. */
  const consumed = cycle.consumed;
  const due = Math.max(0, -cycle.balance);
  const advance = Math.max(0, cycle.balance);
  /** Ce qui reste à tenir sur ce mois, à son tarif. */
  const remainingSeances = Math.max(0, size - lead - cycle.done);

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-canvas/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs text-ink">{label}</strong>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          <button
            onClick={() => onMonth(`M${Math.max(1, monthIndex)}`)}
            disabled={monthIndex === 0}
            className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
            title="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[92px] text-center text-[11px] font-bold text-ink">
            {monthCodeLabel(monthCode)}
          </span>
          <button
            onClick={() => onMonth(`M${monthIndex + 2}`)}
            className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink"
            title="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* les séances du mois */}
      <div className="flex flex-wrap items-center gap-1.5">
        {Array.from({ length: Math.max(size, lead + slots.length) }, (_, i) => {
          const before = i < lead;
          const rec = before ? undefined : slots[i - lead];
          return (
            <span
              key={i}
              title={
                before
                  ? "Séance tenue avant son inscription"
                  : rec
                    ? `${STATUS_LABEL[rec.status].label} — ${formatDateFr(dayKeyOf(rec.timestamp))}`
                    : "Pas encore pointé"
              }
              className={`inline-flex h-8 w-8 flex-col items-center justify-center rounded-lg border text-[11px] font-black ${
                before
                  ? "border-dashed border-line bg-canvas/40 text-muted/40"
                  : rec
                    ? STATUS_LABEL[rec.status].cls
                    : "border-line bg-canvas text-muted/50"
              }`}
            >
              {before ? "" : rec ? STATUS_LABEL[rec.status].short : "–"}
              <span className="text-[7px] font-normal opacity-60">S{i + 1}</span>
            </span>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Présences" value={`${presents}`} hint={`${absents} absence(s)`} tone="text-success" />
        <Tile
          label="Séances du mois"
          value={`${cycle.done}/${Math.max(0, size - lead)}`}
          hint={cycle.complete ? "mois clos" : `${remainingSeances} à venir${cancelled ? ` · ${cancelled} annulée(s)` : ""}`}
          tone="text-ink"
        />
        <Tile label="Versé" value={formatDA(cycle.credited)} hint={`consommé ${formatDA(consumed)}`} tone="text-primary" />
        <Tile
          label="Reste à payer"
          value={due > 0 ? formatDA(due) : advance > 0 ? `+${formatDA(advance)}` : "0 DA"}
          hint={due > 0 ? "à encaisser" : advance > 0 ? "d'avance" : "à jour ✅"}
          tone={due > 0 ? "text-danger" : "text-success"}
        />
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
        <Clock className="h-3 w-3" />
        {size} séances / mois · séance à {formatDA(unit)}
        {lead > 0 ? ` · entré à la séance ${lead + 1} de ce mois` : ""}
        {remainingSeances > 0 && (
          <>
            {" "}
            · <Wallet className="h-3 w-3" /> {remainingSeances} séance(s) restante(s) ={" "}
            {formatDA(remainingSeances * unit)} encore à consommer
          </>
        )}
      </p>
    </div>
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
