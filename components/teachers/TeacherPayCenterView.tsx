"use client";

/**
 * MA PAIE, VUE DE MON CÔTÉ — le même écran que celui du guichet, en lecture.
 *
 * L'administration règle un enseignant depuis « Enseignants → Paiement » : elle
 * ouvre SES emplois du temps, choisit LE MOIS, et lit trois tables avant de
 * verser. L'enseignant, lui, doit pouvoir vérifier exactement la même chose sur
 * son propre compte — sinon la seule façon de comprendre sa paie est de
 * demander à quelqu'un.
 *
 * Cet écran est donc la copie conforme de l'écran de règlement, avec les mêmes
 * trois temps :
 *
 *   1. SES EMPLOIS DU TEMPS — un par carte, avec ce que chacun lui doit.
 *   2. SES MOIS, de M1 à M12 — la même pastille, le même « 3/4 », les mêmes
 *      couleurs : réglé, à régler, en cours, retenu, vide.
 *   3. LE MOIS OUVERT — les élèves du mois, les retards de paiement et les
 *      séances libres, les retenues, et le net.
 *
 * Une seule chose change, et c'est la plus importante : RIEN NE SE COCHE, RIEN
 * NE S'ENREGISTRE. Pas une case, pas un bouton d'encaissement, pas une
 * suppression. L'enseignant lit sa paie ; il ne la fait pas.
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PayBoardView } from "@/components/teachers/PayBoardView";
import { DeductionLabel } from "@/components/teachers/DeductionLabel";
import { formatDA, money } from "@/lib/utils";
import {
  formatDateFr,
  monthCodeLabel,
  settlementChildLabel,
  settlementChildLines,
  teacherChildDebtEmploi,
} from "@/lib/helpers";
import {
  buildPayBoard,
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
  TeacherAbsence,
  TeacherAcompte,
  TeacherChildDebt,
  TeacherExpense,
  TeacherPayment,
} from "@/lib/types";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  GraduationCap,
  HandCoins,
  Layers,
  Lock,
  Receipt,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  La palette des pastilles de mois — la même grammaire que l'écran du guichet,
//  en un peu plus contrasté : cet écran-ci se lit de loin, sans rien à cocher.
// ---------------------------------------------------------------------------

const TILE_STYLE: Record<
  MonthTileState,
  { ring: string; chip: string; label: string; bar: string }
> = {
  paid: {
    ring: "border-success/50 bg-gradient-to-br from-success/15 to-success/5 hover:border-success",
    chip: "bg-success text-white",
    label: "Réglé",
    bar: "bg-success",
  },
  payable: {
    ring: "border-primary/50 bg-gradient-to-br from-primary/15 to-primary/5 hover:border-primary",
    chip: "bg-primary text-white",
    label: "À régler",
    bar: "bg-primary",
  },
  blocked: {
    ring: "border-danger/45 bg-gradient-to-br from-danger/15 to-danger/5 hover:border-danger",
    chip: "bg-danger text-white",
    label: "Retenu",
    bar: "bg-danger",
  },
  running: {
    ring: "border-warning/45 bg-gradient-to-br from-warning/15 to-warning/5 hover:border-warning",
    chip: "bg-warning text-white",
    label: "En cours",
    bar: "bg-warning",
  },
  empty: {
    ring: "border-line bg-canvas/50 hover:border-primary/40",
    chip: "bg-muted/25 text-muted",
    label: "Vide",
    bar: "bg-line",
  },
};

const PAY_STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Payé", tone: "success" },
  partial: { label: "Partiel", tone: "warning" },
  unpaid: { label: "Impayé", tone: "danger" },
  pending: { label: "Rien encore", tone: "neutral" },
  free: { label: "Gratuit", tone: "primary" },
};

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

/**
 * LES MÊMES PASTILLES QUE LA FEUILLE DE PRÉSENCE — même écran, même langage.
 *
 * `"before"` marque une séance tenue avant l'inscription de l'élève : elle
 * reste vide plutôt que de se lire comme un pointage oublié.
 */
const SLOT_STYLE: Record<string, { short: string; cls: string; label: string }> = {
  present: { short: "P", cls: "bg-success/15 text-success border-success/40", label: "Présent" },
  late: { short: "R", cls: "bg-warning/15 text-warning border-warning/40", label: "Retard" },
  absent: { short: "A", cls: "bg-danger/15 text-danger border-danger/40", label: "Absent" },
  cancelled: {
    short: "×",
    cls: "bg-primary/15 text-primary border-primary/40",
    label: "Annulée",
  },
  before: {
    short: "",
    cls: "border-dashed border-line bg-canvas/40 text-muted/40",
    label: "Séance tenue avant son inscription",
  },
};

// ---------------------------------------------------------------------------

