"use client";

/**
 * LE RÈGLEMENT D'UN ENSEIGNANT — trois écrans, un mois à la fois.
 *
 * On ne paie plus « tout ce qu'un enseignant a fait » d'un bloc : on ouvre SON
 * emploi du temps, on choisit LE MOIS, et on règle ce mois-là. L'écran suit
 * donc trois temps, dans l'ordre où la réception pense :
 *
 *   1. SES EMPLOIS DU TEMPS — un par carte, avec ce que chacun lui doit encore.
 *   2. SES MOIS, de M1 à M12 — chacun disant deux choses d'un coup d'œil : où
 *      en sont ses séances (« 3/4 » = le mois court, « 4/4 » = il est clos) et
 *      s'il a déjà été réglé. Les douze sont toujours là, même vides : c'est un
 *      calendrier, pas un journal.
 *   3. LE MOIS OUVERT — trois tables et un net :
 *        · les ÉLÈVES du mois, avec la part que chacun rapporte à l'enseignant,
 *          calculée au centime (part du mois ÷ séances × ses présences). Un
 *          élève qui n'a pas payé RETIENT sa part — sauf si l'école avance sa
 *          dette de sa caisse, et il passe alors en rouge, filtrable d'un clic ;
 *        · les ARRIÉRÉS : les élèves qui ont payé EN RETARD un mois déjà réglé.
 *          Leur part se rattrape ici, avec son mois d'origine, sans jamais se
 *          confondre avec le mois courant ;
 *        · les RETENUES : dépenses avancées par l'école, acomptes, scolarité de
 *          ses enfants (celle qui est encore due, et celle que le guichet a
 *          déjà créditée en la portant sur ce salaire).
 *
 * Le règlement enregistré fige ces trois tables (`TeacherPayment.board`), si
 * bien que la fiche imprimée, l'historique et la réimpression racontent tous la
 * même chose — même des mois plus tard.
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge, type Tone } from "@/components/ui/Badge";
import { DeductionLabel } from "@/components/teachers/DeductionLabel";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { printHtmlDocument } from "@/lib/print";
import { formatDA, money, positiveMoney } from "@/lib/utils";
import {
  formatDateFr,
  monthCodeLabel,
  monthProposal,
  soldFor,
  studentDebtSummary,
} from "@/lib/helpers";
import { buildTeacherMonthPayslip } from "@/lib/reports/teacherMonthPayslip";
import {
  boardTotals,
  buildPayBoard,
  freezeBoard,
  monthTiles,
  payEmplois,
  type BoardDeduction,
  type BoardStudent,
  type MonthTile,
  type MonthTileState,
  type PayBoard,
} from "@/lib/teacherPayBoard";
import type { TeacherEmploi } from "@/lib/teacherMonths";
import type {
  Teacher,
  TeacherChildCharge,
  TeacherPaymentArrear,
  TeacherPaymentMonth,
} from "@/lib/types";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
  HandCoins,
  Layers,
  Lock,
  Pencil,
  Printer,
  Receipt,
  ShieldCheck,
  Ticket,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";

// ---------------------------------------------------------------------------

const TILE_STYLE: Record<
  MonthTileState,
  { ring: string; chip: string; label: string; tone: Tone }
> = {
  paid: {
    ring: "border-success/50 bg-success/10 hover:bg-success/15",
    chip: "bg-success text-white",
    label: "Réglé",
    tone: "success",
  },
  payable: {
    ring: "border-primary/50 bg-primary-50/70 hover:bg-primary-50",
    chip: "bg-primary text-white",
    label: "À régler",
    tone: "primary",
  },
  blocked: {
    ring: "border-danger/40 bg-danger/10 hover:bg-danger/15",
    chip: "bg-danger text-white",
    label: "Retenu",
    tone: "danger",
  },
  running: {
    ring: "border-warning/40 bg-warning/10 hover:bg-warning/15",
    chip: "bg-warning text-white",
    label: "En cours",
    tone: "warning",
  },
  empty: {
    ring: "border-line bg-canvas/40 hover:bg-primary-50/40",
    chip: "bg-muted/30 text-muted",
    label: "Vide",
    tone: "neutral",
  },
};

const PAY_STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Payé", tone: "success" },
  partial: { label: "Partiel", tone: "warning" },
  unpaid: { label: "Impayé", tone: "danger" },
  pending: { label: "Rien encore", tone: "neutral" },
  free: { label: "Gratuit", tone: "primary" },
};

export function TeacherPayCenter({
  open,
  teacher,
  onClose,
}: {
  open: boolean;
  teacher: Teacher | null;
  onClose: () => void;
}) {
  // Remonté à chaque ouverture : l'écran repart toujours de la liste des
  // emplois du temps, sans état survivant d'un enseignant à l'autre.
  if (!open || !teacher) return null;
  return <PayCenter key={teacher.id} teacher={teacher} onClose={onClose} />;
}

function PayCenter({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const db = useData();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [monthCode, setMonthCode] = useState<string | null>(null);

  const emplois = useMemo(
    () => payEmplois(db, teacher.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      teacher.id,
      db.sessions,
      db.attendance,
      db.unpaidTeacher,
      db.payments,
      db.enrollments,
      db.students,
      db.subscriptions,
      db.independent,
      db.teacherPayments,
    ],
  );

  const emploi = emplois.find((e) => e.sessionId === sessionId) ?? null;

  const title = !emploi
    ? "Paiement — emplois du temps de l'enseignant"
    : !monthCode
      ? `Paiement — ${emploi.title} · mois`
      : `Paiement — ${emploi.title} · ${monthCode}`;

  return (
    <Modal open onClose={onClose} title={title} full>
      <div className="space-y-4">
        {/* ---- l'enseignant, toujours sous les yeux ---------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas p-4">
          <div className="min-w-0">
            <strong className="block text-sm text-ink">
              {teacher.firstName} {teacher.lastName}
            </strong>
            <span className="text-[11px] text-muted">
              {teacher.isPassager ? "Enseignant passager (sans compte)" : "Enseignant de l'école"}
              {teacher.phone ? ` · ${teacher.phone}` : ""}
            </span>
          </div>
          {/* Le fil d'Ariane : où l'on est, et comment revenir en arrière. */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Crumb
              active={!emploi}
              onClick={() => {
                setSessionId(null);
                setMonthCode(null);
              }}
            >
              Emplois du temps
            </Crumb>
            {emploi && (
              <>
                <ChevronRight className="h-3 w-3 text-muted" />
                <Crumb active={!monthCode} onClick={() => setMonthCode(null)}>
                  {emploi.title} · {emploi.groupName}
                </Crumb>
              </>
            )}
            {emploi && monthCode && (
              <>
                <ChevronRight className="h-3 w-3 text-muted" />
                <Crumb active onClick={() => undefined}>
                  {monthCodeLabel(monthCode)}
                </Crumb>
              </>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!emploi ? (
            <motion.div
              key="emplois"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              <EmploiList emplois={emplois} onPick={setSessionId} />
            </motion.div>
          ) : !monthCode ? (
            <motion.div
              key={`months-${emploi.sessionId}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
            >
              <MonthList
                teacher={teacher}
                emploi={emploi}
                onBack={() => setSessionId(null)}
                onPick={setMonthCode}
              />
            </motion.div>
          ) : (
            <motion.div
              key={`board-${emploi.sessionId}-${monthCode}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.2 }}
            >
              <MonthBoard
                key={`${emploi.sessionId}|${monthCode}`}
                teacher={teacher}
                emploi={emploi}
                monthCode={monthCode}
                onBack={() => setMonthCode(null)}
                onDone={() => setMonthCode(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}

function Crumb({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`max-w-[220px] truncate rounded-lg px-2 py-1 font-bold transition-colors ${
        active ? "bg-primary text-white" : "text-muted hover:bg-primary-50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1. Ses emplois du temps
// ---------------------------------------------------------------------------

function EmploiList({
  emplois,
  onPick,
}: {
  emplois: TeacherEmploi[];
  onPick: (id: string) => void;
}) {
  if (emplois.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line py-12 text-center text-xs font-bold text-muted">
        Cet enseignant n&apos;a aucun emploi du temps — rien à régler.
      </p>
    );
  }

  const totalPayable = emplois.reduce((s, e) => s + e.payable, 0);
  const totalWithheld = emplois.reduce((s, e) => s + e.withheld, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Emplois du temps" value={String(emplois.length)} />
        <Stat label="Payable maintenant" value={formatDA(totalPayable)} tone="text-success" />
        <Stat
          label="Retenu (élèves en dette)"
          value={formatDA(totalWithheld)}
          tone={totalWithheld > 0 ? "text-danger" : "text-muted"}
        />
        <Stat
          label="Déjà réglé"
          value={formatDA(emplois.reduce((s, e) => s + e.settled, 0))}
          tone="text-muted"
        />
      </div>

      <p className="rounded-2xl border border-primary/30 bg-primary-50/50 p-3 text-[11px] leading-relaxed text-primary">
        Choisissez l&apos;emploi du temps à régler. Chacun compte SES propres mois — M1 s&apos;ouvre
        à la première présence et se ferme sur la séance qui complète le pack — et se paie mois par
        mois, indépendamment des autres.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {emplois.map((e) => (
          <button
            key={e.sessionId}
            onClick={() => onPick(e.sessionId)}
            className="group rounded-2xl border border-line bg-surface p-4 text-start transition-all hover:border-primary/50 hover:bg-primary-50/30 hover:shadow-md"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">
                  Emploi du temps
                </span>
                <strong className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                  📚 {e.title}
                  {e.isOpen && (
                    <Badge tone="success" className="text-[9px]">
                      Séance libre
                    </Badge>
                  )}
                  {/* Un cours arrêté doit encore ce qu'il a fait gagner. */}
                  {e.archived && (
                    <Badge
                      tone="neutral"
                      className="text-[9px]"
                      title="Emploi du temps supprimé — il ne tient plus séance, mais ce qu'il vous doit reste réglable ici"
                    >
                      Supprimé
                    </Badge>
                  )}
                </strong>
                <span className="block text-[10px] text-muted">
                  Groupe {e.groupName} · {e.className} · Salle {e.salleName}
                </span>
                <span className="block text-[10px] text-muted">
                  {e.daysLabel} · <span className="font-mono">{e.timeLabel}</span> · {e.rosterCount}{" "}
                  élève(s)
                </span>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniStat label="Payable" value={formatDA(e.payable)} tone="text-success" />
              <MiniStat
                label="Retenu"
                value={formatDA(e.withheld)}
                tone={e.withheld > 0 ? "text-danger" : "text-muted"}
              />
              <MiniStat label="Déjà réglé" value={formatDA(e.settled)} tone="text-muted" />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="primary" className="gap-1 text-[10px] font-bold">
                <CalendarClock className="h-3 w-3" />
                Mois en cours {e.currentCode} · séance{" "}
                {Math.min(Math.max(e.currentHeld, 0), e.size)}/{e.size}
              </Badge>
              {e.priced ? (
                <Badge tone="neutral" className="text-[10px]">
                  {formatDA(e.perSeance)} / séance · {formatDA(money(e.perSeance * e.size))} le mois
                </Badge>
              ) : (
                <Badge tone="warning" className="text-[10px]">
                  aucune part enseignant définie
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Ses mois, M1 → M12
// ---------------------------------------------------------------------------

function MonthList({
  teacher,
  emploi,
  onBack,
  onPick,
}: {
  teacher: Teacher;
  emploi: TeacherEmploi;
  onBack: () => void;
  onPick: (code: string) => void;
}) {
  const db = useData();
  const tiles = useMemo(
    () => monthTiles(db, emploi, teacher.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emploi, teacher.id, db.teacherPayments, db.unpaidTeacher, db.payments],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Emplois du temps
        </Button>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <Legend tone="paid" /> <Legend tone="payable" /> <Legend tone="running" />
          <Legend tone="blocked" /> <Legend tone="empty" />
        </div>
      </div>

      <div className="rounded-2xl border border-primary/25 bg-primary-50/40 p-3">
        <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">
          Emploi du temps
        </span>
        <strong className="block text-sm text-ink">
          📚 {emploi.title}
          {emploi.archived && (
            <Badge tone="neutral" className="ms-1.5 text-[9px]">
              Supprimé
            </Badge>
          )}
        </strong>
        <span className="block text-[11px] font-semibold text-primary">
          Groupe {emploi.groupName} · {emploi.className} · Salle {emploi.salleName}
        </span>
        <span className="block text-[11px] text-muted">
          {emploi.size} séances par mois ·{" "}
          {emploi.priced ? (
            <>
              part enseignant <strong className="text-primary">{formatDA(emploi.perSeance)}</strong>{" "}
              par séance, soit {formatDA(money(emploi.perSeance * emploi.size))} le mois complet
            </>
          ) : (
            <span className="font-semibold text-warning">
              aucune part enseignant définie sur cet abonnement
            </span>
          )}
        </span>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          <strong className="text-ink">« 4/4 » veut dire que le mois est clos</strong> : ses quatre
          séances ont été assurées, il peut être réglé. « 3/4 » veut dire qu&apos;il court encore —
          on règle le mois qui vient de se terminer, pas celui d&apos;aujourd&apos;hui.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <MonthCard key={t.code} tile={t} delay={i * 0.03} onClick={() => onPick(t.code)} />
        ))}
      </div>
    </div>
  );
}

function Legend({ tone }: { tone: MonthTileState }) {
  const s = TILE_STYLE[tone];
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.chip}`} /> {s.label}
    </span>
  );
}

function MonthCard({
  tile,
  delay,
  onClick,
}: {
  tile: MonthTile;
  delay: number;
  onClick: () => void;
}) {
  const style = TILE_STYLE[tile.state];
  return (
    <motion.button
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, type: "spring", stiffness: 320, damping: 24 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`rounded-2xl border-2 p-3 text-start transition-colors ${style.ring}`}
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-lg font-black text-ink">{tile.code}</strong>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${style.chip}`}>
          {style.label}
        </span>
      </div>

      {/* La séance du mois, écrite comme la réception la dit : « 3/4 ». */}
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-black text-ink">
          {tile.held}/{tile.size}
        </span>
        <span className="text-[10px] text-muted">séances</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/60">
        <motion.div
          className={tile.complete ? "h-full bg-success" : "h-full bg-primary"}
          initial={{ width: 0 }}
          animate={{
            width: `${Math.min(100, tile.size > 0 ? (tile.held / tile.size) * 100 : 0)}%`,
          }}
          transition={{ delay: delay + 0.1, duration: 0.4 }}
        />
      </div>

      <div className="mt-2 space-y-0.5 text-[10px]">
        <span className="flex items-center justify-between text-muted">
          <span>Élèves</span>
          <strong className="text-ink">{tile.students}</strong>
        </span>
        {tile.settled ? (
          <span className="flex items-center justify-between text-success">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Payé
            </span>
            <strong className="font-mono">{formatDA(tile.paid)}</strong>
          </span>
        ) : tile.payable > 0 ? (
          <span className="flex items-center justify-between text-primary">
            <span>À régler</span>
            <strong className="font-mono">{formatDA(tile.payable)}</strong>
          </span>
        ) : tile.withheld > 0 ? (
          <span className="flex items-center justify-between text-danger">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" /> Retenu
            </span>
            <strong className="font-mono">{formatDA(tile.withheld)}</strong>
          </span>
        ) : (
          <span className="flex items-center justify-between text-muted">
            <span>Rien à régler</span>
            <strong>—</strong>
          </span>
        )}
        {tile.isCurrent && (
          <span className="flex items-center gap-1 text-warning">
            <Clock className="h-3 w-3" /> Mois en cours
          </span>
        )}
      </div>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// 3. Le mois ouvert — les trois tables et le net
// ---------------------------------------------------------------------------

function MonthBoard({
  teacher,
  emploi,
  monthCode,
  onBack,
  onDone,
}: {
  teacher: Teacher;
  emploi: TeacherEmploi;
  monthCode: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const db = useData();
  const {
    payTeacherSessions,
    coverStudentDebt,
    deleteTeacherPayment,
    updateTeacherPayment,
    addSold,
  } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const board: PayBoard = useMemo(
    () => buildPayBoard(db, teacher, emploi, monthCode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      teacher,
      emploi,
      monthCode,
      db.payments,
      db.unpaidTeacher,
      db.independent,
      db.teacherExpenses,
      db.acomptes,
      db.teacherChildDebts,
      db.teacherPayments,
    ],
  );

  /**
   * CE QUI EST COCHÉ.
   *
   * Tout ce qui est réglable l'est d'office : la réception décoche ce qu'elle
   * ne veut pas payer aujourd'hui, elle n'a pas à cocher vingt lignes pour
   * faire ce qu'elle fait tous les mois.
   */
  const [studentIds, setStudentIds] = useState<string[]>(() =>
    board.students.filter((r) => !r.withheld && r.amount > 0).map((r) => r.studentId),
  );
  const [arrearKeys, setArrearKeys] = useState<string[]>(() => board.arrears.map((r) => r.key));
  const [passagerIds, setPassagerIds] = useState<string[]>(() => board.passagers.map((r) => r.id));
  const [deductionIds, setDeductionIds] = useState<string[]>(() =>
    board.deductions.filter((d) => d.selectable).map((d) => d.id),
  );
  /** L'élève dont l'école s'apprête à avancer la dette. */
  const [covering, setCovering] = useState<BoardStudent | null>(null);
  /** L'élève dont la réception encaisse la scolarité, sans quitter la paie. */
  const [cashing, setCashing] = useState<BoardStudent | null>(null);
  /** Le règlement déjà enregistré que l'on est en train de corriger. */
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const settlement = board.settlement;
  /**
   * UNE PART DÉJÀ RÉGLÉE NE SE REPAIE PAS — mais ça ne fige que la TABLE 1.
   *
   * Tant qu'aucun règlement n'existe, l'écran prépare un versement pour les
   * élèves du mois : les cases se figent une fois réglées, pour empêcher de
   * verser deux fois la même part.
   *
   * Les retards de paiement, les séances libres et les retenues, eux, peuvent
   * tout à fait arriver APRÈS ce premier règlement — un élève qui s'acquitte
   * en retard, un élève de passage qui vient un autre jour, un acompte saisi
   * la semaine suivante. Un mois « réglé » n'a donc plus le droit de RIEN
   * recevoir de plus que par ces trois tables-là ; `canSettleExtra` dit s'il en
   * reste, et l'écran garde alors un bouton pour les régler à part.
   */
  const locked = !!settlement;
  const canSettleExtra =
    locked &&
    (board.arrears.length > 0 || board.passagers.length > 0 || board.deductions.some((d) => d.selectable));

  /** Ce que ce mois RESTE à devoir — ce qui reviendra sur le règlement suivant. */
  const stillOpen = money(
    board.students.reduce((s, r) => s + (r.withheld ? 0 : r.amount), 0) +
      board.arrearsTotal +
      board.passagersTotal,
  );

  const totals = boardTotals(board, {
    studentIds: locked ? [] : studentIds,
    arrearKeys,
    passagerIds,
    deductionIds,
  });
  /** Les élèves du mois qui n'ont pas soldé leur mois — ceux qu'il faut relancer. */
  const unpaidRows = board.students.filter((r) => r.debt > 0);

  // ---- l'école avance la dette d'un élève, pour débloquer la part ---------
  const applyCover = async (row: BoardStudent) => {
    setBusy(true);
    try {
      const res = await coverStudentDebt({
        studentId: row.studentId,
        // Seul CET emploi du temps retient la part : ses autres groupes et ses
        // frais d'inscription ne regardent pas cet enseignant, et les avancer
        // ferait sortir de la caisse un argent qui ne débloque rien.
        subscriptionId: emploi.subscriptionId,
        description: `Dette avancée par l'école — ${emploi.title} ${monthCode}`,
      });
      if (!res.ok) {
        addToast({
          type: "danger",
          title: "Rien à avancer",
          message: `${row.name} ne doit plus rien — sa part est déjà payable.`,
        });
        return;
      }
      setCovering(null);
      // Sa part vient de se débloquer : elle doit être cochée, sinon l'avance
      // ne servirait à rien sur ce règlement-ci.
      setStudentIds((prev) =>
        prev.includes(row.studentId) ? prev : [...prev, row.studentId],
      );
      addToast({
        type: "success",
        title: "Dette avancée par l'école",
        message: `${formatDA(res.amount ?? row.emploiDebt)} réglés sur la caisse — la part de l'enseignant est débloquée.`,
        studentName: row.name,
      });
    } finally {
      setBusy(false);
    }
  };

  // ---- encaisser la scolarité de l'élève, sans quitter la paie ------------
  /**
   * L'ÉLÈVE PAIE MAINTENANT, AU GUICHET.
   *
   * La réception n'a plus à quitter l'écran de paie pour débloquer une part :
   * l'alerte de la table 1 encaisse le mois de l'élève exactement comme la
   * feuille de présence le ferait — l'argent entre en caisse, son solde est
   * crédité sur CE mois de CET emploi, et la part de l'enseignant se coche
   * d'elle-même dans la seconde.
   */
  const applyCashIn = async (row: BoardStudent, amount: number) => {
    if (amount <= 0) return;
    setBusy(true);
    try {
      const res = await addSold({
        studentId: row.studentId,
        subscriptionId: emploi.subscriptionId!,
        amount,
        monthCode,
        description: `Encaissement au guichet — ${emploi.title} ${monthCode}`,
      });
      if (!res.ok) {
        addToast({
          type: "danger",
          title: "Encaissement impossible",
          message: "Le versement n'a pas pu être enregistré.",
          studentName: row.name,
        });
        return;
      }
      setCashing(null);
      setStudentIds((prev) => (prev.includes(row.studentId) ? prev : [...prev, row.studentId]));
      const left = res.balance ?? 0;
      addToast({
        type: "success",
        title: "Paiement encaissé",
        message:
          `${formatDA(amount)} sur ${monthCode} — ` +
          (left < 0
            ? `il doit encore ${formatDA(-left)}, la part reste partiellement retenue`
            : "la part de l'enseignant est débloquée"),
        studentName: row.name,
      });
    } finally {
      setBusy(false);
    }
  };

  // ---- enregistrer le règlement de ce mois --------------------------------
  const submit = async () => {
    if (totals.gross <= 0 && totals.deductions <= 0) {
      addToast({
        type: "danger",
        title: "Rien à régler",
        message: "Cochez au moins un élève, un arriéré, une séance libre ou une retenue.",
      });
      return;
    }
    if (
      totals.net < 0 &&
      !confirm(
        `Les retenues (${formatDA(totals.deductions)}) dépassent le brut (${formatDA(totals.gross)}).\n` +
          `L'enseignant sera enregistré à ${formatDA(totals.net)}. Continuer ?`,
      )
    ) {
      return;
    }

    // Un mois déjà réglé ne renvoie plus rien pour sa table 1, même si l'état
    // local en gardait la trace : seuls les retards, les séances libres et les
    // retenues arrivées depuis peuvent encore faire l'objet d'un règlement.
    const picked = { studentIds: locked ? [] : studentIds, arrearKeys, passagerIds, deductionIds };
    const frozen = freezeBoard(db, board, picked);
    const chosenStudents = locked
      ? []
      : board.students.filter((r) => studentIds.includes(r.studentId) && !r.withheld);
    const chosenArrears = board.arrears.filter((r) => arrearKeys.includes(r.key));
    const chosenPassagers = board.passagers.filter((r) => passagerIds.includes(r.id));
    const chosenDeductions = board.deductions.filter(
      (d) => d.selectable && deductionIds.includes(d.id),
    );

    // Une scolarité d'enfant ENCORE DUE est soldée par ce règlement : le solde
    // de l'enfant est recrédité, sans qu'aucun argent ne bouge — l'école est
    // payée en versant moins au père.
    const childCharges: TeacherChildCharge[] = [];
    for (const d of chosenDeductions) {
      if (d.kind !== "child" || !d.studentId || !d.subscriptionId || !d.monthCode) continue;
      let row = childCharges.find((c) => c.studentId === d.studentId);
      if (!row) {
        row = { studentId: d.studentId, studentName: d.label.replace(/^Scolarité — /, ""), lines: [], amount: 0 };
        childCharges.push(row);
      }
      row.lines.push({
        subscriptionId: d.subscriptionId,
        // La colonne « Emploi du temps » de la fiche de paie ne doit contenir
        // QUE l'emploi du temps : le mois et les séances ont leurs propres
        // colonnes, et les y recopier rendait la ligne illisible.
        label: d.emploi ?? d.description ?? d.label,
        monthCode: d.monthCode,
        amount: d.amount,
      });
      row.amount = money(row.amount + d.amount);
    }

    const monthSnapshot: TeacherPaymentMonth[] = [
      {
        sessionId: emploi.sessionId,
        title: emploi.title,
        groupName: emploi.groupName,
        monthCode,
        seances: board.held,
        presents: chosenStudents.reduce((s, r) => s + r.seances, 0),
        students: chosenStudents.length,
        gross: totals.students,
      },
    ];

    const arrearSnapshot: TeacherPaymentArrear[] = chosenArrears.map((r) => ({
      studentId: r.studentId,
      studentName: r.name,
      registrationNumber: r.registrationNumber,
      sessionId: emploi.sessionId,
      emploi: emploi.title,
      monthCode: r.monthCode,
      seances: r.seances,
      amount: r.amount,
    }));

    const paidAt = new Date().toISOString();
    setBusy(true);
    try {
      const res = await payTeacherSessions({
        teacherId: teacher.id,
        dueIds: chosenStudents.flatMap((r) => r.dueIds),
        arrearDueIds: chosenArrears.flatMap((r) => r.dueIds),
        // Les séances libres du mois : elles sont marquées réglées et ne
        // reviendront jamais sur un règlement suivant.
        passagerIds: chosenPassagers.map((r) => r.id),
        arrears: arrearSnapshot,
        amount: totals.net,
        gross: totals.gross,
        method: "group",
        // Un complément ne réclame pas le mois : ce règlement-là l'a déjà fait,
        // et c'est encore SON montant qui doit rester affiché comme « le »
        // règlement de {monthCode} — un complément s'ajoute, il ne remplace pas.
        months: locked ? [] : monthSnapshot,
        board: frozen,
        description:
          note.trim() ||
          (locked
            ? `Complément ${emploi.title} · ${monthCode} — ${teacher.firstName} ${teacher.lastName}`
            : `Règlement ${emploi.title} · ${monthCode} — ${teacher.firstName} ${teacher.lastName}`),
        expenseIds: chosenDeductions.filter((d) => d.kind === "expense").map((d) => d.id),
        acompteIds: chosenDeductions.filter((d) => d.kind === "acompte").map((d) => d.id),
        childDebtIds: chosenDeductions.filter((d) => d.kind === "child_debt").map((d) => d.id),
        childCharges,
        details: [
          {
            dateKey: board.month?.startDate ?? "",
            sessionId: emploi.sessionId,
            title: `${emploi.title} — ${monthCode}`,
            moduleName: emploi.title,
            groupName: emploi.groupName,
            startTime: emploi.timeLabel,
            endTime: "",
            presents: chosenStudents.reduce((s, r) => s + r.seances, 0),
            passagers: chosenPassagers.length,
            gross: chosenStudents.reduce((s, r) => s + r.credited, 0),
            share: totals.students,
          },
        ],
      });

      if (!res.ok) {
        addToast({ type: "danger", title: "Échec", message: "Le règlement n'a pas pu être enregistré." });
        return;
      }

      addToast({
        type: "success",
        title: "Règlement enregistré",
        message: `${formatDA(totals.net)} versés — ${emploi.title} · ${monthCode}.`,
        studentName: `${teacher.firstName} ${teacher.lastName}`,
      });

      if (confirm(`Paiement de ${formatDA(totals.net)} enregistré. Imprimer la fiche de paie ?`)) {
        printHtmlDocument(
          buildTeacherMonthPayslip({
            school: db.school,
            teacher,
            lang: language,
            paidAt,
            receiptNo: res.paymentId ? `PAY-${res.paymentId.slice(0, 8).toUpperCase()}` : undefined,
            board: frozen,
          }),
        );
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const printPreview = () => {
    printHtmlDocument(
      buildTeacherMonthPayslip({
        school: db.school,
        teacher,
        lang: language,
        paidAt: new Date().toISOString(),
        board: freezeBoard(db, board, { studentIds, arrearKeys, passagerIds, deductionIds }),
      }),
    );
  };

  /**
   * CORRIGER UN RÈGLEMENT DÉJÀ ENREGISTRÉ.
   *
   * Seuls le net versé, la date et le libellé se rectifient : ce que le
   * règlement a SOLDÉ (les présences, les dépenses, les acomptes) ne bouge pas,
   * sinon la paie du mois suivant se rouvrirait toute seule. Le mouvement de
   * caisse suit le nouveau montant au dinar près. Pour tout reprendre à zéro,
   * c'est « Annuler ce règlement » qu'il faut : là, tout redevient dû.
   */
  const saveEdit = async (fields: { amount: number; paidAt: string; description: string }) => {
    if (!settlement) return;
    setBusy(true);
    try {
      const res = await updateTeacherPayment(settlement.id, fields);
      setEditing(false);
      addToast({
        type: res.ok ? "success" : "danger",
        title: res.ok ? "Règlement corrigé" : "Échec",
        message: res.ok
          ? `Net versé : ${formatDA(fields.amount)} — la caisse suit le nouveau montant.`
          : "Ce règlement n'a pas pu être corrigé.",
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelSettlement = async () => {
    if (!settlement) return;
    if (
      !confirm(
        `Annuler le règlement de ${formatDA(settlement.amount)} ?\n\n` +
          "Tout ce qu'il avait soldé redevient dû : les présences repassent en attente, " +
          "les dépenses et les acomptes reviennent sur le prochain règlement, et le mouvement " +
          "de caisse disparaît. Le mois pourra être réglé de nouveau.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await deleteTeacherPayment(settlement.id);
      addToast({
        type: res.ok ? "success" : "danger",
        title: res.ok ? "Règlement annulé" : "Échec",
        message: res.ok
          ? `${formatDA(res.amount ?? 0)} rendus à la caisse — le mois ${monthCode} est de nouveau réglable.`
          : "Ce règlement n'a pas pu être annulé.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---- en-tête du mois --------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Mois de cet emploi
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="primary" className="gap-1 font-bold">
            <Layers className="h-3 w-3" />
            {emploi.title} · {emploi.groupName}
          </Badge>
          <Badge tone={board.held >= board.size ? "success" : "warning"} className="font-mono font-bold">
            {monthCodeLabel(monthCode)} — {board.held}/{board.size} séances
          </Badge>
        </div>
      </div>

      {/* ---- ce mois est-il déjà réglé ? ---------------------------------- */}
      {settlement && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-success/40 bg-success/10 p-3.5">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Ce mois a déjà été réglé —{" "}
              {formatDA(settlement.amount)} nets
            </strong>
            <span className="block text-[11px] text-muted">
              Le {formatDateFr(settlement.paidAt.slice(0, 10))} ·{" "}
              {settlement.gross != null ? `brut ${formatDA(settlement.gross)}` : ""} · Reçu N° PAY-
              {settlement.id.slice(0, 8).toUpperCase()}
            </span>
            <span className="block text-[11px] leading-relaxed text-muted">
              Sa table 1 (les élèves du mois) <strong className="text-ink">ne se règle plus</strong> :
              elle se lit, elle ne se coche plus. Pour corriger le net versé, la date ou le
              libellé, utilisez <strong className="text-ink">Modifier</strong> ; pour tout reprendre
              à zéro, <strong className="text-ink">Supprimer</strong> — le mois redevient alors
              réglable.
            </span>
            {stillOpen > 0 && (
              <span className="mt-1 block rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-relaxed text-warning">
                <strong>{formatDA(stillOpen)}</strong> se sont libérés depuis ce versement (des
                élèves ont payé en retard, ou des séances libres sont tombées ici). Un retard de
                paiement appartient à <strong>{monthCode}</strong> mais se rattrape sur le{" "}
                <strong>règlement suivant</strong>, dans sa table « Retards de paiement &amp;
                séances libres ». Une séance libre ou une retenue, elles, restent attachées à{" "}
                <strong>{monthCode}</strong> : cochez-les ci-dessous et utilisez «&nbsp;Régler le
                complément&nbsp;» pour les verser, sans rouvrir les élèves déjà réglés.
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                settlement.board &&
                printHtmlDocument(
                  buildTeacherMonthPayslip({
                    school: db.school,
                    teacher,
                    lang: language,
                    paidAt: settlement.paidAt,
                    receiptNo: `PAY-${settlement.id.slice(0, 8).toUpperCase()}`,
                    board: settlement.board,
                  }),
                )
              }
              disabled={!settlement.board}
              title={
                settlement.board
                  ? "Réimprimer la fiche de paie de ce règlement"
                  : "Règlement enregistré avant cet écran — pas de fiche détaillée"
              }
            >
              <Printer className="h-3.5 w-3.5" /> Réimprimer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="gap-1.5"
              title="Corriger le net versé, la date ou le libellé — sans rouvrir ce qui a été soldé"
            >
              <Pencil className="h-3.5 w-3.5" /> Modifier
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={cancelSettlement}
              disabled={busy}
              className="gap-1.5"
              title="Tout ce que ce règlement a soldé redevient dû, et le mois redevient réglable"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </Button>
          </div>
        </div>
      )}

      {/* ---- le résumé, toujours visible ---------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Élèves du mois"
          value={String(board.students.length)}
          hint={`${board.students.length - unpaidRows.length} à jour · ${unpaidRows.length} en dette`}
        />
        <Stat label="Table 1 — élèves" value={formatDA(totals.students)} tone="text-success" />
        <Stat
          label="Table 2 — retards"
          value={formatDA(totals.arrears)}
          tone="text-primary"
          hint={`${arrearKeys.length} ligne(s)`}
        />
        <Stat
          label="Table 2 — séances libres"
          value={formatDA(totals.passagers)}
          tone="text-primary"
          hint={`${passagerIds.length} passager(s)`}
        />
        <Stat
          label="Table 3 — retenues"
          value={formatDA(totals.deductions)}
          tone={totals.deductions > 0 ? "text-danger" : "text-muted"}
        />
        <Stat label="Net à verser" value={formatDA(totals.net)} tone="text-ink" />
      </div>

      {/* ---- LES ÉLÈVES QUI N'ONT PAS PAYÉ, EN TÊTE D'ÉCRAN ---------------
          La question que la réception se pose avant de payer l'enseignant :
          « qui manque à l'appel ? ». Chaque nom porte ses deux issues — la
          famille paie maintenant, ou l'école avance de sa caisse. */}
      {unpaidRows.length > 0 && (
        <div className="space-y-2 rounded-2xl border-2 border-danger/40 bg-danger/5 p-3">
          <strong className="flex items-center gap-1.5 text-sm text-danger">
            <AlertTriangle className="h-4 w-4" />
            {unpaidRows.length} élève(s) n&apos;ont pas soldé {monthCode} —{" "}
            {formatDA(money(unpaidRows.reduce((sum, r) => sum + r.debt, 0)))} manquants
          </strong>
          <p className="text-[11px] leading-relaxed text-muted">
            Tant que la séance qui l&apos;a produite n&apos;est pas payée, la part de
            l&apos;enseignant reste <strong className="text-ink">retenue</strong>. Deux issues, et
            elles s&apos;écrivent ici sans quitter l&apos;écran :{" "}
            <strong className="text-ink">Encaisser</strong> (la famille paie maintenant, au
            guichet) ou <strong className="text-ink">Payer de la caisse</strong> (l&apos;école
            avance et se fera rembourser). Un élève laissé tel quel n&apos;empêche rien : sa part
            reviendra toute seule dans les <em>retards de paiement</em> du mois suivant, le jour où
            il s&apos;acquittera.
          </p>
          <div className="overflow-x-auto rounded-xl border border-danger/25 bg-surface">
            <table className="w-full min-w-[620px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">Élève</th>
                  <th className="px-2 py-1.5 text-center">Séances</th>
                  <th className="px-2 py-1.5 text-right">Doit sur {monthCode}</th>
                  <th className="px-2 py-1.5 text-right">Part retenue</th>
                  <th className="px-2 py-1.5 text-center">Régler</th>
                </tr>
              </thead>
              <tbody>
                {unpaidRows.map((r) => (
                  <tr key={r.studentId} className="border-t border-line/60">
                    <td className="px-2 py-1.5">
                      <strong className="text-ink">{r.name}</strong>
                      <span className="block text-[9px] text-muted">
                        N° {r.registrationNumber || "—"}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono">
                      {r.done}/{r.size}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-danger">
                      {formatDA(r.debt)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-warning">
                      {r.withheld ? formatDA(r.amount) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setCashing(r)}
                          disabled={busy || !emploi.subscriptionId}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-2 text-[9px] font-bold text-success transition-colors hover:bg-success hover:text-white disabled:opacity-40"
                          title="La famille paie maintenant : le versement entre en caisse et débloque la part"
                        >
                          <HandCoins className="h-3 w-3" /> Encaisser
                        </button>
                        <button
                          onClick={() => setCovering(r)}
                          disabled={busy || r.emploiDebt <= 0}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-2 text-[9px] font-bold text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
                          title="L'école avance cette dette de sa propre caisse pour ne pas faire attendre l'enseignant"
                        >
                          <Banknote className="h-3 w-3" /> Payer de la caisse
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {board.withheldTotal > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{formatDA(board.withheldTotal)} sont retenus</strong> : ces élèves n&apos;ont pas
            payé les séances de <strong>{monthCode}</strong> sur cet emploi du temps, la part que ces
            séances rapportent ne se règle donc pas aujourd&apos;hui — elle reviendra dès
            qu&apos;ils se seront acquittés. Une dette sur un AUTRE groupe, ou des frais
            d&apos;inscription, ne retiennent rien ici. L&apos;école peut aussi ne pas faire attendre
            l&apos;enseignant : « Payer de la caisse » avance ce mois-là et débloque la part
            immédiatement.
          </span>
        </div>
      )}

      {/* =================== TABLE 1 — LES ÉLÈVES DU MOIS ================== */}
      <section className="overflow-hidden rounded-2xl border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-50/60 p-3">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-sm text-ink">
              <Users className="h-4 w-4 text-primary" /> 1. Élèves de {monthCode} (
              {board.students.length})
            </strong>
            <span className="block text-[11px] text-muted">
              Part enseignant : {formatDA(board.teacherMonthShare)} le mois ÷ {board.size} séances ={" "}
              <strong className="text-primary">{formatDA(board.perSeance)}</strong> la séance. La
              colonne « Part enseignant » multiplie ce tarif par les séances payables de chaque
              élève, au centime — une séance ne devient payable que lorsque l&apos;élève l&apos;a
              payée sur ce mois.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Les dettes avancées par l'école ne se pilotent plus d'ici : elles
                appartiennent à l'élève, pas à la paie de son enseignant, et
                l'écran « Étudiants » les affiche en alerte. */}
            {!locked && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setStudentIds(
                    studentIds.length > 0
                      ? []
                      : board.students
                          .filter((r) => !r.withheld && r.amount > 0)
                          .map((r) => r.studentId),
                  )
                }
              >
                Tout cocher / décocher
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto bg-surface">
          <table className="w-full min-w-[1020px] text-[11px]">
            <thead className="bg-canvas/60">
              <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                <th className="px-2 py-2 text-center">Payer</th>
                <th className="px-2 py-2">N°</th>
                <th className="px-2 py-2">Élève</th>
                {/* Le mois séance par séance, comme sur la feuille de présence. */}
                {Array.from({ length: board.size }, (_, i) => (
                  <th key={i} className="px-1 py-2 text-center" title={`Séance ${i + 1} du mois`}>
                    S{i + 1}
                  </th>
                ))}
                <th className="px-2 py-2 text-center">Séances</th>
                <th className="px-2 py-2 text-center">P / A / An.</th>
                <th className="px-2 py-2 text-center">Statut</th>
                <th className="px-2 py-2 text-right">Versé</th>
                <th className="px-2 py-2 text-right">Reste dû</th>
                <th className="px-2 py-2 text-right">Part / séance</th>
                <th className="px-2 py-2 text-right">Part enseignant</th>
                <th className="px-2 py-2 text-center">Dette</th>
              </tr>
            </thead>
            <tbody>
              {board.students.length === 0 ? (
                <tr>
                  <td colSpan={11 + board.size} className="px-3 py-8 text-center text-xs italic text-muted">
                    Aucun élève sur {monthCode} — ce mois n&apos;a encore rien produit.
                  </td>
                </tr>
              ) : (
                board.students.map((r) => (
                  <StudentLine
                    key={r.studentId}
                    row={r}
                    size={board.size}
                    locked={locked}
                    checked={studentIds.includes(r.studentId)}
                    onCash={() => setCashing(r)}
                    onToggle={() =>
                      setStudentIds((prev) =>
                        prev.includes(r.studentId)
                          ? prev.filter((x) => x !== r.studentId)
                          : [...prev, r.studentId],
                      )
                    }
                    onCover={() => setCovering(r)}
                    busy={busy}
                  />
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-canvas/60">
                <td
                  colSpan={9 + board.size}
                  className="px-2 py-2.5 text-right text-[11px] font-bold text-ink"
                >
                  TOTAL — ce que ce mois rapporte à l&apos;enseignant
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-success">
                  {formatDA(totals.students)}
                </td>
                <td />
              </tr>
              {board.withheldTotal > 0 && (
                <tr className="bg-warning/10">
                  <td
                    colSpan={9 + board.size}
                    className="px-2 py-2 text-right text-[10px] font-bold text-warning"
                  >
                    Retenu (élèves encore en dette) — réglé dès qu&apos;ils auront payé
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs font-bold text-warning">
                    {formatDA(board.withheldTotal)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </section>

      {/* ========= TABLE 2 — RETARDS DE PAIEMENT & SÉANCES LIBRES ==========
          Les deux choses qu'un mois doit à l'enseignant SANS venir de ses
          élèves inscrits, réunies sous un seul titre :

            · LES RETARDS DE PAIEMENT — une part d'un mois DÉJÀ réglé, retenue
              à l'époque faute de paiement et libérée depuis. Elle garde son
              mois d'origine et ne se confond jamais avec le mois courant ;
            · LES SÉANCES LIBRES — un élève de passage a payé sa séance sur
              place ; ce que l'école n'a pas gardé revient à l'enseignant, avec
              le mois où la séance est tombée. */}
      <section className="overflow-hidden rounded-2xl border-2 border-success/40">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-success/10 p-3">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-sm text-success">
              <HandCoins className="h-4 w-4" /> 2. Retards de paiement &amp; séances libres (
              {board.arrears.length + board.passagers.length})
            </strong>
            <span className="block text-[11px] leading-relaxed text-muted">
              Deux natures, un même principe : ce que ce règlement doit à
              l&apos;enseignant <strong className="text-ink">en dehors des élèves du mois</strong>.
              Les <strong className="text-ink">retards</strong> appartiennent à des mois déjà
              réglés — la part avait été retenue, l&apos;élève s&apos;est acquitté depuis. Les{" "}
              <strong className="text-ink">séances libres</strong> sont celles des élèves de
              passage : payées d&apos;avance, elles reviennent au mois où elles sont tombées.
            </span>
          </div>
        </div>

        {/* ---- 2a. les retards de paiement ------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/50 px-3 py-2">
          <strong className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink">
            <Clock className="h-3.5 w-3.5 text-success" /> 2a. Retards de paiement —{" "}
            {board.arrears.length} ligne(s)
          </strong>
          {board.arrears.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setArrearKeys(arrearKeys.length > 0 ? [] : board.arrears.map((r) => r.key))
              }
            >
              Tout cocher / décocher
            </Button>
          )}
        </div>

        {board.arrears.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-xs italic text-muted">
            Aucun retard de paiement à rattraper sur cet emploi du temps.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[880px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 text-center">Régler</th>
                  <th className="px-2 py-2">N°</th>
                  <th className="px-2 py-2">Élève</th>
                  <th className="px-2 py-2 text-center">Mois d&apos;origine</th>
                  <th className="px-2 py-2 text-center">Séances</th>
                  <th className="px-2 py-2">Dates concernées</th>
                  <th className="px-2 py-2 text-right">Versé par l&apos;élève</th>
                  <th className="px-2 py-2 text-right">Part / séance</th>
                  <th className="px-2 py-2 text-right">Part rattrapée</th>
                </tr>
              </thead>
              <tbody>
                {board.arrears.map((r) => {
                  const picked = arrearKeys.includes(r.key);
                  return (
                    <tr
                      key={r.key}
                      className={`border-t border-line/60 ${picked ? "bg-success/5" : ""}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={picked}
                          disabled={busy}
                          onChange={() =>
                            setArrearKeys((prev) =>
                              prev.includes(r.key)
                                ? prev.filter((k) => k !== r.key)
                                : [...prev, r.key],
                            )
                          }
                          className="h-4 w-4 disabled:opacity-30"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-muted">
                        {r.registrationNumber || "—"}
                      </td>
                      <td className="px-2 py-2">
                        <strong className="block text-ink">{r.name}</strong>
                        {r.caseLabel && (
                          <Badge tone="warning" className="mt-0.5 text-[8px]">
                            {r.caseLabel}
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge tone="success" className="font-mono text-[10px]">
                          {r.monthCode}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-center font-mono">{r.seances}</td>
                      <td className="px-2 py-2 text-[10px] text-muted">
                        {r.dates.map(formatDateFr).join(" · ") || "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{formatDA(r.credited)}</td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {formatDA(r.perSeance)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-success">
                        {formatDA(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={8} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES RETARDS DE PAIEMENT RATTRAPÉS
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-success">
                    {formatDA(totals.arrears)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ---- 2b. les séances libres du mois ---------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/50 px-3 py-2">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink">
              <Ticket className="h-3.5 w-3.5 text-primary" /> 2b. Séances libres de {monthCode} —{" "}
              {board.passagers.length} passager(s)
            </strong>
            <span className="block text-[10px] text-muted">
              Prix payé par le passager − part de l&apos;école ={" "}
              <strong className="text-primary">part de l&apos;enseignant</strong>. Encaissé :{" "}
              {formatDA(board.passagersRevenue)} · pour l&apos;école{" "}
              {formatDA(money(board.passagersRevenue - board.passagersTotal))} · pour
              l&apos;enseignant {formatDA(board.passagersTotal)}.
            </span>
          </div>
          {board.passagers.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPassagerIds(passagerIds.length > 0 ? [] : board.passagers.map((r) => r.id))
              }
            >
              Tout cocher / décocher
            </Button>
          )}
        </div>

        {board.passagers.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-xs italic text-muted">
            Aucune séance libre sur {monthCode} — aucun élève de passage n&apos;est venu sur ce
            mois.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[760px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 text-center">Régler</th>
                  <th className="px-2 py-2">Date &amp; horaire</th>
                  <th className="px-2 py-2">Élève de passage</th>
                  <th className="px-2 py-2">Séance</th>
                  <th className="px-2 py-2 text-right">Prix payé</th>
                  <th className="px-2 py-2 text-right">Part école</th>
                  <th className="px-2 py-2 text-right">Part enseignant</th>
                </tr>
              </thead>
              <tbody>
                {board.passagers.map((r) => {
                  const picked = passagerIds.includes(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-line/60 ${picked ? "bg-primary-50/40" : ""}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={picked}
                          disabled={busy}
                          onChange={() =>
                            setPassagerIds((prev) =>
                              prev.includes(r.id)
                                ? prev.filter((k) => k !== r.id)
                                : [...prev, r.id],
                            )
                          }
                          className="h-4 w-4 disabled:opacity-30"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span className="block text-ink">{formatDateFr(r.date)}</span>
                        {(r.startTime || r.endTime) && (
                          <span className="block font-mono text-[9px] text-muted">
                            {r.startTime} → {r.endTime}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <strong className="text-ink">{r.name}</strong>
                        <Badge tone="primary" className="ms-1 text-[8px]">
                          passager
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-[10px] text-muted">{r.label || "—"}</td>
                      <td className="px-2 py-2 text-right font-mono">{formatDA(r.price)}</td>
                      <td className="px-2 py-2 text-right font-mono text-muted">
                        {formatDA(r.schoolShare)}
                        {r.unsplit && (
                          <span
                            className="block text-[8px] text-warning"
                            title="Séance enregistrée avant le partage école / enseignant : l'école gardait tout. Modifiez-la depuis Séances Libres pour lui donner une part."
                          >
                            part non répartie
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-primary">
                        {formatDA(r.teacherShare)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={6} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES SÉANCES LIBRES
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-primary">
                    {formatDA(totals.passagers)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== TABLE 3 — LES RETENUES ======================== */}
      <section className="overflow-hidden rounded-2xl border-2 border-danger/30">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-danger/10 p-3">
          <div className="min-w-0">
            <strong className="flex items-center gap-1.5 text-sm text-danger">
              <Receipt className="h-4 w-4" /> 3. Retenues sur cette paie ({board.deductions.length})
            </strong>
            <span className="block text-[11px] leading-relaxed text-muted">
              Les dépenses que l&apos;école a avancées pour lui, ses acomptes, la scolarité{" "}
              <strong className="text-ink">encore due</strong> de ses enfants sur leurs emplois du
              temps, et celle que le guichet a{" "}
              <strong className="text-ink">déjà créditée en la portant sur ce salaire</strong>. Les
              lignes déjà réglées restent affichées, marquées comme telles : c&apos;est ce qui
              permet de vérifier qu&apos;on ne retient rien deux fois.
            </span>
          </div>
          {board.deductions.some((d) => d.selectable) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDeductionIds(
                  deductionIds.length > 0
                    ? []
                    : board.deductions.filter((d) => d.selectable).map((d) => d.id),
                )
              }
            >
              Tout cocher / décocher
            </Button>
          )}
        </div>

        {board.deductions.length === 0 ? (
          <p className="bg-surface px-3 py-6 text-center text-xs italic text-muted">
            Aucune dépense, aucun acompte, aucune scolarité d&apos;enfant à retenir.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 text-center">Retenir</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Nature</th>
                  <th className="px-2 py-2">Libellé</th>
                  <th className="px-2 py-2 text-center">Statut</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {board.deductions.map((d) => (
                  <DeductionLine
                    key={d.id}
                    row={d}
                    locked={busy}
                    checked={deductionIds.includes(d.id)}
                    onToggle={() =>
                      setDeductionIds((prev) =>
                        prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                      )
                    }
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={5} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES RETENUES
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-danger">
                    − {formatDA(totals.deductions)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== LE RÉSUMÉ ET LE VERSEMENT ===================== */}
      <section className="space-y-3 rounded-2xl border-2 border-primary/40 bg-primary-50/40 p-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
          Résumé du règlement — {emploi.title} · {monthCodeLabel(monthCode)}
        </span>

        <div className="space-y-1.5">
          <SummaryLine
            label={`Table 1 — élèves de ${monthCode} : ${studentIds.length} réglé(s) sur ${board.students.length}`}
            value={formatDA(totals.students)}
            tone="text-ink"
          />
          {board.withheldTotal > 0 && (
            <SummaryLine
              label={`· dont retenu (${unpaidRows.length} élève(s) en dette) — reviendra en retard de paiement`}
              value={`(${formatDA(board.withheldTotal)})`}
              tone="text-warning"
            />
          )}
          <SummaryLine
            label={`Table 2a — retards de paiement rattrapés (${arrearKeys.length} sur ${board.arrears.length})`}
            value={formatDA(totals.arrears)}
            tone="text-success"
          />
          <SummaryLine
            label={`Table 2b — séances libres (${passagerIds.length} sur ${board.passagers.length} passager(s))`}
            value={formatDA(totals.passagers)}
            tone="text-primary"
          />
          {totals.passagers > 0 && (
            <SummaryLine
              label={`· encaissé ${formatDA(totals.passagersRevenue)}, dont ${formatDA(
                money(totals.passagersRevenue - totals.passagers),
              )} gardés par l'école`}
              value=""
              tone="text-muted"
            />
          )}
          <div className="border-t border-line pt-1.5">
            <SummaryLine
              label="TOTAL BRUT — table 1 + table 2a + table 2b"
              value={formatDA(totals.gross)}
              tone="text-primary"
            />
          </div>
          {/* Le détail de ce qui est repris, nature par nature : une paie dont
              on ne comprend pas la retenue est une paie qu'on refait. */}
          {(["expense", "acompte", "child", "child_debt"] as const).map((kind) => {
            const rows = board.deductions.filter(
              (d) => d.kind === kind && d.selectable && deductionIds.includes(d.id),
            );
            if (rows.length === 0) return null;
            return (
              <SummaryLine
                key={kind}
                label={`· ${DED_KIND[kind].label} (${rows.length})`}
                value={`− ${formatDA(money(rows.reduce((sum, d) => sum + d.amount, 0)))}`}
                tone="text-muted"
              />
            );
          })}
          <SummaryLine
            label={`Table 3 — total des retenues (${deductionIds.length})`}
            value={`− ${formatDA(totals.deductions)}`}
            tone="text-danger"
          />
          <div className="flex items-center justify-between border-t-2 border-primary/40 pt-2">
            <strong className="text-sm text-ink">
              {locked
                ? canSettleExtra
                  ? "COMPLÉMENT À VERSER — séances libres & retenues"
                  : "NET VERSÉ À L'ENSEIGNANT"
                : "NET À VERSER À L'ENSEIGNANT"}
            </strong>
            <strong className="font-mono text-xl font-black text-primary">
              {formatDA(locked && !canSettleExtra ? settlement!.amount : totals.net)}
            </strong>
          </div>
          {locked && (
            <p className="text-[10px] leading-relaxed text-muted">
              {canSettleExtra
                ? `Un second versement, distinct du règlement du ${formatDateFr(
                    settlement!.paidAt.slice(0, 10),
                  )} (${formatDA(
                    settlement!.amount,
                  )} nets) — les deux resteront listés séparément dans « Mes règlements reçus ».`
                : settlement!.amount !== totals.net
                  ? `Le net figé du règlement fait foi. Ce que les tables affichent aujourd'hui (${formatDA(
                      totals.net,
                    )}) peut différer : des élèves ont payé depuis.`
                  : null}
            </p>
          )}
        </div>

        {(!locked || canSettleExtra) && (
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Libellé du règlement (optionnel)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                locked
                  ? `Complément ${emploi.title} · ${monthCode}`
                  : `Règlement ${emploi.title} · ${monthCode}`
              }
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={printPreview} className="gap-1.5">
            <Printer className="h-4 w-4" /> Aperçu / imprimer
          </Button>
          {/* LA TABLE 1 D'UN MOIS RÉGLÉ N'A PLUS DE BOUTON DE VERSEMENT — c'est
              ce qui rend un double paiement des élèves impossible. Mais un
              retard, une séance libre ou une retenue arrivés APRÈS ce
              règlement restent, eux, payables : « Régler le complément » leur
              ouvre un règlement à part, sans rouvrir les élèves déjà réglés. */}
          {locked && (
            <span className="flex items-center gap-1.5 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-[11px] font-bold text-success">
              <ShieldCheck className="h-4 w-4" />
              Élèves réglés le {formatDateFr(settlement!.paidAt.slice(0, 10))} — «&nbsp;Modifier&nbsp;»
              ou «&nbsp;Supprimer&nbsp;» pour y revenir
            </span>
          )}
          {(!locked || canSettleExtra) && (
            <Button
              variant="success"
              onClick={submit}
              disabled={busy}
              className="gap-1.5"
              title={
                locked
                  ? "Régler à part ce que ce mois doit encore — sans toucher aux élèves déjà réglés"
                  : "Enregistrer le règlement de ce mois"
              }
            >
              <Wallet className="h-4 w-4" />
              {locked ? "Régler le complément" : "Enregistrer le règlement"} —{" "}
              {formatDA(totals.net)}
            </Button>
          )}
        </div>
      </section>

      {/* ---- corriger le règlement déjà enregistré -------------------------- */}
      {editing && settlement && (
        <EditPaymentModal
          amount={settlement.amount}
          paidAt={settlement.paidAt}
          description={settlement.description}
          busy={busy}
          onSave={saveEdit}
          onClose={() => setEditing(false)}
        />
      )}

      {/* ---- la famille paie maintenant, au guichet ------------------------ */}
      {cashing && (
        <CashInModal
          row={cashing}
          emploi={emploi}
          monthCode={monthCode}
          busy={busy}
          onConfirm={(amount) => applyCashIn(cashing, amount)}
          onClose={() => setCashing(null)}
        />
      )}

      {/* ---- l'école avance la dette d'un élève ---------------------------- */}
      {covering && (
        <CoverModal
          row={covering}
          emploiTitle={emploi.title}
          subscriptionId={emploi.subscriptionId}
          busy={busy}
          onConfirm={() => applyCover(covering)}
          onClose={() => setCovering(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StudentLine({
  row,
  size,
  checked,
  locked,
  onToggle,
  onCover,
  onCash,
  busy,
}: {
  row: BoardStudent;
  size: number;
  checked: boolean;
  /** le mois est réglé : la ligne se lit, elle ne se coche plus */
  locked: boolean;
  onToggle: () => void;
  onCover: () => void;
  onCash: () => void;
  busy: boolean;
}) {
  const state = PAY_STATE_LABEL[row.payState] ?? PAY_STATE_LABEL.pending;
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`border-t border-line/60 align-middle ${
        row.schoolCovered
          ? "bg-danger/10"
          : row.withheld
            ? "bg-warning/5"
            : checked
              ? "bg-success/5"
              : ""
      }`}
    >
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked || row.withheld || row.amount <= 0}
          onChange={onToggle}
          className="h-4 w-4 disabled:opacity-30"
          title={
            locked
              ? "Ce mois a déjà été réglé"
              : row.withheld
                ? "Part retenue : cet élève doit encore de l'argent"
                : row.amount <= 0
                  ? "Rien à régler pour cet élève sur ce mois"
                  : "Régler la part de cet élève"
          }
        />
      </td>
      <td className="px-2 py-2 font-mono text-[10px] text-muted">
        {row.registrationNumber || "—"}
      </td>
      <td className="px-2 py-2">
        <strong className="block text-ink">{row.name}</strong>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {row.caseLabel && (
            <Badge tone="warning" className="text-[8px]">
              {row.caseLabel}
            </Badge>
          )}
          {/* L'élève dont l'école a avancé la dette : signalé en rouge, parce
              que l'enseignant est payé alors que la famille n'a rien versé. */}
          {row.schoolCovered && (
            <motion.span
              animate={{ opacity: [1, 0.55, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[8px] font-bold text-white"
              title="L'école a avancé la dette de cet élève sur sa propre caisse"
            >
              <AlertTriangle className="h-2.5 w-2.5" /> avancé par l&apos;école
            </motion.span>
          )}
          {row.phone && <span className="text-[9px] text-muted">{row.phone}</span>}
        </div>
      </td>
      <SlotCells
        slots={row.slots ?? Array.from({ length: size }, () => null)}
      />
      <td className="px-2 py-2 text-center font-mono">
        {row.seances}
        <span className="block text-[9px] text-muted">
          {row.done}/{row.size}
        </span>
      </td>
      <td className="px-2 py-2 text-center font-mono text-[10px]">
        <span className="text-success">{row.presents}</span> /{" "}
        <span className="text-danger">{row.absents}</span> /{" "}
        <span className="text-primary">{row.cancelled}</span>
      </td>
      <td className="px-2 py-2 text-center">
        <Badge tone={state.tone} className="text-[9px]">
          {state.label}
        </Badge>
      </td>
      <td className="px-2 py-2 text-right font-mono text-success">{formatDA(row.credited)}</td>
      <td className="px-2 py-2 text-right font-mono">
        {row.debt > 0 ? (
          <span className="font-bold text-danger">{formatDA(row.debt)}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right font-mono text-muted">{formatDA(row.perSeance)}</td>
      <td className="px-2 py-2 text-right">
        {row.withheld ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-warning">
            <Lock className="h-3 w-3" /> {formatDA(row.amount)}
          </span>
        ) : (
          <strong className="font-mono text-success">{formatDA(row.amount)}</strong>
        )}
        {row.alreadyPaid > 0 && (
          <span className="block text-[9px] text-muted">
            déjà réglé {formatDA(row.alreadyPaid)}
          </span>
        )}
      </td>
      {/* LE BOUTON N'APPARAÎT QUE QUAND IL SERT : la part de cet élève est
          retenue parce qu'il n'a pas payé ses séances de ce mois. Un élève à
          jour ici n'a rien à faire avancer — même s'il doit encore sur un autre
          groupe, cette dette-là ne retient pas cet enseignant. */}
      <td className="px-2 py-2 text-center">
        {row.withheld ? (
          <div className="flex flex-wrap items-center justify-center gap-1">
            {/* La famille paie maintenant : le versement entre en caisse et la
                part se débloque dans la seconde, sans quitter cet écran. */}
            <button
              onClick={onCash}
              disabled={busy || locked}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-2 text-[9px] font-bold text-success transition-colors hover:bg-success hover:text-white disabled:opacity-40"
              title={`Encaisser ${formatDA(row.debt)} au guichet — la part de l'enseignant se débloque aussitôt`}
            >
              <HandCoins className="h-3 w-3" /> Encaisser
            </button>
            <button
              onClick={onCover}
              disabled={busy || locked}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-danger/40 bg-danger/10 px-2 text-[9px] font-bold text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
              title={`Avancer ${formatDA(row.emploiDebt)} de la caisse de l'école pour débloquer la part de l'enseignant`}
            >
              <Banknote className="h-3 w-3" /> Payer de la caisse
            </button>
          </div>
        ) : (
          <span
            className="text-[10px] text-success"
            title={
              row.otherDebt > 0
                ? `Ses séances de ce mois sont payées — sa part est réglable. Il doit encore ${formatDA(row.otherDebt)} sur d'autres emplois du temps, ce qui ne retient pas cet enseignant.`
                : "Ses séances de ce mois sont payées — sa part est réglable."
            }
          >
            ✅
          </span>
        )}
      </td>
    </motion.tr>
  );
}


/**
 * LES MÊMES PASTILLES QUE LA FEUILLE DE PRÉSENCE — même écran, même langage.
 *
 * `"before"` marque une séance tenue avant l'inscription de l'élève : elle
 * n'a jamais été la sienne, donc elle reste vide plutôt que de se lire comme
 * un pointage oublié.
 */
const SLOT_STYLE: Record<string, { short: string; cls: string; label: string }> = {
  present: { short: "P", cls: "bg-success/15 text-success border-success/40", label: "Présent" },
  late: { short: "R", cls: "bg-warning/15 text-warning border-warning/40", label: "Retard" },
  absent: { short: "A", cls: "bg-danger/15 text-danger border-danger/40", label: "Absent" },
  cancelled: { short: "\u00d7", cls: "bg-primary/15 text-primary border-primary/40", label: "Annulée" },
  before: {
    short: "",
    cls: "border-dashed border-line bg-canvas/40 text-muted/40",
    label: "Séance tenue avant son inscription",
  },
};

function SlotCells({ slots }: { slots: (string | null)[] }) {
  return (
    <>
      {slots.map((v, i) => {
        const style = v ? SLOT_STYLE[v] : undefined;
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span
              title={style ? `Séance ${i + 1} — ${style.label}` : `Séance ${i + 1} — pas encore pointée`}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                style?.cls ?? "border-line bg-canvas text-muted/50"
              }`}
            >
              {style ? style.short : "\u2013"}
            </span>
          </td>
        );
      })}
    </>
  );
}

const DED_KIND: Record<BoardDeduction["kind"], { label: string; tone: Tone; icon: React.ReactNode }> = {
  expense: { label: "Dépense", tone: "warning", icon: <Receipt className="h-3 w-3" /> },
  acompte: { label: "Acompte", tone: "primary", icon: <Wallet className="h-3 w-3" /> },
  child: { label: "Scolarité enfant", tone: "danger", icon: <GraduationCap className="h-3 w-3" /> },
  child_debt: {
    label: "Scolarité avancée",
    tone: "danger",
    icon: <GraduationCap className="h-3 w-3" />,
  },
};

function DeductionLine({
  row,
  checked,
  locked: busy,
  onToggle,
}: {
  row: BoardDeduction;
  checked: boolean;
  /** un règlement est en train de s'enregistrer — pas « ce mois est déjà réglé » :
   *  une retenue reste retenable même sur un mois dont la table 1 est figée. */
  locked: boolean;
  onToggle: () => void;
}) {
  const kind = DED_KIND[row.kind];
  return (
    <tr className={`border-t border-line/60 ${row.paid ? "opacity-60" : checked ? "bg-danger/5" : ""}`}>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={checked && row.selectable}
          disabled={busy || !row.selectable}
          onChange={onToggle}
          className="h-4 w-4 disabled:opacity-30"
          title={
            row.selectable ? "Retenir cette ligne" : "Déjà retenue par un règlement précédent"
          }
        />
      </td>
      <td className="px-2 py-2 font-mono text-[10px] text-muted">
        {row.date ? formatDateFr(row.date) : "—"}
      </td>
      <td className="px-2 py-2">
        <Badge tone={kind.tone} className="gap-1 text-[9px]">
          {kind.icon} {kind.label}
        </Badge>
      </td>
      <td className="px-2 py-2">
        <DeductionLabel row={row} />
      </td>
      <td className="px-2 py-2 text-center">
        <Badge tone={row.paid ? "success" : "warning"} className="text-[9px]">
          {row.paid ? "Déjà retenue" : "À retenir"}
        </Badge>
      </td>
      <td className="px-2 py-2 text-right font-mono font-bold text-danger">
        − {formatDA(row.amount)}
      </td>
    </tr>
  );
}

/**
 * CORRIGER UN RÈGLEMENT — le net, la date, le libellé, et rien d'autre.
 *
 * Rejouer ce qu'un règlement a soldé à l'occasion d'une faute de frappe
 * rouvrirait un mois déjà payé : les présences redeviendraient dues et la paie
 * suivante les réclamerait une seconde fois. Seul le mouvement de caisse suit
 * le nouveau montant.
 */
function EditPaymentModal({
  amount,
  paidAt,
  description,
  busy,
  onSave,
  onClose,
}: {
  amount: number;
  paidAt: string;
  description: string;
  busy: boolean;
  onSave: (fields: { amount: number; paidAt: string; description: string }) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(amount);
  const [date, setDate] = useState(paidAt.slice(0, 10));
  const [label, setLabel] = useState(description);

  return (
    <Modal open onClose={onClose} title="Corriger ce règlement">
      <div className="space-y-3">
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning">
          Seuls le <strong>net versé</strong>, la <strong>date</strong> et le{" "}
          <strong>libellé</strong> se corrigent ici. Ce que ce règlement a soldé — les présences,
          les dépenses, les acomptes — ne bouge pas : le rejouer rouvrirait un mois déjà payé.
          Pour tout reprendre, utilisez « Supprimer ».
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Net versé (DA)
            </label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={value || ""}
              onChange={(e) => setValue(money(Number(e.target.value.replace(",", ".")) || 0))}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
              Date du règlement
            </label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            Libellé
          </label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() =>
              onSave({
                amount: value,
                // La date garde l'heure d'origine : seul le jour se corrige.
                paidAt: `${date}T${paidAt.slice(11) || "12:00:00.000Z"}`,
                description: label.trim(),
              })
            }
            disabled={busy}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * LA FAMILLE PAIE MAINTENANT — au guichet, depuis l'écran de paie.
 *
 * C'est la moitié manquante de l'avance par l'école. Un élève qui n'a pas
 * réglé retient la part de son enseignant ; jusqu'ici, la seule issue offerte
 * ici était que l'école avance l'argent. Or neuf fois sur dix la famille est
 * là, au comptoir, et paie : ce versement-là doit pouvoir s'écrire sans
 * traverser trois écrans.
 *
 * Il est identique à celui de la feuille de présence : l'argent entre en
 * caisse, le solde de CET emploi du temps est crédité sur CE mois, et la part
 * de l'enseignant se débloque au centime — séance par séance, dans l'ordre où
 * elles ont été tenues.
 */
function CashInModal({
  row,
  emploi,
  monthCode,
  busy,
  onConfirm,
  onClose,
}: {
  row: BoardStudent;
  emploi: TeacherEmploi;
  monthCode: string;
  busy: boolean;
  onConfirm: (amount: number) => void;
  onClose: () => void;
}) {
  const db = useData();
  const subId = emploi.subscriptionId ?? "";
  const proposal = subId ? monthProposal(db, row.studentId, subId, monthCode) : null;
  const balance = subId ? soldFor(db, row.studentId, subId) : 0;
  const [amount, setAmount] = useState(() => positiveMoney(row.debt));

  const after = money(balance + Math.max(0, amount));
  const rest = Math.max(0, money(row.debt - Math.max(0, amount)));

  return (
    <Modal open onClose={onClose} title="Encaisser la scolarité de cet élève">
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{row.name}</strong>
          <span className="text-[11px] text-muted">
            N° {row.registrationNumber || "—"}
            {row.phone ? ` · ${row.phone}` : ""} · {emploi.title} · {monthCodeLabel(monthCode)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label={`Doit sur ${monthCode}`} value={formatDA(row.debt)} tone="text-danger" />
          <Stat
            label="Part retenue"
            value={formatDA(row.amount)}
            tone={row.withheld ? "text-warning" : "text-muted"}
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted">
            Montant versé (DA)
          </label>
          <Input
            type="number"
            step="0.01"
            min={0}
            autoFocus
            value={amount || ""}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {row.debt > 0 && (
            <button
              type="button"
              onClick={() => setAmount(money(row.debt))}
              className="rounded-lg border border-line px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary-50"
            >
              Ce qui est dû ({formatDA(row.debt)})
            </button>
          )}
          {proposal && proposal.unit > 0 && (
            <button
              type="button"
              onClick={() => setAmount((v) => money(v + proposal.unit))}
              className="rounded-lg border border-line px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary-50"
            >
              + 1 séance ({formatDA(proposal.unit)})
            </button>
          )}
          {proposal && proposal.total > 0 && (
            <button
              type="button"
              onClick={() => setAmount(money(proposal.total))}
              className="rounded-lg border border-line px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary-50"
            >
              Le mois entier ({formatDA(proposal.total)})
            </button>
          )}
        </div>

        <div
          className={`rounded-xl border p-2.5 text-[11px] leading-relaxed ${
            rest > 0
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-success/40 bg-success/10 text-success"
          }`}
        >
          {rest > 0 ? (
            <>
              Il restera <strong>{formatDA(rest)}</strong> à payer sur {monthCode} : la part de
              l&apos;enseignant se débloquera séance par séance, dans l&apos;ordre où elles ont été
              tenues.
            </>
          ) : (
            <>
              {monthCode} sera soldé et la part de l&apos;enseignant devient réglable
              immédiatement.
            </>
          )}
          <span className="mt-0.5 block text-[10px] opacity-80">
            Solde de l&apos;emploi après encaissement :{" "}
            <strong>{after < 0 ? `${formatDA(-after)} dus` : `${formatDA(after)} d'avance`}</strong>
          </span>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="success"
            onClick={() => onConfirm(positiveMoney(amount))}
            disabled={busy || amount <= 0 || !subId}
            className="gap-1.5"
          >
            <HandCoins className="h-4 w-4" /> Encaisser {formatDA(Math.max(0, amount))}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * L'ÉCOLE AVANCE CE QUE L'ÉLÈVE DOIT SUR CET EMPLOI DU TEMPS.
 *
 * Ce qui retient la part de l'enseignant, ce sont LES SÉANCES NON PAYÉES DE CET
 * EMPLOI-CI. L'école les avance de sa caisse pour ne pas le faire attendre :
 * deux mouvements y entrent alors — le paiement porté au crédit de l'élève, et
 * la sortie qui l'a financé.
 *
 * Ses autres groupes et ses frais d'inscription restent dus par la famille :
 * ils ne retiennent pas cet enseignant, donc les avancer ici ne débloquerait
 * rien et sortirait de la caisse un argent que personne n'a demandé.
 */
function CoverModal({
  row,
  emploiTitle,
  subscriptionId,
  busy,
  onConfirm,
  onClose,
}: {
  row: BoardStudent;
  emploiTitle: string;
  subscriptionId?: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const db = useData();
  const summary = studentDebtSummary(db, row.studentId);
  const here = summary.soldRows.filter((r) => r.subscriptionId === subscriptionId);
  const total = money(here.reduce((s, r) => s + r.debt, 0));
  const elsewhere = money(summary.total - total);

  return (
    <Modal open onClose={onClose} title="Avancer les séances impayées sur la caisse de l'école">
      <div className="space-y-3">
        <div className="rounded-xl bg-primary-50/60 p-3">
          <strong className="block text-sm text-ink">{row.name}</strong>
          <span className="text-[11px] text-muted">
            N° {row.registrationNumber || "—"}
            {row.phone ? ` · ${row.phone}` : ""} · {emploiTitle}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-ink">
          Les séances que cet élève n&apos;a pas payées sur <strong>{emploiTitle}</strong> retiennent
          la part qu&apos;elles rapportent à l&apos;enseignant. L&apos;école peut la débloquer en
          avançant elle-même ces mois : deux mouvements entrent dans la caisse — le paiement porté
          au crédit de l&apos;élève, et la sortie qui l&apos;a financé.
        </p>

        <div className="space-y-1.5 rounded-xl border border-line bg-canvas/40 p-3 text-[11px]">
          {here.length === 0 ? (
            <span className="block text-center italic text-muted">
              Rien à avancer sur cet emploi du temps.
            </span>
          ) : (
            here.map((r) => (
              <div key={`${r.subscriptionId}-${r.code}`} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-muted">
                  {r.label} · {r.code}
                </span>
                <strong className="shrink-0 font-mono text-danger">{formatDA(r.debt)}</strong>
              </div>
            ))
          )}
          <div className="flex justify-between gap-2 border-t border-line pt-1.5">
            <strong className="text-ink">Total à avancer</strong>
            <strong className="font-mono text-danger">{formatDA(total)}</strong>
          </div>
        </div>

        {elsewhere > 0 && (
          <p className="rounded-xl border border-line bg-canvas/40 p-2.5 text-[11px] leading-relaxed text-muted">
            Il doit encore <strong className="text-ink">{formatDA(elsewhere)}</strong> ailleurs
            (autres emplois du temps, restes d&apos;anciens paiements, frais d&apos;inscription).
            Cette dette-là <strong>ne retient pas</strong> cet enseignant : elle reste à la charge de
            la famille et se règle au guichet.
          </p>
        )}

        <p className="rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning">
          L&apos;élève apparaîtra ensuite en rouge sur la table des élèves, et l&apos;écran{" "}
          <strong>Étudiants</strong> le signalera en alerte tant que l&apos;école n&apos;aura pas
          récupéré son avance.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy || total <= 0}
            className="gap-1.5"
          >
            <Banknote className="h-4 w-4" /> Avancer {formatDA(total)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone = "text-ink",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`mt-0.5 block font-mono text-base font-black ${tone}`}>{value}</strong>
      {hint && <span className="block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl bg-canvas/60 p-2 text-center">
      <span className="block text-[8px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-[11px] font-black ${tone}`}>{value}</strong>
    </div>
  );
}

function SummaryLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <strong className={`font-mono ${tone}`}>{value}</strong>
    </div>
  );
}