export function TeacherPayCenterView({ teacher }: { teacher: Teacher }) {
  const db = useData();
  const [tab, setTab] = useState<"emplois" | "reglements" | "retenues">("emplois");
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

  const settlements = useMemo(
    () =>
      db.teacherPayments
        .filter((p) => p.teacherId === teacher.id)
        .slice()
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    [db.teacherPayments, teacher.id],
  );

  /**
   * LE GRAND LIVRE DE CE QUI SE RETIENT SUR MA PAIE.
   *
   * Les tables d'un mois ne montrent une retenue qu'au moment où elle tombe sur
   * ce mois-là. Or un enseignant veut aussi pouvoir lire la liste brute : tous
   * ses acomptes, toutes les dépenses avancées pour lui, toutes les pénalités
   * d'absence, toutes les scolarités d'enfants portées sur son salaire — avec,
   * pour chacune, si elle a déjà été reprise ou si elle attend encore.
   *
   * Les pénalités d'absence, en particulier, ne passent par aucun tableau de
   * mois : sans cette page, l'enseignant ne les verrait nulle part.
   */
  const ledger = useMemo(
    () => ({
      acomptes: db.acomptes.filter((a) => a.teacherId === teacher.id),
      expenses: db.teacherExpenses.filter((e) => e.teacherId === teacher.id),
      absences: db.absences.filter((a) => a.teacherId === teacher.id),
      childDebts: db.teacherChildDebts.filter((d) => d.teacherId === teacher.id),
    }),
    [db.acomptes, db.teacherExpenses, db.absences, db.teacherChildDebts, teacher.id],
  );

  const ledgerCount =
    ledger.acomptes.length +
    ledger.expenses.length +
    ledger.absences.length +
    ledger.childDebts.length;

  const emploi = emplois.find((e) => e.sessionId === sessionId) ?? null;

  const totalPayable = money(emplois.reduce((s, e) => s + e.payable, 0));
  const totalWithheld = money(emplois.reduce((s, e) => s + e.withheld, 0));
  const totalSettled = money(emplois.reduce((s, e) => s + e.settled, 0));
  const totalReceived = money(settlements.reduce((s, p) => s + p.amount, 0));

  return (
    <div className="space-y-4 text-xs">
      {/* ---- l'en-tête : qui je suis, et où en est ma paie ----------------- */}
      <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-50 via-primary-50/40 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              💵 Ma paie, emploi du temps par emploi du temps
            </span>
            <strong className="mt-0.5 block text-lg text-ink">
              {teacher.firstName} {teacher.lastName}
            </strong>
            <span className="block text-[11px] text-muted">
              {teacher.paymentType === "monthly"
                ? `Salaire mensuel — ${formatDA(teacher.monthlyAmount ?? 0)} le mois`
                : teacher.paymentType === "per_group"
                  ? "Réglé par groupe — chaque emploi du temps porte sa propre part"
                  : `Réglé au pourcentage — ${teacher.percentage ?? 0} % par élève`}
              {teacher.phone ? ` · ${teacher.phone}` : ""}
            </span>
          </div>

          {/* Le fil d'Ariane : où l'on est, et comment revenir en arrière. */}
          {tab === "emplois" && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Crumb
                active={!emploi}
                onClick={() => {
                  setSessionId(null);
                  setMonthCode(null);
                }}
              >
                Mes emplois du temps
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
          )}
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-primary/20 bg-primary/10 lg:grid-cols-5">
          <HeadStat
            label="Emplois du temps"
            value={String(emplois.length)}
            icon={<Layers className="h-3.5 w-3.5" />}
          />
          <HeadStat
            label="Payable maintenant"
            value={formatDA(totalPayable)}
            tone="text-success"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          />
          <HeadStat
            label="Retenu (élèves en dette)"
            value={formatDA(totalWithheld)}
            tone={totalWithheld > 0 ? "text-danger" : "text-muted"}
            icon={<Lock className="h-3.5 w-3.5" />}
          />
          <HeadStat
            label="Déjà gagné et soldé"
            value={formatDA(totalSettled)}
            tone="text-primary"
            icon={<BadgeCheck className="h-3.5 w-3.5" />}
          />
          <HeadStat
            label="Net reçu à ce jour"
            value={formatDA(totalReceived)}
            tone="text-ink"
            icon={<Banknote className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {/* ---- les deux façons de lire sa paie ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-line bg-canvas p-1">
          <TabButton active={tab === "emplois"} onClick={() => setTab("emplois")}>
            <Layers className="h-3.5 w-3.5" /> Mes emplois du temps ({emplois.length})
          </TabButton>
          <TabButton active={tab === "reglements"} onClick={() => setTab("reglements")}>
            <Receipt className="h-3.5 w-3.5" /> Mes règlements reçus ({settlements.length})
          </TabButton>
          <TabButton active={tab === "retenues"} onClick={() => setTab("retenues")}>
            <Lock className="h-3.5 w-3.5" /> Acomptes &amp; retenues ({ledgerCount})
          </TabButton>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-[10px] font-bold text-warning">
          <Eye className="h-3.5 w-3.5" /> Lecture seule — cet écran ne modifie rien
        </span>
      </div>

      <AnimatePresence mode="wait">
        {tab === "retenues" ? (
          <motion.div
            key="ledger"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            <LedgerView {...ledger} />
          </motion.div>
        ) : tab === "reglements" ? (
          <motion.div
            key="settlements"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            <SettlementList settlements={settlements} />
          </motion.div>
        ) : !emploi ? (
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
            <MonthBoardView
              teacher={teacher}
              emploi={emploi}
              monthCode={monthCode}
              onBack={() => setMonthCode(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({
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
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-all ${
        active ? "bg-gradient-primary text-white card-shadow" : "text-muted hover:bg-primary-50 hover:text-ink"
      }`}
    >
      {children}
    </button>
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
// 1. Mes emplois du temps
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
      <p className="rounded-2xl border border-dashed border-line py-14 text-center text-xs font-bold text-muted">
        Aucun emploi du temps ne vous est encore assigné — il n&apos;y a donc rien à lire ici.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="rounded-2xl border border-primary/30 bg-primary-50/50 p-3 text-[11px] leading-relaxed text-primary">
        Choisissez l&apos;emploi du temps à consulter. Chacun compte{" "}
        <strong>ses propres mois</strong> — M1 s&apos;ouvre à la première présence et se ferme sur
        la séance qui complète le pack — et se règle mois par mois, indépendamment des autres.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {emplois.map((e, i) => (
          <motion.button
            key={e.sessionId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            onClick={() => onPick(e.sessionId)}
            className="group overflow-hidden rounded-2xl border border-line bg-surface text-start transition-all hover:border-primary/50 hover:shadow-md"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 bg-gradient-to-r from-primary-50/70 to-transparent p-4">
              <div className="min-w-0">
                <strong className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                  📚 {e.title}
                  {e.isOpen && (
                    <Badge tone="success" className="text-[9px]">
                      Séance libre
                    </Badge>
                  )}
                  {e.archived && (
                    <Badge
                      tone="neutral"
                      className="text-[9px]"
                      title="Emploi du temps supprimé — il ne tient plus séance, mais ce qu'il vous doit reste dû"
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

            <div className="grid grid-cols-3 gap-2 px-4 pt-3">
              <MiniStat label="Payable" value={formatDA(e.payable)} tone="text-success" />
              <MiniStat
                label="Retenu"
                value={formatDA(e.withheld)}
                tone={e.withheld > 0 ? "text-danger" : "text-muted"}
              />
              <MiniStat label="Déjà réglé" value={formatDA(e.settled)} tone="text-primary" />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 p-4 pt-3">
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
              {e.studentsInDebt > 0 && (
                <Badge tone="danger" className="gap-1 text-[10px] font-bold">
                  <AlertTriangle className="h-3 w-3" />
                  {e.studentsInDebt} élève(s) en retard de paiement
                </Badge>
              )}
            </div>

            {e.alerts.length > 0 && (
              <div className="space-y-1 border-t border-line bg-canvas/40 px-4 py-2.5">
                {e.alerts.map((a, k) => (
                  <span
                    key={k}
                    className={`block text-[10px] leading-relaxed ${
                      a.tone === "danger"
                        ? "text-danger"
                        : a.tone === "warning"
                          ? "text-warning"
                          : a.tone === "success"
                            ? "text-success"
                            : "text-primary"
                    }`}
                  >
                    • {a.text}
                  </span>
                ))}
              </div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Mes mois, M1 → M12
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
          <ArrowLeft className="h-3.5 w-3.5" /> Mes emplois du temps
        </Button>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <Legend tone="paid" /> <Legend tone="payable" /> <Legend tone="running" />
          <Legend tone="blocked" /> <Legend tone="empty" />
        </div>
      </div>

      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-50/70 to-transparent p-4">
        <strong className="block text-sm text-ink">
          {emploi.title} — Groupe {emploi.groupName}
        </strong>
        <span className="block text-[11px] text-muted">
          {emploi.size} séances par mois ·{" "}
          {emploi.priced ? (
            <>
              votre part <strong className="text-primary">{formatDA(emploi.perSeance)}</strong> par
              séance, soit {formatDA(money(emploi.perSeance * emploi.size))} le mois complet
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
          c&apos;est le mois qui vient de se terminer qui se règle, pas celui d&apos;aujourd&apos;hui.
          Cliquez un mois pour en lire le détail.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <MonthCard key={t.code} tile={t} delay={Math.min(i * 0.03, 0.35)} onClick={() => onPick(t.code)} />
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

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-black text-ink">
          {tile.held}/{tile.size}
        </span>
        <span className="text-[10px] text-muted">séances</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/60">
        <motion.div
          className={`h-full ${style.bar}`}
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
              <CheckCircle2 className="h-3 w-3" /> Reçu
            </span>
            <strong className="font-mono">{formatDA(tile.paid)}</strong>
          </span>
        ) : tile.payable > 0 ? (
          <span className="flex items-center justify-between text-primary">
            <span>À me régler</span>
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
        {tile.passagerCount > 0 && (
          <span className="flex items-center justify-between text-primary">
            <span className="flex items-center gap-1">
              <Ticket className="h-3 w-3" /> Passagers
            </span>
            <strong className="font-mono">{tile.passagerCount}</strong>
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
// 3. Le mois ouvert — les trois tables et le net, en lecture
// ---------------------------------------------------------------------------

function MonthBoardView({
  teacher,
  emploi,
  monthCode,
  onBack,
}: {
  teacher: Teacher;
  emploi: TeacherEmploi;
  monthCode: string;
  onBack: () => void;
}) {
  const db = useData();

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

  const settlement = board.settlement;
  const unpaidRows = board.students.filter((r) => r.debt > 0);
  const gross = money(board.studentsTotal + board.arrearsTotal + board.passagersTotal);
  const net = money(gross - board.deductionsTotal);

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
          <Badge
            tone={board.held >= board.size ? "success" : "warning"}
            className="font-mono font-bold"
          >
            {monthCodeLabel(monthCode)} — {board.held}/{board.size} séances
          </Badge>
        </div>
      </div>

      {/* ---- ce mois m'a-t-il déjà été réglé ? ---------------------------- */}
      {settlement ? (
        <div className="rounded-2xl border-2 border-success/40 bg-gradient-to-r from-success/15 to-success/5 p-4">
          <strong className="flex items-center gap-1.5 text-sm text-success">
            <ShieldCheck className="h-4 w-4" /> Ce mois vous a été réglé —{" "}
            {formatDA(settlement.amount)} nets
          </strong>
          <span className="mt-0.5 block text-[11px] text-muted">
            Le {formatDateFr(settlement.paidAt.slice(0, 10))}
            {settlement.gross != null ? ` · brut ${formatDA(settlement.gross)}` : ""} · Reçu N° PAY-
            {settlement.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-muted">
            Les tables ci-dessous montrent ce que ce mois représente{" "}
            <strong className="text-ink">aujourd&apos;hui</strong>. Si des élèves ont payé depuis, ou
            si des séances libres sont tombées ici, ces parts vous reviennent sur le{" "}
            <strong className="text-ink">règlement suivant</strong>, dans sa table « Retards de
            paiement &amp; séances libres » — le mois lui-même ne se repaie jamais deux fois.
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-primary/30 bg-primary-50/50 p-3 text-[11px] leading-relaxed text-primary">
          Ce mois n&apos;a pas encore été réglé. Ce que les tables affichent est ce qu&apos;il vous
          rapportera : le montant définitif est arrêté par l&apos;administration au moment du
          versement.
        </div>
      )}

      {/* ---- le résumé, toujours visible ---------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Élèves du mois"
          value={String(board.students.length)}
          hint={`${board.students.length - unpaidRows.length} à jour · ${unpaidRows.length} en dette`}
        />
        <Stat label="Table 1 — élèves" value={formatDA(board.studentsTotal)} tone="text-success" />
        <Stat
          label="Table 2 — retards"
          value={formatDA(board.arrearsTotal)}
          tone="text-primary"
          hint={`${board.arrears.length} ligne(s)`}
        />
        <Stat
          label="Table 2 — séances libres"
          value={formatDA(board.passagersTotal)}
          tone="text-primary"
          hint={`${board.passagers.length} passager(s)`}
        />
        <Stat
          label="Table 3 — retenues"
          value={formatDA(board.deductionsTotal)}
          tone={board.deductionsTotal > 0 ? "text-danger" : "text-muted"}
        />
        <Stat label="Net estimé" value={formatDA(net)} tone="text-ink" />
      </div>

      {/* ---- LES ÉLÈVES QUI N'ONT PAS PAYÉ, EN TÊTE D'ÉCRAN --------------- */}
      {unpaidRows.length > 0 && (
        <div className="space-y-2 rounded-2xl border-2 border-danger/40 bg-danger/5 p-3">
          <strong className="flex items-center gap-1.5 text-sm text-danger">
            <AlertTriangle className="h-4 w-4" />
            {unpaidRows.length} élève(s) n&apos;ont pas soldé {monthCode} —{" "}
            {formatDA(money(unpaidRows.reduce((sum, r) => sum + r.debt, 0)))} manquants
          </strong>
          <p className="text-[11px] leading-relaxed text-muted">
            Tant que la séance qui l&apos;a produite n&apos;est pas payée, la part qu&apos;elle vous
            rapporte reste <strong className="text-ink">retenue</strong>. Elle ne se perd pas : elle
            vous revient automatiquement, dans les <em>retards de paiement</em> du règlement
            suivant, le jour où l&apos;élève s&apos;acquitte. L&apos;encaissement se fait au guichet
            — vous n&apos;avez rien à faire depuis cet écran.
          </p>
          <div className="overflow-x-auto rounded-xl border border-danger/25 bg-surface">
            <table className="w-full min-w-[560px] text-[11px]">
              <thead className="bg-canvas/60">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-1.5">Élève</th>
                  <th className="px-2 py-1.5 text-center">Séances</th>
                  <th className="px-2 py-1.5 text-center">Statut</th>
                  <th className="px-2 py-1.5 text-right">Doit sur {monthCode}</th>
                  <th className="px-2 py-1.5 text-right">Part retenue</th>
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
                    <td className="px-2 py-1.5 text-center">
                      <Badge
                        tone={(PAY_STATE_LABEL[r.payState] ?? PAY_STATE_LABEL.pending).tone}
                        className="text-[9px]"
                      >
                        {(PAY_STATE_LABEL[r.payState] ?? PAY_STATE_LABEL.pending).label}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold text-danger">
                      {formatDA(r.debt)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-warning">
                      {r.withheld ? formatDA(r.amount) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================== TABLE 1 — LES ÉLÈVES DU MOIS ================== */}
      <section className="overflow-hidden rounded-2xl border-2 border-primary/30">
        <div className="bg-gradient-to-r from-primary-50 to-transparent p-3">
          <strong className="flex items-center gap-1.5 text-sm text-ink">
            <Users className="h-4 w-4 text-primary" /> 1. Élèves de {monthCode} (
            {board.students.length})
          </strong>
          <span className="block text-[11px] leading-relaxed text-muted">
            Votre part : {formatDA(board.teacherMonthShare)} le mois ÷ {board.size} séances ={" "}
            <strong className="text-primary">{formatDA(board.perSeance)}</strong> la séance. La
            colonne « Ma part » multiplie ce tarif par les séances payables de chaque élève, au
            centime — une séance ne devient payable que lorsque l&apos;élève l&apos;a payée sur ce
            mois.
          </span>
        </div>

        <div className="overflow-x-auto bg-surface">
          <table className="w-full min-w-[960px] text-[11px]">
            <thead className="bg-canvas/70">
              <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                <th className="px-2 py-2">N°</th>
                <th className="px-2 py-2">Élève</th>
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
                <th className="px-2 py-2 text-right">Ma part</th>
              </tr>
            </thead>
            <tbody>
              {board.students.length === 0 ? (
                <tr>
                  <td
                    colSpan={9 + board.size}
                    className="px-3 py-8 text-center text-xs italic text-muted"
                  >
                    Aucun élève sur {monthCode} — ce mois n&apos;a encore rien produit.
                  </td>
                </tr>
              ) : (
                board.students.map((r) => <StudentLine key={r.studentId} row={r} size={board.size} />)
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-canvas/60">
                <td
                  colSpan={8 + board.size}
                  className="px-2 py-2.5 text-right text-[11px] font-bold text-ink"
                >
                  TOTAL — ce que ce mois vous rapporte
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-success">
                  {formatDA(board.studentsTotal)}
                </td>
              </tr>
              {board.withheldTotal > 0 && (
                <tr className="bg-warning/10">
                  <td
                    colSpan={8 + board.size}
                    className="px-2 py-2 text-right text-[10px] font-bold text-warning"
                  >
                    Retenu (élèves encore en dette) — vous revient dès qu&apos;ils auront payé
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs font-bold text-warning">
                    {formatDA(board.withheldTotal)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </section>

      {/* ========= TABLE 2 — RETARDS DE PAIEMENT & SÉANCES LIBRES ========== */}
      <section className="overflow-hidden rounded-2xl border-2 border-success/40">
        <div className="bg-gradient-to-r from-success/15 to-transparent p-3">
          <strong className="flex items-center gap-1.5 text-sm text-success">
            <HandCoins className="h-4 w-4" /> 2. Retards de paiement &amp; séances libres (
            {board.arrears.length + board.passagers.length})
          </strong>
          <span className="block text-[11px] leading-relaxed text-muted">
            Deux natures, un même principe : ce que ce règlement vous doit{" "}
            <strong className="text-ink">en dehors des élèves du mois</strong>. Les{" "}
            <strong className="text-ink">retards</strong> appartiennent à des mois déjà réglés — la
            part avait été retenue, l&apos;élève s&apos;est acquitté depuis. Les{" "}
            <strong className="text-ink">séances libres</strong> sont celles des élèves de passage :
            payées d&apos;avance, elles reviennent au mois où elles sont tombées.
          </span>
        </div>

        {/* ---- 2a. les retards de paiement ------------------------------- */}
        <div className="border-t border-line bg-canvas/50 px-3 py-2">
          <strong className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink">
            <Clock className="h-3.5 w-3.5 text-success" /> 2a. Retards de paiement —{" "}
            {board.arrears.length} ligne(s)
          </strong>
        </div>

        {board.arrears.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-xs italic text-muted">
            Aucun retard de paiement à rattraper sur cet emploi du temps.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[820px] text-[11px]">
              <thead className="bg-canvas/70">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
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
                {board.arrears.map((r) => (
                  <tr key={r.key} className="border-t border-line/60 hover:bg-success/5">
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
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={7} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES RETARDS DE PAIEMENT RATTRAPÉS
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-success">
                    {formatDA(board.arrearsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ---- 2b. les séances libres du mois ---------------------------- */}
        <div className="border-t border-line bg-canvas/50 px-3 py-2">
          <strong className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink">
            <Ticket className="h-3.5 w-3.5 text-primary" /> 2b. Séances libres de {monthCode} —{" "}
            {board.passagers.length} passager(s)
          </strong>
          <span className="block text-[10px] text-muted">
            Prix payé par le passager − part de l&apos;école ={" "}
            <strong className="text-primary">votre part</strong>. Encaissé :{" "}
            {formatDA(board.passagersRevenue)} · pour l&apos;école{" "}
            {formatDA(money(board.passagersRevenue - board.passagersTotal))} · pour vous{" "}
            {formatDA(board.passagersTotal)}.
          </span>
        </div>

        {board.passagers.length === 0 ? (
          <p className="bg-surface px-3 py-5 text-center text-xs italic text-muted">
            Aucune séance libre sur {monthCode} — aucun élève de passage n&apos;est venu sur ce mois.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[700px] text-[11px]">
              <thead className="bg-canvas/70">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">Date &amp; horaire</th>
                  <th className="px-2 py-2">Élève de passage</th>
                  <th className="px-2 py-2">Séance</th>
                  <th className="px-2 py-2 text-right">Prix payé</th>
                  <th className="px-2 py-2 text-right">Part école</th>
                  <th className="px-2 py-2 text-right">Ma part</th>
                </tr>
              </thead>
              <tbody>
                {board.passagers.map((r) => (
                  <tr key={r.id} className="border-t border-line/60 hover:bg-primary-50/30">
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
                          title="Séance enregistrée avant le partage école / enseignant : l'école gardait tout."
                        >
                          part non répartie
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-primary">
                      {formatDA(r.teacherShare)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={5} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES SÉANCES LIBRES
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-primary">
                    {formatDA(board.passagersTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== TABLE 3 — LES RETENUES ======================== */}
      <section className="overflow-hidden rounded-2xl border-2 border-danger/30">
        <div className="bg-gradient-to-r from-danger/15 to-transparent p-3">
          <strong className="flex items-center gap-1.5 text-sm text-danger">
            <Receipt className="h-4 w-4" /> 3. Retenues sur cette paie ({board.deductions.length})
          </strong>
          <span className="block text-[11px] leading-relaxed text-muted">
            Les dépenses que l&apos;école a avancées pour vous, vos acomptes, la scolarité{" "}
            <strong className="text-ink">encore due</strong> de vos enfants sur leurs emplois du
            temps, et celle que le guichet a{" "}
            <strong className="text-ink">déjà créditée en la portant sur ce salaire</strong>. Les
            lignes déjà réglées restent affichées, marquées comme telles : c&apos;est ce qui permet
            de vérifier qu&apos;on ne vous retient rien deux fois.
          </span>
        </div>

        {board.deductions.length === 0 ? (
          <p className="bg-surface px-3 py-6 text-center text-xs italic text-muted">
            Aucune dépense, aucun acompte, aucune scolarité d&apos;enfant à retenir.
          </p>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <table className="w-full min-w-[680px] text-[11px]">
              <thead className="bg-canvas/70">
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Nature</th>
                  <th className="px-2 py-2">Libellé</th>
                  <th className="px-2 py-2 text-center">Statut</th>
                  <th className="px-2 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {board.deductions.map((d) => {
                  const kind = DED_KIND[d.kind];
                  return (
                    <tr
                      key={d.id}
                      className={`border-t border-line/60 ${d.paid ? "opacity-60" : "hover:bg-danger/5"}`}
                    >
                      <td className="px-2 py-2 font-mono text-[10px] text-muted">
                        {d.date ? formatDateFr(d.date) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={kind.tone} className="gap-1 text-[9px]">
                          {kind.icon} {kind.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <DeductionLabel row={d} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge tone={d.paid ? "success" : "warning"} className="text-[9px]">
                          {d.paid ? "Déjà retenue" : "À retenir"}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-danger">
                        − {formatDA(d.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-canvas/60">
                  <td colSpan={4} className="px-2 py-2.5 text-right text-[11px] font-bold text-ink">
                    TOTAL DES RETENUES
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-black text-danger">
                    − {formatDA(board.deductionsTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* =================== LE RÉSUMÉ ===================================== */}
      <section className="space-y-3 rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary-50/70 to-transparent p-4">
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
          Résumé — {emploi.title} · {monthCodeLabel(monthCode)}
        </span>

        <div className="space-y-1.5">
          <SummaryLine
            label={`Table 1 — élèves de ${monthCode} (${board.students.length})`}
            value={formatDA(board.studentsTotal)}
            tone="text-ink"
          />
          {board.withheldTotal > 0 && (
            <SummaryLine
              label={`· dont retenu (${unpaidRows.length} élève(s) en dette) — vous reviendra en retard de paiement`}
              value={`(${formatDA(board.withheldTotal)})`}
              tone="text-warning"
            />
          )}
          <SummaryLine
            label={`Table 2a — retards de paiement rattrapés (${board.arrears.length})`}
            value={formatDA(board.arrearsTotal)}
            tone="text-success"
          />
          <SummaryLine
            label={`Table 2b — séances libres (${board.passagers.length} passager(s))`}
            value={formatDA(board.passagersTotal)}
            tone="text-primary"
          />
          <div className="border-t border-line pt-1.5">
            <SummaryLine
              label="TOTAL BRUT — table 1 + table 2a + table 2b"
              value={formatDA(gross)}
              tone="text-primary"
            />
          </div>
          {(["expense", "acompte", "child", "child_debt"] as const).map((kind) => {
            const rows = board.deductions.filter((d) => d.kind === kind && d.selectable);
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
            label="Table 3 — total des retenues"
            value={`− ${formatDA(board.deductionsTotal)}`}
            tone="text-danger"
          />
          <div className="flex items-center justify-between border-t-2 border-primary/40 pt-2">
            <strong className="text-sm text-ink">
              {settlement ? "NET QUI VOUS A ÉTÉ VERSÉ" : "NET ESTIMÉ POUR CE MOIS"}
            </strong>
            <strong className="font-mono text-xl font-black text-primary">
              {formatDA(settlement ? settlement.amount : net)}
            </strong>
          </div>
          {settlement && settlement.amount !== net && (
            <p className="text-[10px] leading-relaxed text-muted">
              Le net figé du règlement fait foi. Ce que les tables affichent aujourd&apos;hui (
              {formatDA(net)}) peut différer : des élèves ont payé depuis, ou des séances libres
              sont tombées sur ce mois — cela vous revient sur le règlement suivant.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StudentLine({ row, size }: { row: BoardStudent; size: number }) {
  const state = PAY_STATE_LABEL[row.payState] ?? PAY_STATE_LABEL.pending;
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`border-t border-line/60 align-middle transition-colors ${
        row.schoolCovered ? "bg-danger/10" : row.withheld ? "bg-warning/5" : "hover:bg-primary-50/30"
      }`}
    >
      <td className="px-2 py-2 font-mono text-[10px] text-muted">{row.registrationNumber || "—"}</td>
      <td className="px-2 py-2">
        <strong className="block text-ink">{row.name}</strong>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {row.caseLabel && (
            <Badge tone="warning" className="text-[8px]">
              {row.caseLabel}
            </Badge>
          )}
          {row.schoolCovered && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[8px] font-bold text-white"
              title="L'école a avancé la dette de cet élève sur sa propre caisse — votre part a été débloquée par elle"
            >
              <AlertTriangle className="h-2.5 w-2.5" /> avancé par l&apos;école
            </span>
          )}
          {row.phone && <span className="text-[9px] text-muted">{row.phone}</span>}
        </div>
      </td>
      <SlotCells slots={row.slots ?? Array.from({ length: size }, () => null)} />
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
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-warning"
            title="Part retenue : cet élève n'a pas payé les séances qui l'ont produite"
          >
            <Lock className="h-3 w-3" /> {formatDA(row.amount)}
          </span>
        ) : (
          <strong className="font-mono text-success">{formatDA(row.amount)}</strong>
        )}
        {row.alreadyPaid > 0 && (
          <span className="block text-[9px] text-muted">déjà reçu {formatDA(row.alreadyPaid)}</span>
        )}
      </td>
    </motion.tr>
  );
}

function SlotCells({ slots }: { slots: (string | null)[] }) {
  return (
    <>
      {slots.map((v, i) => {
        const style = v ? SLOT_STYLE[v] : undefined;
        return (
          <td key={i} className="px-1 py-2 text-center">
            <span
              title={
                style ? `Séance ${i + 1} — ${style.label}` : `Séance ${i + 1} — pas encore pointée`
              }
              className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border text-[11px] font-black ${
                style?.cls ?? "border-line bg-canvas text-muted/50"
              }`}
            >
              {style ? style.short : "–"}
            </span>
          </td>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
//  Acomptes & retenues — le grand livre de ce qui se reprend sur ma paie
// ---------------------------------------------------------------------------

/** Une ligne du grand livre, quelle que soit sa nature. */
interface LedgerLine {
  id: string;
  kind: "acompte" | "expense" | "absence" | "child_debt";
  date: string;
  label: string;
  description?: string;
  /** scolarité d'un enfant : l'emploi du temps qu'elle paie, nommé */
  emploi?: string;
  /** et le mois de cet emploi du temps */
  monthCode?: string;
  amount: number;
  /** déjà reprise sur un règlement — elle ne reviendra jamais sur le suivant */
  paid: boolean;
}

const LEDGER_KIND: Record<
  LedgerLine["kind"],
  { label: string; tone: Tone; icon: React.ReactNode; hint: string }
> = {
  acompte: {
    label: "Acompte",
    tone: "primary",
    icon: <Wallet className="h-3 w-3" />,
    hint: "Une avance déjà versée : elle se déduit du prochain règlement.",
  },
  expense: {
    label: "Dépense avancée",
    tone: "warning",
    icon: <Receipt className="h-3 w-3" />,
    hint: "L'école a payé quelque chose pour vous et le reprend sur la paie.",
  },
  absence: {
    label: "Absence / pénalité",
    tone: "danger",
    icon: <AlertTriangle className="h-3 w-3" />,
    hint: "Une retenue enregistrée sur votre fiche par l'administration.",
  },
  child_debt: {
    label: "Scolarité d'enfant",
    tone: "danger",
    icon: <GraduationCap className="h-3 w-3" />,
    hint:
      "La scolarité d'un de vos enfants, réglée d'avance au guichet et portée sur ce salaire. " +
      "L'emploi du temps payé est nommé à côté : c'est le cours de votre enfant que cette retenue règle.",
  },
};

function LedgerView({
  acomptes,
  expenses,
  absences,
  childDebts,
}: {
  acomptes: TeacherAcompte[];
  expenses: TeacherExpense[];
  absences: TeacherAbsence[];
  childDebts: TeacherChildDebt[];
}) {
  const db = useData();
  const emploiOf = (d: TeacherChildDebt) => teacherChildDebtEmploi(db, d);

  const lines: LedgerLine[] = [
    ...acomptes.map(
      (a): LedgerLine => ({
        id: `ac-${a.id}`,
        kind: "acompte",
        date: a.date.slice(0, 10),
        label: "Acompte sur salaire",
        description: a.description,
        amount: a.amount,
        paid: !!a.paid,
      }),
    ),
    ...expenses.map(
      (e): LedgerLine => ({
        id: `ex-${e.id}`,
        kind: "expense",
        date: e.date,
        label: e.name,
        description: e.description,
        amount: e.amount,
        paid: !!e.paid,
      }),
    ),
    // Une pénalité d'absence ne passe par aucun tableau de mois : c'est ici, et
    // seulement ici, que l'enseignant peut la lire.
    ...absences.map(
      (a): LedgerLine => ({
        id: `ab-${a.id}`,
        kind: "absence",
        date: a.date,
        label: a.description || "Absence non justifiée",
        amount: a.cost,
        paid: false,
      }),
    ),
    // La scolarité d'un enfant, avec le COURS qu'elle paie : c'est la seule
    // page où le père peut lire, avant même sa paie, pour quel emploi du temps
    // de son fils l'école va le retenir.
    ...childDebts.map(
      (d): LedgerLine => ({
        id: `cd-${d.id}`,
        kind: "child_debt",
        date: d.date,
        label: d.label,
        emploi: emploiOf(d),
        monthCode: d.monthCode,
        description: "réglée d'avance au guichet",
        amount: d.amount,
        paid: !!d.paid,
      }),
    ),
  ].sort((a, b) => Number(a.paid) - Number(b.paid) || b.date.localeCompare(a.date));

  const pending = money(lines.filter((l) => !l.paid).reduce((s, l) => s + l.amount, 0));
  const cleared = money(lines.filter((l) => l.paid).reduce((s, l) => s + l.amount, 0));
  const absenceTotal = money(absences.reduce((s, a) => s + a.cost, 0));

  if (lines.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line py-14 text-center text-xs font-bold text-muted">
        Rien n&apos;est retenu sur votre paie : aucun acompte, aucune dépense avancée, aucune
        pénalité.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Lignes enregistrées" value={String(lines.length)} />
        <Stat
          label="Encore à reprendre"
          value={formatDA(pending)}
          tone={pending > 0 ? "text-danger" : "text-muted"}
          hint="sur vos prochains règlements"
        />
        <Stat label="Déjà repris" value={formatDA(cleared)} tone="text-muted" hint="sur une paie passée" />
        <Stat
          label="Pénalités d'absence"
          value={formatDA(absenceTotal)}
          tone={absenceTotal > 0 ? "text-danger" : "text-muted"}
          hint={`${absences.length} ligne(s)`}
        />
      </div>

      <p className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-relaxed text-warning">
        Voici, en clair, tout ce que l&apos;école reprend sur votre paie. Une ligne{" "}
        <strong>« déjà reprise »</strong> a été déduite d&apos;un règlement précédent et ne
        reviendra jamais sur le suivant — c&apos;est ce qui garantit qu&apos;on ne vous retient rien
        deux fois. Une ligne <strong>« à reprendre »</strong> tombera sur votre prochain règlement.
        Pour la scolarité d&apos;un de vos enfants, <strong>l&apos;emploi du temps payé est nommé</strong>{" "}
        avec son mois : vous savez de quel cours de votre enfant vient chaque dinar retenu.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-[11px]">
          <thead className="bg-canvas/70">
            <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Nature</th>
              <th className="px-3 py-2.5">Libellé</th>
              <th className="px-3 py-2.5 text-center">Statut</th>
              <th className="px-3 py-2.5 text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const kind = LEDGER_KIND[l.kind];
              return (
                <motion.tr
                  key={l.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.25) }}
                  className={`border-t border-line/60 ${l.paid ? "opacity-60" : "hover:bg-danger/5"}`}
                >
                  <td className="px-3 py-2.5 font-mono text-[10px] text-muted">
                    {l.date ? formatDateFr(l.date) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={kind.tone} className="gap-1 text-[9px]" title={kind.hint}>
                      {kind.icon} {kind.label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <strong className="block text-ink">{l.label}</strong>
                    {l.kind === "child_debt" && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge
                          tone={l.emploi ? "primary" : "neutral"}
                          className="gap-1 text-[9px]"
                          title={
                            l.emploi
                              ? `Scolarité de votre enfant sur l'emploi du temps « ${l.emploi} »`
                              : "Somme sans emploi du temps rattaché : des restes ou des frais"
                          }
                        >
                          <GraduationCap className="h-3 w-3" />
                          {l.emploi ?? "Hors emploi du temps"}
                        </Badge>
                        {l.monthCode && (
                          <Badge tone="neutral" className="gap-1 font-mono text-[9px]">
                            <CalendarClock className="h-3 w-3" />
                            {l.monthCode}
                          </Badge>
                        )}
                      </span>
                    )}
                    {l.description && (
                      <span className="block text-[9px] text-muted">{l.description}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Badge tone={l.paid ? "success" : "warning"} className="text-[9px]">
                      {l.paid ? "Déjà reprise" : "À reprendre"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-danger">
                    − {formatDA(l.amount)}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Mes règlements reçus — l'historique, et la photographie de chacun
// ---------------------------------------------------------------------------

/**
 * LES ENFANTS SCOLARISÉS SUR CE RÈGLEMENT — et l'emploi du temps de chacun.
 *
 * Un règlement peut retenir la scolarité d'un enfant de deux façons, et le père
 * doit lire les deux au même endroit :
 *
 *  - `childCharges` : ce que ce règlement a soldé lui-même. Chaque ligne porte
 *    déjà son emploi du temps et son mois ;
 *  - `childDebts`   : ce que le guichet avait crédité D'AVANCE, en le portant
 *    sur ce salaire. Les règlements récents en figent l'emploi du temps ; pour
 *    les plus anciens, il se relit depuis la ligne d'origine, qui n'est jamais
 *    effacée — seulement marquée réglée.
 *
 * Sans cet écran, un père voyait « Scolarité — Yacine : −1 500 DA » sans jamais
 * savoir lequel des trois cours de son fils il venait de payer.
 */
function ChildSettlementBlock({ payment }: { payment: TeacherPayment }) {
  const db = useData();
  const rows = settlementChildLines(db, payment);
  if (rows.length === 0) return null;
  const total = money(rows.reduce((s, r) => s + r.amount, 0));

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-primary/30">
      <div className="bg-gradient-to-r from-primary/15 to-transparent p-3">
        <strong className="flex items-center gap-1.5 text-sm text-primary">
          <GraduationCap className="h-4 w-4" /> Scolarité de vos enfants sur ce règlement (
          {rows.length})
        </strong>
        <span className="block text-[11px] leading-relaxed text-muted">
          Chaque ligne dit <strong className="text-ink">quel emploi du temps</strong> de votre enfant
          a été payé, et <strong className="text-ink">quel mois</strong> de cet emploi. C&apos;est
          exactement ce qui a été repris sur votre net ce jour-là — une fois, et une seule.
        </span>
      </div>
      <div className="overflow-x-auto bg-surface">
        <table className="w-full min-w-[620px] text-[11px]">
          <thead className="bg-canvas/70">
            <tr className="text-left text-[9px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">Enfant</th>
              <th className="px-3 py-2.5">Emploi du temps</th>
              <th className="px-3 py-2.5 text-center">Mois</th>
              <th className="px-3 py-2.5">Origine</th>
              <th className="px-3 py-2.5 text-right">Retenu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line/60">
                <td className="px-3 py-2.5">
                  <strong className="block text-ink">{r.studentName}</strong>
                  {r.registrationNumber && (
                    <span className="block font-mono text-[9px] text-muted">
                      N° {r.registrationNumber}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={r.emploi ? "primary" : "neutral"} className="gap-1 text-[9px]">
                    <GraduationCap className="h-3 w-3" />
                    {r.emploi ?? "Hors emploi du temps"}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.monthCode ? (
                    <Badge tone="neutral" className="font-mono text-[9px]">
                      {r.monthCode}
                    </Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[10px] text-muted">
                  {r.origin === "advanced"
                    ? "Réglée d'avance au guichet"
                    : "Soldée par ce règlement"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-danger">
                  − {formatDA(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-canvas/60">
              <td colSpan={4} className="px-3 py-2.5 text-right text-[11px] font-bold text-ink">
                TOTAL DES SCOLARITÉS
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-sm font-black text-danger">
                − {formatDA(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function SettlementList({ settlements }: { settlements: TeacherPayment[] }) {
  const db = useData();
  const [viewed, setViewed] = useState<TeacherPayment | null>(null);

  if (settlements.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line py-14 text-center text-xs font-bold text-muted">
        Aucun règlement ne vous a encore été versé.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="rounded-2xl border border-success/30 bg-success/10 p-3 text-[11px] leading-relaxed text-success">
        Chaque règlement garde la <strong>photographie exacte</strong> des tables qui l&apos;ont
        produit, le jour où il a été versé. Un élève qui change de groupe ou un tarif corrigé depuis
        n&apos;y changent rien : ce que vous lisez ici est ce qui vous a été payé ce jour-là.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {settlements.map((p, i) => {
          const month = p.board?.monthCode ?? p.months?.[0]?.monthCode;
          const emploiTitle = p.board?.emploi ?? p.months?.[0]?.title;
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.3) }}
              onClick={() => setViewed(p)}
              className="group overflow-hidden rounded-2xl border border-line bg-surface text-start transition-all hover:border-success/50 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 bg-gradient-to-r from-success/12 to-transparent p-4">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-ink">{p.description}</strong>
                  <span className="block text-[10px] text-muted">
                    {formatDateFr(p.paidAt.slice(0, 10))} · Reçu N° PAY-
                    {p.id.slice(0, 8).toUpperCase()}
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {emploiTitle && (
                      <Badge tone="primary" className="text-[9px]">
                        {emploiTitle}
                      </Badge>
                    )}
                    {month && (
                      <Badge tone="success" className="font-mono text-[9px]">
                        {month}
                      </Badge>
                    )}
                    {p.board && (
                      <Badge tone="neutral" className="text-[9px]">
                        détail complet
                      </Badge>
                    )}
                    {/* La scolarité d'un enfant retenue sur ce règlement, avec
                        SON emploi du temps : lisible sans ouvrir la carte. */}
                    {settlementChildLines(db, p).map((l) => (
                      <Badge key={l.key} tone="danger" className="text-[9px]">
                        🎓 {settlementChildLabel(l)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">
                    Net reçu
                  </span>
                  <strong className="block font-mono text-lg font-black text-success">
                    {formatDA(p.amount)}
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 p-4 pt-3">
                <MiniStat
                  label="Brut"
                  value={formatDA(p.gross ?? p.amount)}
                  tone="text-ink"
                />
                <MiniStat label="Présences" value={String(p.studentsCount)} tone="text-primary" />
                <MiniStat label="Créneaux" value={String(p.sessionsCount)} tone="text-primary" />
              </div>
            </motion.button>
          );
        })}
      </div>

      {viewed && (
        <Modal
          open
          full
          onClose={() => setViewed(null)}
          title={`Règlement du ${formatDateFr(viewed.paidAt.slice(0, 10))} — ${formatDA(viewed.amount)}`}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Net reçu" value={formatDA(viewed.amount)} tone="text-success" />
              <Stat label="Brut des séances" value={formatDA(viewed.gross ?? viewed.amount)} />
              <Stat label="Présences" value={String(viewed.studentsCount)} tone="text-primary" />
              <Stat label="Créneaux réglés" value={String(viewed.sessionsCount)} tone="text-primary" />
            </div>

            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <span className="font-semibold text-ink">{viewed.description}</span>
              <span className="mt-1 block text-[10px] text-muted">
                Mode :{" "}
                {viewed.method === "percent"
                  ? `pourcentage (${viewed.percentage ?? 0} %)`
                  : viewed.method === "group"
                    ? "par groupe — tarif de chaque emploi du temps"
                    : "montant fixe"}
                {" · "}Reçu N° PAY-{viewed.id.slice(0, 8).toUpperCase()}
              </span>
            </div>

            {/* CE QUE MES ENFANTS ONT COÛTÉ SUR CE RÈGLEMENT, cours par cours.

                La table 3 du board figé les liste déjà, mais elle n'existe que
                pour les règlements récents — et un père veut pouvoir ouvrir
                N'IMPORTE lequel de ses règlements et y lire tout de suite pour
                quel emploi du temps de son fils on l'a retenu. */}
            <ChildSettlementBlock payment={viewed} />

            {viewed.board ? (
              <PayBoardView board={viewed.board} />
            ) : (
              <p className="rounded-xl border border-dashed border-line py-8 text-center text-[11px] italic text-muted">
                Ce règlement a été enregistré avant l&apos;écran « un mois à la fois » : il n&apos;en
                garde pas le détail table par table.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeadStat({
  label,
  value,
  tone = "text-ink",
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface px-3 py-2.5 text-center">
      <span className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
        {icon} {label}
      </span>
      <strong className={`mt-0.5 block font-mono text-sm font-black ${tone}`}>{value}</strong>
    </div>
  );
}

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
