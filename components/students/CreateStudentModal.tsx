"use client";

/**
 * "Nouvel élève" — the ONE student screen of the app, for creating AND for
 * editing. Passing a `student` turns it into "Modifier l'élève": exactly the
 * same fields, pre-filled, with the identity, the cas, les emplois du temps et
 * les soldes tous modifiables, plus l'identifiant et le mot de passe du
 * portail que seule une fiche existante possède.
 *
 * Used from the Élèves page, from the dashboard, and from a group's présence
 * sheet (where the emploi du temps of the group arrives pre-ticked).
 *
 * Reception types the identity, picks the billing case, ticks the emplois du
 * temps the student follows and — for EACH of them — L'AVANCE que la famille
 * verse aujourd'hui : cet argent devient le SOLDE d'ouverture de cet emploi.
 *
 * L'enregistrement propose alors DEUX documents, dans cet ordre :
 *  1. le REÇU DE L'AVANCE, dès qu'un dinar a été versé — c'est une entrée
 *     d'argent, elle mérite sa propre pièce, avec le mois crédité et le solde
 *     qui en résulte emploi par emploi. Le versement part en même temps dans la
 *     caisse et dans l'historique des paiements de l'élève ;
 *  2. le BON D'INSCRIPTION, qui récapitule l'identité, les emplois du temps et
 *     ce qui a été versé sur chacun.
 *
 * La GRATUITÉ se coche emploi du temps par emploi du temps : un « cas spécial »
 * arrive avec tous ses emplois cochés « offert », et décocher l'un d'eux le
 * rend payant — l'école et l'enseignant sont alors réglés pour ce module-là
 * comme pour n'importe quel élève.
 *
 * A child never starts an emploi at its séance 1: he comes in WHERE THE GROUP
 * STANDS. Registered while the group lives its 2nd month on its 3rd séance, he
 * is written on M2 · séance 3 — his solde is credited to M2, the two séances
 * that opened that month stay blank on his row, and M1 never lists him.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { BookOpen, Building2, Check, Gift, Percent, Trash2, Wallet } from "lucide-react";
import { createRoleUser, resetUserPassword, updateUserEmail } from "@/lib/accounts/users";
import { formatDA } from "@/lib/utils";
import {
  inscriptionVoucherHtml,
  soldReceiptHtml,
  type SoldReceiptLine,
} from "@/lib/reports/documents";
import { PrintAsk } from "@/components/attendance/PresenceSheet";
import {
  ClassTimingPicker,
  toggleTimingSelection,
  useClassTimings,
  type ClassTimingOption,
  type TimingScope,
} from "@/components/students/ClassTimingPicker";
import {
  cycleSizeOf,
  joinPointFor,
  studentDebtSummary,
  schoolPerSeanceOf,
  studentListPrice,
  studentSchoolPerSeance,
  studentTeacherPerSeance,
  teacherPerSeanceOf,
  registrationFeeFor,
  registrationFeeSubIds,
  registrationNumberOf,
  soldFor,
  studentSubscriptionHistory,
  studentMonthPrice,
  nextRegistrationNumber,
  todayIso,
} from "@/lib/helpers";
import { positiveMoney } from "@/lib/utils";
import type {
  CaseReduction,
  DiscountType,
  Student,
  StudentCase,
  SubscriptionDates,
} from "@/lib/types";

/** The billing cases offered when creating a student. */
export const STUDENT_CASE_OPTIONS: { value: StudentCase; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "special", label: "Cas spécial (gratuit)" },
  { value: "teacher_child", label: "Fils d'enseignant" },
  { value: "reduction", label: "Réduction" },
  { value: "school_only", label: "École seulement" },
];

export interface StudentFicheProps {
  open: boolean;
  onClose: () => void;
  /** emplois du temps ticked as soon as the screen opens (the group it was
   *  opened from, typically) */
  defaultSubIds?: string[];
  /** the day he comes in on — the séance of THAT day is the one he joins on
   *  (the présence sheet passes the journée it is working; today otherwise) */
  joinDate?: string;
  /** an existing fiche: the very same screen, in edit mode */
  student?: Student | null;
  onCreated?: (student: Student) => void;
}

/** Un document que la fiche propose d'imprimer une fois enregistrée. */
export interface PrintOffer {
  html: string;
  question: string;
}

export function CreateStudentModal(props: StudentFicheProps) {
  /**
   * Les documents vivent HORS du formulaire : ils sont proposés une fois
   * l'écran fermé, donc ils doivent survivre à son démontage. Ils sont proposés
   * l'un après l'autre — le reçu de l'avance d'abord, parce que c'est de
   * l'argent et que la famille l'attend au guichet, le bon d'inscription
   * ensuite — et refuser le premier n'empêche jamais d'imprimer le second.
   */
  const [offers, setOffers] = useState<PrintOffer[]>([]);
  const current = offers[0];
  return (
    <>
      {props.open && (
        <StudentFiche
          key={props.student?.id ?? `new|${(props.defaultSubIds ?? []).join("|")}`}
          {...props}
          onPrintOffers={setOffers}
        />
      )}
      {current && (
        <PrintAsk
          key={current.question}
          html={current.html}
          onClose={() => setOffers((prev) => prev.slice(1))}
          question={current.question}
        />
      )}
    </>
  );
}

/**
 * « RÉDUCTION SUR CET EMPLOI DU TEMPS ? » — l'alerte posée à chaque emploi coché.
 *
 * Elle ne se referme QUE sur une réponse : ni l'arrière-plan ni la touche Échap
 * ne la congédient, parce qu'une question non posée deviendrait une remise
 * silencieusement absente (ou, pire, silencieusement appliquée). Elle s'affiche
 * par-dessus la fiche, dans son propre calque à la racine du document, pour ne
 * pas dépendre des transformations de la fenêtre qui la porte.
 */
function ReductionAsk({
  label,
  seancePrice,
  schoolPart,
  teacherPart,
  onAnswer,
}: {
  label: string;
  seancePrice: number;
  schoolPart: number;
  teacherPart: number;
  onAnswer: (active: boolean) => void;
}) {
  // L'alerte ne s'ouvre QUE sur un clic de la réception : le document est donc
  // toujours là. Le garde-fou ne protège que d'un rendu côté serveur.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md overflow-y-auto rounded-2xl border border-warning/50 bg-surface card-shadow-lg">
        <div className="flex items-center gap-2 border-b border-line bg-warning/10 px-5 py-3.5">
          <Percent className="h-4 w-4 shrink-0 text-warning" />
          <h2 className="text-sm font-bold text-ink">Réduction sur cet emploi du temps ?</h2>
        </div>
        <div className="space-y-3 p-5">
          <div className="rounded-xl border border-line bg-canvas/40 p-3">
            <strong className="block text-[12px] text-ink">{label}</strong>
            <span className="mt-0.5 block text-[10px] text-muted">
              Séance à <strong className="text-ink">{formatDA(seancePrice)}</strong> — part école{" "}
              {formatDA(schoolPart)} · part enseignant {formatDA(teacherPart)}.
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            La réduction se coche{" "}
            <strong className="text-ink">emploi du temps par emploi du temps</strong>. Vous venez
            d&apos;ajouter celui-ci : dites s&apos;il en porte une.
          </p>
          <ul className="space-y-1.5 text-[10px] leading-relaxed text-muted">
            <li className="rounded-lg border border-line bg-canvas/40 px-2.5 py-1.5">
              <strong className="text-ink">Non</strong> — la réduction reste{" "}
              <strong className="text-ink">inactive</strong> sur cet emploi du temps : tout s&apos;y
              calcule normalement, la famille paie {formatDA(seancePrice)} la séance et
              l&apos;enseignant touche {formatDA(teacherPart)}, comme pour n&apos;importe quel élève.
            </li>
            <li className="rounded-lg border border-warning/40 bg-warning/5 px-2.5 py-1.5">
              <strong className="text-warning">Oui</strong> — vous saisissez, juste en dessous,{" "}
              <strong className="text-ink">la part de l&apos;école</strong> et{" "}
              <strong className="text-ink">la part de l&apos;enseignant</strong> : chacun retire la
              sienne de sa propre part, sur les paiements de l&apos;élève ET sur la paie de
              l&apos;enseignant, pour cet emploi du temps seulement.
            </li>
          </ul>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onAnswer(false)}>
              Non — calcul normal
            </Button>
            <Button onClick={() => onAnswer(true)} className="gap-1.5">
              <Percent className="h-4 w-4" /> Oui, activer la réduction
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StudentFiche({
  onClose,
  defaultSubIds = [],
  joinDate,
  student: editing,
  onCreated,
  onPrintOffers,
}: StudentFicheProps & { onPrintOffers: (offers: PrintOffer[]) => void }) {
  const db = useData();
  const {
    school,
    teachers,
    subscriptions,
    push,
    addSold,
    setStudentPassword,
    updateItem,
    subscribeStudent,
    unsubscribeStudent,
    convertStudentCase,
  } = db;
  const isEdit = !!editing;
  const { language } = useSettings();
  const { addToast } = useToast();
  const { subLabel } = useClassTimings();

  // identity — a creation starts blank, an edit starts on the fiche
  const [firstName, setFirstName] = useState(editing?.firstName ?? "");
  const [lastName, setLastName] = useState(editing?.lastName ?? "");
  const [birthDate, setBirthDate] = useState(editing?.birthDate ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  /** Le SECOND numéro : celui qu'on compose quand le premier ne répond pas. */
  const [phone2, setPhone2] = useState(editing?.phone2 ?? "");

  // billing case
  const [studentCase, setStudentCase] = useState<StudentCase>(
    editing?.studentCase ?? (editing?.isFree ? "special" : "normal"),
  );
  const [teacherFatherId, setTeacherFatherId] = useState(editing?.teacherFatherId ?? "");
  const [teacherSearch, setTeacherSearch] = useState("");
  /**
   * « RÉDUCTION » : LA REMISE SE COCHE EMPLOI DU TEMPS PAR EMPLOI DU TEMPS.
   *
   * Il n'y a plus de remise générale : à chaque emploi coché, l'écran DEMANDE
   * si la réduction s'y applique. L'emploi absent de cette table se calcule
   * NORMALEMENT — tarif entier pour la famille, part entière pour
   * l'enseignant ; celui qui y est porte SA remise, part école et part
   * enseignant saisies séparément.
   *
   * Une fiche d'avant, qui ne connaissait qu'une remise générale, ouvre avec
   * cette remise recopiée sur chacun de ses emplois du temps : ce qu'elle
   * facturait hier, elle le facture encore aujourd'hui, et la réception peut
   * désormais la retirer emploi par emploi.
   */
  const [subReductions, setSubReductions] = useState<Record<string, CaseReduction>>(() => {
    const saved = editing?.subscriptionReductions;
    if (saved) return { ...saved };
    const general = editing?.caseReduction;
    if (!general || editing?.studentCase !== "reduction") return {};
    const spread: Record<string, CaseReduction> = {};
    // TOUS ses emplois du temps, ceux qu'il a QUITTÉS compris : une dette
    // laissée derrière lui a été créée au tarif réduit, et re-tarifer cette
    // dette au tarif plein réclamerait à la famille plus qu'elle ne devait.
    for (const id of studentSubscriptionHistory(db, editing)) spread[id] = { ...general };
    return spread;
  });
  /**
   * LA QUESTION POSÉE À CHAQUE EMPLOI DU TEMPS COCHÉ — la file d'attente.
   *
   * Cocher un emploi sur un « cas réduction » ouvre aussitôt l'alerte
   * « réduction sur cet emploi du temps ? ». Tant qu'on n'a pas répondu, elle
   * reste là ; cocher trois emplois d'affilée pose la question trois fois, une
   * par emploi, dans l'ordre où ils ont été cochés.
   */
  const [reductionAsk, setReductionAsk] = useState<string[]>([]);
  const [unpaidTeacherIds, setUnpaidTeacherIds] = useState<string[]>(
    editing?.unpaidTeacherIds ?? [],
  );

  // inscriptions + the solde paid on each of them
  const [subIds, setSubIds] = useState<string[]>(editing?.subscriptionIds ?? defaultSubIds);
  /**
   * « Cas spécial » : les emplois du temps OFFERTS.
   *
   * Une fiche existante démarre sur ce qu'elle porte ; une fiche qui n'a jamais
   * détaillé sa gratuité (ou un élève qu'on bascule en cas spécial maintenant)
   * démarre TOUT COCHÉ — c'est ainsi que le cas se lisait avant d'être détaillé.
   */
  const [freeSubIds, setFreeSubIds] = useState<string[]>(
    () => editing?.freeSubscriptionIds ?? editing?.subscriptionIds ?? defaultSubIds,
  );
  /**
   * « ÉCOLE SEULEMENT » : LES EMPLOIS DU TEMPS OÙ L'OPTION EST ACTIVE.
   *
   * Exactement comme la gratuité, l'option se coche emploi par emploi. Sur un
   * emploi ACTIVÉ, la famille ne verse que la part de l'école, l'enseignant
   * n'est pas payé pour cet élève et celui-ci n'apparaît même pas sur l'écran
   * de paie de cet enseignant. Sur un emploi NON activé, tout se calcule
   * normalement — l'école ET l'enseignant sont réglés.
   *
   * Une fiche qui n'a jamais détaillé son cas (ou un élève qu'on bascule
   * maintenant en « école seule ») démarre TOUT COCHÉ : c'est ainsi que le cas
   * se lisait avant d'être détaillé.
   */
  const [schoolOnlySubIds, setSchoolOnlySubIds] = useState<string[]>(
    () => editing?.schoolOnlySubscriptionIds ?? editing?.subscriptionIds ?? defaultSubIds,
  );
  const [solds, setSolds] = useState<Record<string, number>>({});
  /**
   * OÙ LA RÉCEPTION EN EST dans le catalogue : le niveau (« classe ») et
   * l'année. Ils sont enregistrés MÊME SANS emploi du temps coché, pour que la
   * modification de la fiche rouvre là où l'élève a été inscrit au lieu d'un
   * primaire/1AP qui ne le concerne pas.
   */
  const [enrollLevel, setEnrollLevel] = useState<string>(editing?.enrollmentLevel ?? "");
  const [enrollYear, setEnrollYear] = useState<string>(editing?.enrollmentYear ?? "");
  /** Ce que la famille règle TOUT DE SUITE sur les frais d'inscription. */
  const [feePaidNow, setFeePaidNow] = useState<number>(0);
  /**
   * CE QU'ON FAIT DES DETTES QUAND LE CAS DE L'ÉLÈVE CHANGE.
   *
   * Un élève ordinaire qui devient « gratuit », « école seulement » ou
   * « réduction » traîne ce qu'il devait AU TARIF D'AVANT. La question est
   * posée à la réception, jamais tranchée à sa place :
   *
   *  - `keep`    : ses dettes restent telles quelles, au tarif d'avant ;
   *  - `reprice` : elles sont RECALCULÉES au nouveau cas — la réduction
   *    s'applique, « école seule » ramène la séance à la part de l'école — et
   *    la part due à son enseignant suit ;
   *  - `clear`   : elles sont EFFACÉES : il n'aura pas à les payer.
   */
  const [debtMode, setDebtMode] = useState<"keep" | "reprice" | "clear">("keep");
  const [busy, setBusy] = useState(false);

  // edit only: the portal login, which a fiche being created does not have yet
  const [editEmail, setEditEmail] = useState(editing?.email ?? "");
  const [editPassword, setEditPassword] = useState("");
  const [editRfid, setEditRfid] = useState(editing?.rfid ?? "");

  const nextNumber = useMemo(() => nextRegistrationNumber(db), [db.students]);
  const shownNumber = editing ? registrationNumberOf(db, editing) : nextNumber;
  const isFree = studentCase === "special";
  const isSchoolOnly = studentCase === "school_only";
  const isReduction = studentCase === "reduction";
  /** Cet emploi du temps est-il offert à l'élève tel que la fiche est cochée ? */
  const freeOn = (subId: string) => isFree && freeSubIds.includes(subId);
  /** L'option « école seulement » est-elle ACTIVE sur cet emploi du temps ? */
  const schoolOnlyOn = (subId: string) => isSchoolOnly && schoolOnlySubIds.includes(subId);
  /** La réduction est-elle ACTIVE sur cet emploi du temps ? */
  const reductionOn = (subId: string) => isReduction && !!subReductions[subId];
  /** Ce que la fiche enregistrera : rien à écrire hors du cas spécial. */
  const freeList = isFree ? subIds.filter((id) => freeSubIds.includes(id)) : undefined;
  const schoolOnlyList = isSchoolOnly
    ? subIds.filter((id) => schoolOnlySubIds.includes(id))
    : undefined;
  /**
   * LA TABLE DES RÉDUCTIONS QUE LA FICHE ÉCRIRA — les emplois du temps
   * réellement cochés, et eux seuls.
   *
   * Elle est écrite MÊME VIDE sur un « cas réduction » : vide veut dire « aucun
   * emploi réduit », et c'est une réponse, pas une absence de réponse. Hors de
   * ce cas, rien n'est écrit du tout.
   */
  const subKeyList = subIds.join("|");
  const reductionKey = JSON.stringify(subReductions);
  /** Les emplois du temps sur lesquels la réduction est ACTIVE. */
  const reducedSubIds = subIds.filter((id) => reductionOn(id));
  /**
   * LES EMPLOIS DU TEMPS QU'IL A QUITTÉS — ils gardent leur réduction.
   *
   * Sortir d'un groupe n'efface pas ce qu'on y devait, et cette dette a été
   * créée au TARIF RÉDUIT. Retirer la remise en le désinscrivant ferait
   * re-tarifer ces séances-là au prix plein : la famille se verrait réclamer
   * plus qu'elle ne devait. La fiche ne montre donc que les emplois cochés,
   * mais elle réécrit ceux d'avant tels quels.
   */
  const pastSubIds = useMemo(
    () =>
      editing
        ? studentSubscriptionHistory(db, editing).filter((id) => !subIds.includes(id))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing?.id, db.enrollments, db.subscriptions, subKeyList],
  );
  const pastKey = pastSubIds.join("|");
  const reductionList = useMemo(() => {
    if (!isReduction) return undefined;
    const out: Record<string, CaseReduction> = {};
    const ids = [
      ...(subKeyList ? subKeyList.split("|") : []),
      ...(pastKey ? pastKey.split("|") : []),
    ];
    for (const id of ids) {
      const red = subReductions[id];
      if (red && (red.schoolValue > 0 || red.teacherValue > 0)) out[id] = red;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReduction, subKeyList, pastKey, reductionKey]);
  /** Les mêmes listes, en une chaîne : de quoi comparer sans objet. */
  const freeKey = freeList?.join("|") ?? "";
  const schoolOnlyKey = schoolOnlyList?.join("|") ?? "";
  const reductionListKey = JSON.stringify(reductionList ?? null);
  /**
   * Les enseignants que ce cas prive de paie : ceux des emplois du temps où
   * l'option est active. La liste historique `unpaidTeacherIds` reste écrite,
   * pour que tout ce qui la lit encore continue de fonctionner — mais c'est
   * bien l'emploi du temps qui décide désormais.
   */
  const derivedUnpaidTeacherIds = useMemo(() => {
    if (!isSchoolOnly) return [];
    const ids = new Set<string>(unpaidTeacherIds);
    for (const subId of schoolOnlyList ?? []) {
      const sub = subscriptions.find((x) => x.id === subId);
      const session = sub && db.sessions.find((se) => se.id === sub.sessionId);
      if (session?.teacherId) ids.add(session.teacherId);
    }
    return [...ids];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSchoolOnly, schoolOnlyList?.join("|"), unpaidTeacherIds.join("|"), subscriptions, db.sessions]);
  const paidSubIds = subIds.filter((id) => !freeOn(id));
  // Un emploi offert n’encaisse rien : il ne compte pas dans le total, même si
  // un montant y avait été saisi avant qu’on ne le passe en « offert ».
  const totalSold = paidSubIds.reduce((s, id) => s + (solds[id] || 0), 0);

  /** The day he comes in on — what the sheet was showing, or today. */
  const arrivalDay = joinDate || todayIso();

  /**
   * LES FRAIS D'INSCRIPTION NE SONT PAS DUS PAR TOUT LE MONDE.
   *
   * L'école choisit son périmètre depuis l'écran des abonnements : tous les
   * élèves, tout un niveau, certaines classes, ou seulement certains emplois du
   * temps. Ici on ne fait que poser la question : parmi les emplois cochés,
   * lesquels tombent dans ce périmètre ? Aucun -> l'écran ne réclame rien, et la
   * fiche est créée sans la moindre dette d'inscription.
   */
  const feeSubIds = useMemo(
    () => registrationFeeSubIds(db, school, paidSubIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.subscriptions, db.sessions, db.classes, school, paidSubIds.join("|")],
  );
  /**
   * LES FRAIS N'ONT-ILS JAMAIS ÉTÉ RÉCLAMÉS À CET ÉLÈVE ?
   *
   * Un élève se crée très bien SANS emploi du temps : le créneau n'est pas
   * encore ouvert, la famille hésite. Les frais d'inscription ne portent alors
   * sur rien, et l'écran n'a rien à réclamer. Mais le jour où la réception
   * rouvre sa fiche pour lui cocher un emploi du temps, ils deviennent dus — et
   * l'écran de modification restait muet, si bien que la dette n'apparaissait
   * jamais, ni sur sa fiche, ni sur sa carte.
   *
   * La fiche porte donc une marque (`registrationFeeAssessed`) : tant qu'elle
   * est absente, la modification pose la question exactement comme la création
   * l'aurait posée — une fois, et une seule, puisque l'enregistrement la pose.
   */
  const feeAlreadyAsked = !!editing?.registrationFeeAssessed;
  /** Le montant réclamé — 0 dès qu'aucun emploi coché n'entre dans le périmètre. */
  const feeRequired = useMemo(
    () => (feeAlreadyAsked ? 0 : registrationFeeFor(db, school, paidSubIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feeAlreadyAsked, db.subscriptions, db.sessions, db.classes, school, paidSubIds.join("|")],
  );
  /**
   * LA QUESTION A-T-ELLE ÉTÉ POSÉE ? Elle l'est dès qu'un emploi coché entre
   * dans le périmètre, même si l'école ne réclame rien aujourd'hui : relever le
   * tarif des frais plus tard ne doit pas rattraper les élèves déjà inscrits.
   */
  const feeAssessedNow = feeAlreadyAsked || feeSubIds.length > 0;

  /**
   * LE CAS CHANGE-T-IL, ET QUE TRAÎNE-T-IL DERRIÈRE LUI ?
   *
   * La question ne se pose que sur une fiche existante, quand le cas choisi
   * n'est plus celui qui est enregistré ET que l'élève doit encore quelque
   * chose en SCOLARITÉ — les mois dans le rouge, les restes d'anciens
   * versements, les frais d'inscription. Les frais divers (un livre, une
   * tenue) n'en sont pas : ils ne dépendent d'aucun cas.
   */
  const savedCase: StudentCase = editing?.studentCase ?? (editing?.isFree ? "special" : "normal");
  const caseChanged = isEdit && studentCase !== savedCase;
  const currentDebt = useMemo(
    () => (editing ? studentDebtSummary(db, editing.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db.payments, db.attendance, db.enrollments, db.students, editing?.id],
  );
  const debtTotal = positiveMoney(currentDebt?.total ?? 0);
  const asksAboutDebt = caseChanged && debtTotal > 0;
  /** Ce que la famille règle aujourd'hui, plafonné au montant réclamé. */
  const feePaid = Math.min(positiveMoney(feePaidNow), feeRequired);
  /** Ce qui reste en DETTE sur sa fiche — créer l'élève reste toujours possible. */
  const feeDebt = positiveMoney(feeRequired - feePaid);

  /**
   * WHERE he lands on each ticked emploi: the month the group is living and the
   * séance of it held that day. Recomputed on every tick, so the recap under
   * each emploi always tells the desk what it is about to write.
   */
  const subKey = subIds.join("|");
  const joinPoints = useMemo(() => {
    const out: Record<string, { monthCode: string; slotIndex: number }> = {};
    for (const subId of subKey ? subKey.split("|") : []) {
      out[subId] = joinPointFor(db, subId, arrivalDay);
    }
    return out;
  }, [db, subKey, arrivalDay]);

  const joinPointOf = (subId: string) =>
    joinPoints[subId] ?? { monthCode: "M1", slotIndex: 0 };

  const reset = () => {
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setPhone("");
    setStudentCase("normal");
    setTeacherFatherId("");
    setTeacherSearch("");
    setSubReductions({});
    setReductionAsk([]);
    setUnpaidTeacherIds([]);
    setSubIds(defaultSubIds);
    setFreeSubIds(defaultSubIds);
    setSchoolOnlySubIds(defaultSubIds);
    setSolds({});
    setFeePaidNow(0);
  };

  const toggleTiming = (option: ClassTimingOption) => {
    const next = toggleTimingSelection(subIds, option);
    const added = next.filter((id) => !subIds.includes(id));
    setSubIds(next);
    /**
     * UN EMPLOI DU TEMPS VIENT D'ÊTRE COCHÉ SUR UN « CAS RÉDUCTION » : ON
     * DEMANDE.
     *
     * L'emploi arrive SANS réduction — tant que la réception n'a pas répondu
     * « oui », il se calcule normalement. L'alerte pose la question pour
     * chacun des emplois cochés, dans l'ordre, et ne se referme qu'une fois
     * répondu.
     */
    if (isReduction && added.length > 0) {
      setReductionAsk((prev) => [...prev, ...added.filter((id) => !prev.includes(id))]);
    }
    // Un emploi décoché n'a plus de réduction à porter — SAUF s'il fait partie
    // de son histoire : la dette qu'il y a laissée est née au tarif réduit.
    const kept = editing ? studentSubscriptionHistory(db, editing) : [];
    setSubReductions((prev) => {
      const clean: Record<string, CaseReduction> = {};
      for (const id of Object.keys(prev)) {
        if (next.includes(id) || kept.includes(id)) clean[id] = prev[id];
      }
      return clean;
    });
    setReductionAsk((prev) => prev.filter((id) => next.includes(id)));
    // Un emploi qu'on vient de cocher sur un « cas spécial » arrive OFFERT :
    // c'est ce que le cas promet, et le décocher le rend payant.
    setFreeSubIds((prev) => [...new Set([...prev, ...added])].filter((id) => next.includes(id)));
    // Même règle pour « école seulement » : l'emploi arrive avec l'option
    // ACTIVE, et la décocher le fait payer école ET enseignant.
    setSchoolOnlySubIds((prev) =>
      [...new Set([...prev, ...added])].filter((id) => next.includes(id)),
    );
    setSolds((prev) => {
      const clean: Record<string, number> = {};
      for (const id of next) clean[id] = prev[id] ?? 0;
      return clean;
    });
  };

  const toggleFree = (subId: string) =>
    setFreeSubIds((prev) =>
      prev.includes(subId) ? prev.filter((id) => id !== subId) : [...prev, subId],
    );

  const toggleSchoolOnly = (subId: string) =>
    setSchoolOnlySubIds((prev) =>
      prev.includes(subId) ? prev.filter((id) => id !== subId) : [...prev, subId],
    );

  /** Activer la réduction sur cet emploi du temps (elle démarre à zéro : la
   *  réception saisit tout de suite la part école et la part enseignant). */
  const activateReduction = (subId: string) =>
    setSubReductions((prev) =>
      prev[subId] ? prev : { ...prev, [subId]: { type: "percent", schoolValue: 0, teacherValue: 0 } },
    );

  /** La retirer : l'emploi du temps repasse au calcul NORMAL. */
  const clearReduction = (subId: string) =>
    setSubReductions((prev) => {
      const next = { ...prev };
      delete next[subId];
      return next;
    });

  const toggleReduction = (subId: string) =>
    (subReductions[subId] ? clearReduction : activateReduction)(subId);

  /** Modifier une valeur de la remise d'un emploi du temps. */
  const patchReduction = (subId: string, patch: Partial<CaseReduction>) =>
    setSubReductions((prev) => {
      const base: CaseReduction = prev[subId] ?? {
        type: "percent",
        schoolValue: 0,
        teacherValue: 0,
      };
      return { ...prev, [subId]: { ...base, ...patch } };
    });

  /**
   * CHOISIR LE CAS DE L'ÉLÈVE.
   *
   * Basculer sur « Réduction » alors que des emplois du temps sont DÉJÀ cochés
   * pose la question pour chacun d'eux : sans réponse, aucun n'est réduit et
   * tout se calcule normalement. Quitter le cas referme les questions en
   * attente — il n'y a plus rien à demander.
   */
  const pickCase = (value: StudentCase) => {
    setStudentCase(value);
    if (value === "reduction") {
      setReductionAsk(subIds.filter((id) => !subReductions[id]));
    } else {
      setReductionAsk([]);
    }
  };

  /** Répondre à l'alerte posée pour l'emploi du temps en tête de file. */
  const answerReductionAsk = (subId: string, active: boolean) => {
    if (active) activateReduction(subId);
    else {
      clearReduction(subId);
      addToast({
        type: "info",
        title: "Réduction inactive sur cet emploi du temps",
        message: `${subLabel(subId)} — la famille paie le tarif entier et l'enseignant touche sa part entière, comme pour un élève ordinaire.`,
      });
    }
    setReductionAsk((prev) => prev.filter((id) => id !== subId));
  };

  /**
   * L'ÉLÈVE TEL QUE LA FICHE EST COCHÉE — pas tel qu'il est en base.
   *
   * Tout ce que l'écran annonce en dinars (le mois proposé, le tarif d'une
   * séance réduite, la part qui revient à l'enseignant) passe par les MÊMES
   * fonctions que la caisse et la paie, appliquées à cet élève-là. Une case
   * cochée change donc le chiffre affiché exactement comme elle changera le
   * chiffre encaissé — l'écran ne peut pas promettre autre chose.
   */
  const ficheStudent = useMemo(
    () =>
      ({
        ...(editing ?? ({} as Student)),
        studentCase,
        isFree,
        freeSubscriptionIds: freeList,
        schoolOnlySubscriptionIds: schoolOnlyList,
        subscriptionReductions: reductionList,
      }) as Student,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, studentCase, isFree, freeKey, schoolOnlyKey, reductionListKey],
  );

  /**
   * Suggested opening solde of an emploi: the price of one of its months FOR
   * HIM. An « école seule » élève ne paie que la part de l'école, donc son mois
   * coûte cette part-là et pas le prix complet — et un emploi RÉDUIT coûte son
   * tarif réduit, réduction école et réduction enseignant comprises.
   */
  const suggestFor = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return 0;
    return (
      studentMonthPrice(ficheStudent, sub) || sub.pricePerSession * cycleSizeOf(sub)
    );
  };

  const submit = async () => {
    // Only a name is required — the desk often registers a child before it has
    // his phone or his birth date, and both can be filled in later.
    if (!firstName.trim() && !lastName.trim()) {
      addToast({
        type: "danger",
        title: "Nom manquant",
        message: "Indiquez au moins un nom ou un prénom.",
      });
      return;
    }
    if (studentCase === "teacher_child" && !teacherFatherId) {
      addToast({
        type: "danger",
        title: "Enseignant père",
        message: "Sélectionnez l'enseignant père pour ce cas.",
      });
      return;
    }
    // « École seulement » se règle désormais EMPLOI PAR EMPLOI : il suffit
    // qu'un emploi porte l'option (ou, sur une fiche sans emploi encore coché,
    // qu'un enseignant soit listé) pour que le cas ait un sens.
    if (
      studentCase === "school_only" &&
      subIds.length > 0 &&
      (schoolOnlyList ?? []).length === 0 &&
      unpaidTeacherIds.length === 0
    ) {
      addToast({
        type: "danger",
        title: "Aucun emploi du temps concerné",
        message:
          "Activez l'option « école seulement » sur au moins un emploi du temps, " +
          "sinon l'élève paie tout normalement.",
      });
      return;
    }
    /**
     * UNE RÉDUCTION ACTIVÉE MAIS LAISSÉE À ZÉRO n'est pas une réponse : c'est
     * une case cochée et oubliée. L'écran le dit plutôt que d'enregistrer une
     * remise qui ne retire rien — soit on saisit une part, soit on désactive
     * la réduction sur cet emploi du temps.
     */
    if (isReduction) {
      const empty = subIds.filter((id) => {
        const red = subReductions[id];
        return red && (red.schoolValue || 0) <= 0 && (red.teacherValue || 0) <= 0;
      });
      if (empty.length > 0) {
        addToast({
          type: "danger",
          title: "Réduction à zéro",
          message:
            `Indiquez la part école ou la part enseignant sur ${empty
              .map((id) => subLabel(id))
              .join(", ")}, ou désactivez-y la réduction — elle ne retire rien pour le moment.`,
        });
        return;
      }
      // Une question restée sans réponse : on ne devine pas à la place de la
      // réception, on la lui repose avant d'enregistrer.
      if (reductionAsk.length > 0) {
        addToast({
          type: "warning",
          title: "Réduction : une question attend une réponse",
          message: `Dites si la réduction s'applique à ${subLabel(reductionAsk[0])}.`,
        });
        return;
      }
    }

    // ---- editing an existing fiche ---------------------------------------
    if (editing) {
      setBusy(true);
      try {
        if (editEmail.trim() && editEmail.trim() !== editing.email) {
          await updateUserEmail(editing.id, editEmail.trim());
        }
        if (editPassword.trim()) {
          await resetUserPassword(editing.id, editPassword.trim());
          await setStudentPassword(editing.id, editPassword.trim());
        }

        updateItem("students", editing.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate,
          phone: phone.trim(),
          phone2: phone2.trim() || undefined,
          email: editEmail.trim() || editing.email,
          rfid: editRfid.trim() || editing.rfid,
          isFree,
          studentCase,
          freeSubscriptionIds: freeList,
          schoolOnlySubscriptionIds: schoolOnlyList,
          enrollmentLevel: enrollLevel || undefined,
          enrollmentYear: enrollYear || undefined,
          teacherFatherId: studentCase === "teacher_child" ? teacherFatherId : undefined,
          /**
           * LA RÉDUCTION, EMPLOI DU TEMPS PAR EMPLOI DU TEMPS.
           *
           * La table fait foi, même vide : « aucun emploi réduit » est une
           * réponse. L'ancienne remise générale est effacée par la même
           * occasion — la fiche ne peut pas porter deux vérités à la fois, et
           * celle qui reste est celle que la réception vient de saisir.
           */
          subscriptionReductions: reductionList,
          caseReduction: undefined,
          unpaidTeacherIds:
            studentCase === "school_only" ? derivedUnpaidTeacherIds : undefined,
          /**
           * LES FRAIS D'INSCRIPTION NÉS DE CETTE MODIFICATION.
           *
           * Un élève créé sans emploi du temps n'en devait aucun. En lui en
           * cochant un, la réception les déclenche : ce qui n'est pas réglé
           * tout de suite part en DETTE sur sa fiche, visible sur sa carte et
           * encaissable d'un clic. La marque empêche que la question se
           * repose à chaque modification suivante.
           */
          ...(feeAlreadyAsked
            ? {}
            : {
                registrationDue: positiveMoney((editing.registrationDue ?? 0) + feeDebt),
                registrationFeeAssessed: feeAssessedNow,
              }),
        });

        // Les frais réglés au guichet entrent en caisse comme n'importe quelle
        // recette : la modification encaisse exactement comme la création.
        if (feePaid > 0) {
          db.cashMove(
            "deposit",
            feePaid,
            `Frais d'inscription — ${firstName} ${lastName} (N° ${shownNumber})`,
            todayIso(),
          );
        }

        // Emplois du temps cochés/décochés : il ENTRE là où en est le groupe
        // aujourd'hui, et il en SORT sans rien perdre de son historique.
        for (const subId of subIds) {
          if (editing.subscriptionIds.includes(subId)) continue;
          await subscribeStudent({ studentId: editing.id, subscriptionId: subId, date: arrivalDay });
        }
        for (const subId of editing.subscriptionIds) {
          if (subIds.includes(subId)) continue;
          await unsubscribeStudent(editing.id, subId);
        }

        // Un montant saisi ici est un VERSEMENT de plus, jamais une réécriture
        // de ce qui a déjà été encaissé. Un emploi offert n’encaisse rien.
        for (const subId of paidSubIds) {
          const amount = positiveMoney(solds[subId] || 0);
          if (amount <= 0) continue;
          await addSold({
            studentId: editing.id,
            subscriptionId: subId,
            amount,
            monthCode: joinPointOf(subId).monthCode,
            description: `Solde versé (${subLabel(subId)})`,
          });
        }

        /**
         * LE NOUVEAU CAS S'APPLIQUE À CE QU'IL DEVAIT DÉJÀ — si l'école l'a
         * demandé. On agit APRÈS avoir écrit le cas et APRÈS les inscriptions,
         * pour que le recalcul lise l'élève tel qu'il est désormais.
         */
        let converted: { repriced?: number; waived?: number } = {};
        if (asksAboutDebt && debtMode !== "keep") {
          converted = await convertStudentCase({ studentId: editing.id, mode: debtMode });
        }

        const feeNote =
          feeDebt > 0
            ? ` · frais d'inscription de ${formatDA(feeDebt)} portés à sa fiche`
            : feePaid > 0
              ? ` · frais d'inscription de ${formatDA(feePaid)} encaissés`
              : "";
        addToast({
          type: "success",
          title: "Fiche enregistrée",
          message:
            (totalSold > 0
              ? `${subIds.length} emploi(s) du temps · ${formatDA(totalSold)} versés en plus`
              : `${subIds.length} emploi(s) du temps`) +
            feeNote +
            (debtMode === "clear" && (converted.waived ?? 0) > 0
              ? ` · ${formatDA(converted.waived ?? 0)} de dettes effacées`
              : debtMode === "reprice" && (converted.repriced ?? 0) > 0
                ? ` · ${converted.repriced} séance(s) recalculée(s) au nouveau cas`
                : "") +
            ".",
          studentName: `${firstName} ${lastName}`,
        });
        setBusy(false);
        onClose();
      } catch (err) {
        setBusy(false);
        addToast({
          type: "danger",
          title: "Erreur",
          message: err instanceof Error ? err.message : "Erreur lors de l'enregistrement.",
        });
      }
      return;
    }

    // Credentials and badge are minted silently — the desk types a name and
    // nothing else is needed. The registration number closes the login, so two
    // namesakes without phone nor birth date never collide on the same email.
    const base =
      `${firstName}${lastName}`
        .normalize("NFD") // "Aménée" -> "Amenee" once the marks are filtered out
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "eleve";
    const suffix =
      birthDate.replace(/-/g, "") || phone.replace(/\D/g, "").slice(-4) || nextNumber;
    const email = `${base}${suffix}@elilm.com`;
    const password = `${base}${suffix}`;
    const rfid = uid("rfid");

    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of subIds) {
      if (!subscriptions.some((s) => s.id === subId)) continue;
      const point = joinPointOf(subId);
      subscriptionDates[subId] = {
        subscribedAt: todayIso(),
        startDate: arrivalDay,
        joinMonthCode: point.monthCode,
        joinSlotIndex: point.slotIndex,
      };
    }
    /**
     * Les frais d'inscription ne sont dus que si DEUX conditions tiennent :
     *  - l'élève paie quelque chose (un cas entièrement offert ne les doit pas),
     *  - l'un de ses emplois du temps entre dans le périmètre choisi par
     *    l'école (tous, un niveau, des classes, des emplois précis).
     *
     * Ce que la famille verse aujourd'hui les solde d'autant ; le reste part en
     * DETTE sur sa fiche, et la création n'est jamais bloquée pour autant.
     */
    const registrationDue = feeDebt;

    setBusy(true);
    try {
      const { id: studentId } = await createRoleUser({
        role: "student",
        email,
        password,
        firstName,
        lastName,
        phone,
        birthDate,
        rfid,
        isFree,
        subscriptionIds: subIds,
        registrationDue,
      });

      const student: Student = {
        id: studentId,
        registrationNumber: nextNumber,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthDate,
        phone: phone.trim(),
        phone2: phone2.trim() || undefined,
        email,
        rfid,
        isFree,
        studentCase,
        freeSubscriptionIds: freeList,
        schoolOnlySubscriptionIds: schoolOnlyList,
        enrollmentLevel: enrollLevel || undefined,
        enrollmentYear: enrollYear || undefined,
        teacherFatherId: studentCase === "teacher_child" ? teacherFatherId : undefined,
        // La réduction se coche emploi par emploi : la table dit lesquels, et
        // les emplois qui n'y sont pas se calculent normalement.
        subscriptionReductions: reductionList,
        unpaidTeacherIds:
          studentCase === "school_only" ? derivedUnpaidTeacherIds : undefined,
        subscriptionIds: subIds,
        subscriptionDates,
        registrationDue,
        // La question a été posée à la création : elle ne se reposera plus.
        registrationFeeAssessed: feeAssessedNow,
      };
      push("students", student);
      await setStudentPassword(studentId, password);

      // L'AVANCE est créditée sur son propre emploi, au mois où l'élève ENTRE :
      // un enfant inscrit en M2 paie pour M2, jamais pour un mois qu'il a
      // manqué. Chaque versement laisse sa trace dans la caisse et dans
      // l'historique des paiements de l'élève, comme n'importe quel autre.
      // Les emplois offerts sont sautés : il n'y a rien à encaisser dessus.
      const advanceLines: SoldReceiptLine[] = [];
      for (const subId of paidSubIds) {
        const amount = positiveMoney(solds[subId] || 0);
        if (amount <= 0) continue;
        const code = joinPointOf(subId).monthCode;
        const res = await addSold({
          studentId,
          subscriptionId: subId,
          amount,
          monthCode: code,
          description: `Avance à l'inscription (${subLabel(subId)})`,
        });
        advanceLines.push({
          label: subLabel(subId),
          monthCode: res.monthCode ?? code,
          amount,
        });
      }

      // Les frais réglés au guichet entrent en caisse comme n'importe quelle
      // recette, avec leur propre ligne dans l'historique de l'élève.
      if (feePaid > 0) {
        db.cashMove(
          "deposit",
          feePaid,
          `Frais d'inscription — ${firstName} ${lastName} (N° ${nextNumber})`,
          todayIso(),
        );
      }

      addToast({
        type: "success",
        title: `Élève créé — N° ${nextNumber}`,
        message:
          subIds.length > 0
            ? `${subIds.length} emploi(s) du temps · ${formatDA(totalSold)} versés · inscrit à partir de ${
                joinPointOf(subIds[0]).monthCode
              } · séance ${joinPointOf(subIds[0]).slotIndex + 1}.`
            : "Aucun emploi du temps pour le moment.",
        studentName: `${firstName} ${lastName}`,
      });

      const voucher = inscriptionVoucherHtml(db, {
        student,
        language,
        registrationFee: feeRequired,
        lines: subIds.map((subId) => {
          const sub = subscriptions.find((s) => s.id === subId);
          const offered = freeOn(subId);
          const reduced = reductionOn(subId);
          return {
            // Le bon d'inscription dit ce que la famille paie RÉELLEMENT : un
            // emploi offert y apparaît à 0 DA et le dit en toutes lettres, un
            // emploi réduit y apparaît à SON tarif réduit — celui que la
            // caisse réclamera — et le dit aussi.
            label: offered
              ? `${subLabel(subId)} (offert)`
              : reduced
                ? `${subLabel(subId)} (réduction)`
                : subLabel(subId),
            monthSeances: cycleSizeOf(sub),
            unitPrice: offered ? 0 : studentListPrice(student, sub),
            sold: offered ? 0 : positiveMoney(solds[subId] || 0),
            monthCode: joinPointOf(subId).monthCode,
          };
        }),
      });

      // De l'argent a changé de main : il lui faut sa propre pièce, offerte
      // AVANT le bon d'inscription. C'est ce reçu-là que la famille repart avec.
      onPrintOffers([
        ...(advanceLines.length > 0
          ? [
              {
                html: soldReceiptHtml(db, {
                  student,
                  language,
                  title: "Reçu d'avance — inscription",
                  lines: advanceLines,
                  note:
                    registrationDue > 0
                      ? `Frais d'inscription de ${formatDA(registrationDue)} portés à sa fiche, à régler séparément.`
                      : undefined,
                }),
                question: `Imprimer le reçu de l'avance de ${formatDA(totalSold)} ?`,
              },
            ]
          : []),
        { html: voucher, question: "Imprimer le bon d'inscription de l'élève ?" },
      ]);

      onCreated?.(student);
      setBusy(false);
      reset();
      onClose();
    } catch (err) {
      setBusy(false);
      addToast({
        type: "danger",
        title: "Erreur",
        message: err instanceof Error ? err.message : "Erreur lors de la création.",
      });
    }
  };

  /** L'emploi du temps dont l'alerte attend une réponse — le premier de la file. */
  const asking = reductionAsk.find((id) => subIds.includes(id));
  const askingSub = asking ? subscriptions.find((x) => x.id === asking) : undefined;

  return (
    <>
      {/* « Réduction sur cet emploi du temps ? » — posée à chaque emploi coché,
          et tant qu'elle n'a pas de réponse, l'emploi n'en porte aucune. */}
      {asking && (
        <ReductionAsk
          key={asking}
          label={subLabel(asking)}
          seancePrice={askingSub?.pricePerSession ?? 0}
          schoolPart={schoolPerSeanceOf(askingSub)}
          teacherPart={teacherPerSeanceOf(askingSub)}
          onAnswer={(active) => answerReductionAsk(asking, active)}
        />
      )}
      <Modal open onClose={onClose} title={isEdit ? "Modifier l'élève" : "Nouvel élève"} wide>
        <div className="space-y-4">
          {/* identity */}
          <div className="rounded-xl border border-line bg-canvas/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                👤 Informations personnelles
              </span>
              <Badge tone="primary" className="font-mono">
                N° {shownNumber}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Prénom</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Amine" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Nom</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Benali" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Téléphone (optionnel)
                </label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0555 12 34 56" />
              </div>
              {/* Le second numéro : la mère, l'oncle, le voisin — celui qu'on
                  compose quand le premier ne répond pas. Jamais exigé. */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Deuxième téléphone (optionnel)
                </label>
                <Input
                  value={phone2}
                  onChange={(e) => setPhone2(e.target.value)}
                  placeholder="0661 98 76 54"
                />
                <p className="mt-1 text-[10px] text-muted">
                  Numéro de secours — il s&apos;affiche sur la fiche de l&apos;élève à côté du
                  premier.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Date de naissance (optionnel)
                </label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* portal login — only an existing fiche has one */}
          {isEdit && (
            <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                🔐 Compte du portail &amp; badge
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Email de connexion
                  </label>
                  <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Nouveau mot de passe
                  </label>
                  <Input
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Laisser vide pour ne pas changer"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Carte RFID</label>
                  <Input value={editRfid} onChange={(e) => setEditRfid(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* billing case */}
          <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
              🎫 Cas de l&apos;élève
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STUDENT_CASE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => pickCase(opt.value)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    studentCase === opt.value
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-ink hover:bg-primary-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {studentCase === "special" && (
              <p className="rounded-lg bg-primary-50/50 p-2 text-[10px] leading-relaxed text-muted">
                Études gratuites, <strong className="text-ink">emploi du temps par emploi du
                temps</strong> : chaque emploi coché ci-dessous arrive « Offert » — ni l&apos;école
                ni l&apos;enseignant ne sont payés pour lui. Décochez « Offert » sur un emploi et
                l&apos;élève le paie normalement.
                {subIds.length > 0 && (
                  <>
                    {" "}
                    <strong className="text-primary">
                      {freeList?.length ?? 0} offert(s)
                    </strong>{" "}
                    · <strong className="text-ink">{paidSubIds.length} payant(s)</strong>.
                  </>
                )}
              </p>
            )}

            {studentCase === "school_only" && (
              <p className="rounded-lg bg-warning/10 p-2 text-[10px] leading-relaxed text-muted">
                Seule l&apos;école est payée, <strong className="text-ink">emploi du temps par
                emploi du temps</strong> : chaque emploi coché plus bas arrive avec l&apos;option
                ACTIVE — la famille n&apos;y verse que la part de l&apos;école, l&apos;enseignant
                n&apos;est pas payé pour lui et l&apos;élève ne figure même pas sur son écran de
                paie pour cet emploi. Désactivez-la sur un emploi et tout s&apos;y calcule
                normalement.
                {subIds.length > 0 && (
                  <>
                    {" "}
                    <strong className="text-warning">
                      {schoolOnlyList?.length ?? 0} emploi(s) « école seule »
                    </strong>{" "}
                    ·{" "}
                    <strong className="text-ink">
                      {subIds.length - (schoolOnlyList?.length ?? 0)} normal(aux)
                    </strong>
                    .
                  </>
                )}
              </p>
            )}

            {(studentCase === "teacher_child" || studentCase === "school_only") && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted">
                  {studentCase === "teacher_child"
                    ? "L'école est payée sur le salaire de l'enseignant père."
                    : "Facultatif : des enseignants qui ne seront JAMAIS payés pour cet élève, même hors des emplois cochés ci-dessous."}
                </p>
                <Input
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                  placeholder="Rechercher un enseignant…"
                />
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {teachers
                    .filter((t) =>
                      `${t.firstName} ${t.lastName}`.toLowerCase().includes(teacherSearch.toLowerCase()),
                    )
                    .map((t) => {
                      const picked =
                        studentCase === "teacher_child"
                          ? teacherFatherId === t.id
                          : unpaidTeacherIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            studentCase === "teacher_child"
                              ? setTeacherFatherId(t.id)
                              : setUnpaidTeacherIds(
                                  picked
                                    ? unpaidTeacherIds.filter((id) => id !== t.id)
                                    : [...unpaidTeacherIds, t.id],
                                )
                          }
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                            picked
                              ? "border-primary bg-primary text-white"
                              : "border-line bg-surface text-ink hover:bg-primary-50"
                          }`}
                        >
                          <span>
                            {t.firstName} {t.lastName}
                          </span>
                          {picked && <Check className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------
                 LE CAS CHANGE, ET IL RESTE DES DETTES.

                 Un élève ordinaire qui devient gratuit, « école seulement » ou
                 réduit traîne ce qu'il devait AU TARIF D'AVANT. L'école
                 tranche — l'application ne décide jamais à sa place — et les
                 trois réponses possibles sont dites en toutes lettres, avec ce
                 que chacune fait au compte de l'élève.
                 ----------------------------------------------------------- */}
            {asksAboutDebt && (
              <div className="space-y-2 rounded-xl border border-danger/40 bg-danger/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-danger">
                    ⚠️ Ses dettes du cas précédent
                  </span>
                  <Badge tone="danger" className="font-mono font-bold">
                    {formatDA(debtTotal)}
                  </Badge>
                </div>
                <p className="text-[10px] leading-relaxed text-muted">
                  Il passe de{" "}
                  <strong className="text-ink">
                    {STUDENT_CASE_OPTIONS.find((o) => o.value === savedCase)?.label ?? savedCase}
                  </strong>{" "}
                  à{" "}
                  <strong className="text-ink">
                    {STUDENT_CASE_OPTIONS.find((o) => o.value === studentCase)?.label ??
                      studentCase}
                  </strong>{" "}
                  et doit encore {formatDA(debtTotal)}{" "}
                  {currentDebt && currentDebt.soldDebt > 0
                    ? `(dont ${formatDA(currentDebt.soldDebt)} de scolarité`
                    : "("}
                  {currentDebt && currentDebt.registrationDue > 0
                    ? `, ${formatDA(currentDebt.registrationDue)} de frais d'inscription`
                    : ""}
                  ). Que devient cette somme&nbsp;?
                </p>
                <div className="space-y-1.5">
                  {(
                    [
                      {
                        value: "keep" as const,
                        title: "Garder les dettes telles quelles",
                        detail:
                          "Ce qu'il doit reste dû au tarif d'avant. Le nouveau cas ne vaudra que pour les séances à venir.",
                      },
                      {
                        value: "reprice" as const,
                        title: "Garder les dettes, mais les recalculer au nouveau cas",
                        detail:
                          "Ses séances non encore réglées sont re-tarifées : la réduction s'applique, « école seule » ramène la séance à la part de l'école — et la part due à son enseignant suit. Les séances déjà réglées à l'enseignant ne bougent pas.",
                      },
                      {
                        value: "clear" as const,
                        title: "Effacer les dettes précédentes",
                        detail:
                          "Il n'aura rien à payer : ses séances impayées passent en offertes, les restes d'anciens versements et les frais d'inscription tombent à zéro. Ce qu'il a déjà versé lui reste acquis.",
                      },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDebtMode(opt.value)}
                      className={`flex w-full gap-2 rounded-lg border px-2.5 py-2 text-start transition-colors ${
                        debtMode === opt.value
                          ? "border-primary bg-primary-50/70"
                          : "border-line bg-surface hover:bg-primary-50/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                          debtMode === opt.value ? "border-primary bg-primary" : "border-line"
                        }`}
                      >
                        {debtMode === opt.value && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-[11px] text-ink">{opt.title}</strong>
                        <span className="block text-[10px] leading-relaxed text-muted">
                          {opt.detail}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* -----------------------------------------------------------
                 « RÉDUCTION » — PLUS AUCUNE REMISE GÉNÉRALE.

                 La remise se coche EMPLOI DU TEMPS PAR EMPLOI DU TEMPS, comme
                 la gratuité et « école seulement ». Chaque emploi coché plus
                 bas pose sa question ; sans réponse, il se calcule normalement.
                 ----------------------------------------------------------- */}
            {isReduction && (
              <p className="rounded-lg bg-warning/10 p-2 text-[10px] leading-relaxed text-muted">
                La réduction se règle{" "}
                <strong className="text-ink">emploi du temps par emploi du temps</strong> : à chaque
                emploi coché plus bas, l&apos;écran demande si la réduction s&apos;y applique.
                Répondez <strong className="text-ink">non</strong> et tout s&apos;y calcule
                normalement — tarif entier pour la famille, part entière pour l&apos;enseignant.
                Répondez <strong className="text-warning">oui</strong> et vous saisissez, pour cet
                emploi-là, <strong className="text-ink">la part de l&apos;école</strong> et{" "}
                <strong className="text-ink">la part de l&apos;enseignant</strong> : chacun retire la
                sienne de sa propre part, et la famille ne verse que ce qui reste.
                {subIds.length > 0 && (
                  <>
                    {" "}
                    <strong className="text-warning">
                      {reducedSubIds.length} emploi(s) réduit(s)
                    </strong>{" "}
                    ·{" "}
                    <strong className="text-ink">
                      {subIds.length - reducedSubIds.length} normal(aux)
                    </strong>
                    .
                  </>
                )}
              </p>
            )}
          </div>

          {/* inscriptions + soldes */}
          <div className="space-y-3 rounded-xl border border-line bg-canvas/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                <BookOpen className="h-3.5 w-3.5" /> Emplois du temps de l&apos;élève
              </span>
              <span className="text-[10px] font-semibold text-muted">
                {subIds.length} sélectionné(s)
              </span>
            </div>

            {isEdit && (
              <p className="text-[10px] leading-relaxed text-muted">
                Le tableau ci-dessous rappelle sa <strong>classe</strong>, son{" "}
                <strong>année</strong> et les <strong>emplois du temps</strong> qu&apos;il suit,
                avec le solde de chacun. Retirez-en un, cochez-en un autre dans la liste, puis{" "}
                <strong>Enregistrer les modifications</strong> : ce qui part est désinscrit sans
                rien perdre de son historique, ce qui arrive l&apos;inscrit là où en est le groupe.
              </p>
            )}

            <ClassTimingPicker
              selectedSubIds={subIds}
              onToggle={toggleTiming}
              student={editing}
              savedSubIds={editing?.subscriptionIds}
              showCurrent
              /* La classe et l'année sont RETENUES même sans emploi du temps
                 coché : une fiche créée « 4AP, on verra le créneau plus tard »
                 rouvre sur 4AP, et non sur un primaire/1AP arbitraire. */
              initialLevel={editing?.enrollmentLevel}
              initialYear={editing?.enrollmentYear}
              onScopeChange={(scope: TimingScope) => {
                setEnrollLevel(scope.level);
                setEnrollYear(scope.year);
              }}
            />

            {subIds.length > 0 && (
              <div className="space-y-2">
                <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                  <Wallet className="h-3 w-3" />{" "}
                  {isEdit
                    ? "Solde à AJOUTER sur chaque emploi du temps (laisser 0 pour ne rien encaisser)"
                    : "Avance versée pour chaque emploi du temps (laisser 0 s'il ne paie rien aujourd'hui)"}
                </span>
                {subIds.map((subId) => {
                  const sub = subscriptions.find((s) => s.id === subId);
                  const offered = freeOn(subId);
                  const suggestion = offered ? 0 : suggestFor(subId);
                  const listUnit = sub?.pricePerSession ?? 0;
                  const unit = offered ? 0 : listUnit;
                  const paid = solds[subId] || 0;
                  const seances = unit > 0 ? Math.floor(paid / unit) : 0;
                  const point = joinPointOf(subId);
                  /** LA RÉDUCTION DE CET EMPLOI DU TEMPS, et ce qu'elle donne. */
                  const reduced = reductionOn(subId);
                  const red = subReductions[subId];
                  const redType: DiscountType = red?.type ?? "percent";
                  const redSchool = red?.schoolValue ?? 0;
                  const redTeacher = red?.teacherValue ?? 0;
                  const schoolPart = schoolPerSeanceOf(sub);
                  const teacherPart = teacherPerSeanceOf(sub);
                  // Les chiffres annoncés passent par les MÊMES calculs que la
                  // caisse et la paie : l'écran ne promet jamais autre chose.
                  const reducedSchool = studentSchoolPerSeance(ficheStudent, sub);
                  const reducedTeacher = studentTeacherPerSeance(ficheStudent, sub);
                  const reducedUnit = studentListPrice(ficheStudent, sub);
                  return (
                    <div
                      key={subId}
                      className={`rounded-xl border p-2.5 ${
                        offered ? "border-success/40 bg-success/5" : "border-line bg-surface"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <strong className="block text-[11px] text-ink">{subLabel(subId)}</strong>
                          <span className="text-[10px] text-muted">
                            {cycleSizeOf(sub)} séances / mois ·{" "}
                            {offered ? (
                              <>
                                <span className="line-through">{formatDA(listUnit)}</span>{" "}
                                <strong className="text-success">offert</strong>
                              </>
                            ) : (
                              <>
                                séance à {formatDA(unit)}
                                {suggestion > 0 ? ` · mois à ${formatDA(suggestion)}` : ""}
                              </>
                            )}
                          </span>
                          <Badge tone="primary" className="mt-1 text-[9px]">
                            {isEdit && editing?.subscriptionIds.includes(subId)
                              ? `Déjà inscrit · solde ${formatDA(soldFor(db, editing.id, subId))}`
                              : `Entre en ${point.monthCode} · séance ${point.slotIndex + 1}`}
                          </Badge>
                        </div>
                        <button
                          onClick={() => {
                            setSubIds(subIds.filter((id) => id !== subId));
                            // L'emploi s'en va : sa réduction et sa question
                            // s'en vont avec lui.
                            clearReduction(subId);
                            setReductionAsk((prev) => prev.filter((id) => id !== subId));
                          }}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Retirer cet emploi du temps"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* « École seulement », emploi par emploi — active par défaut.
                          Exactement la même mécanique que la gratuité : ce qui est
                          activé ici ne paie que l'école et disparaît de la fiche de
                          paie de l'enseignant ; ce qui ne l'est pas se calcule
                          normalement, et l'élève y apparaît comme tout le monde. */}
                      {isSchoolOnly && (
                        <label
                          className={`mt-2 flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                            schoolOnlyOn(subId)
                              ? "border-warning/50 bg-warning/10"
                              : "border-line bg-canvas/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={schoolOnlyOn(subId)}
                            onChange={() => toggleSchoolOnly(subId)}
                            className="mt-0.5 h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0">
                            <strong
                              className={`flex items-center gap-1 text-[11px] ${
                                schoolOnlyOn(subId) ? "text-warning" : "text-ink"
                              }`}
                            >
                              <Building2 className="h-3 w-3" />
                              {schoolOnlyOn(subId)
                                ? "Paiement à L'ÉCOLE SEULEMENT"
                                : "Paiement NORMAL (école + enseignant)"}
                            </strong>
                            <span className="block text-[9px] leading-relaxed text-muted">
                              {schoolOnlyOn(subId) ? (
                                <>
                                  La famille ne verse que la part de l&apos;école (
                                  <strong className="text-ink">
                                    {formatDA(schoolPerSeanceOf(sub))}
                                  </strong>{" "}
                                  la séance au lieu de {formatDA(sub?.pricePerSession ?? 0)}).
                                  L&apos;enseignant n&apos;est pas payé pour cet élève, et
                                  l&apos;élève <strong className="text-ink">n&apos;apparaît pas</strong>{" "}
                                  sur son écran de paie pour cet emploi du temps.
                                </>
                              ) : (
                                <>
                                  L&apos;élève paie le tarif entier —{" "}
                                  <strong className="text-ink">
                                    {formatDA(sub?.pricePerSession ?? 0)}
                                  </strong>{" "}
                                  la séance — et l&apos;enseignant touche sa part
                                  ({formatDA(teacherPerSeanceOf(sub))} / séance). Il figure sur
                                  l&apos;écran de paie de cet enseignant.
                                </>
                              )}
                            </span>
                          </span>
                        </label>
                      )}

                      {/* La gratuité, emploi par emploi — cochée par défaut */}
                      {isFree && (
                        <label
                          className={`mt-2 flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                            offered ? "border-success/40 bg-success/10" : "border-line bg-canvas/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={offered}
                            onChange={() => toggleFree(subId)}
                            className="mt-0.5 h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0">
                            <strong
                              className={`flex items-center gap-1 text-[11px] ${
                                offered ? "text-success" : "text-ink"
                              }`}
                            >
                              <Gift className="h-3 w-3" />
                              {offered ? "Emploi du temps OFFERT" : "Emploi du temps PAYANT"}
                            </strong>
                            <span className="block text-[9px] leading-relaxed text-muted">
                              {offered
                                ? "L’élève ne paie rien pour cet emploi : ni l’école ni l’enseignant ne sont réglés pour ses séances."
                                : `L’élève paie cet emploi normalement — ${formatDA(listUnit)} la séance, et l’enseignant touche sa part.`}
                            </span>
                          </span>
                        </label>
                      )}

                      {/* -------------------------------------------------
                           LA RÉDUCTION DE CET EMPLOI DU TEMPS.

                           Elle n'est JAMAIS active d'office : l'alerte posée à
                           la coche décide, et tant qu'elle n'est pas activée,
                           cet emploi se calcule comme celui de n'importe quel
                           élève — tarif entier pour la famille, part entière
                           pour l'enseignant. Activée, elle porte SA part école
                           et SA part enseignant, et l'écran annonce aussitôt ce
                           que la famille versera et ce que l'enseignant
                           touchera pour cet emploi-là.
                           ------------------------------------------------- */}
                      {isReduction && (
                        <div
                          className={`mt-2 rounded-lg border px-2.5 py-1.5 ${
                            reduced ? "border-warning/50 bg-warning/10" : "border-line bg-canvas/40"
                          }`}
                        >
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              checked={reduced}
                              onChange={() => toggleReduction(subId)}
                              className="mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0">
                              <strong
                                className={`flex items-center gap-1 text-[11px] ${
                                  reduced ? "text-warning" : "text-ink"
                                }`}
                              >
                                <Percent className="h-3 w-3" />
                                {reduced
                                  ? "RÉDUCTION ACTIVE sur cet emploi du temps"
                                  : "Réduction INACTIVE — calcul normal"}
                              </strong>
                              <span className="block text-[9px] leading-relaxed text-muted">
                                {reduced ? (
                                  <>
                                    L&apos;école retire sa part de{" "}
                                    <strong className="text-ink">{formatDA(schoolPart)}</strong>,
                                    l&apos;enseignant la sienne de{" "}
                                    <strong className="text-ink">{formatDA(teacherPart)}</strong>.
                                  </>
                                ) : (
                                  <>
                                    La famille paie{" "}
                                    <strong className="text-ink">{formatDA(listUnit)}</strong> la
                                    séance et l&apos;enseignant touche{" "}
                                    <strong className="text-ink">{formatDA(teacherPart)}</strong>,
                                    comme pour un élève ordinaire.
                                  </>
                                )}
                              </span>
                            </span>
                          </label>

                          {reduced && (
                            <div className="mt-2 space-y-2 border-t border-warning/30 pt-2">
                              <div className="flex gap-2">
                                {(["percent", "amount"] as DiscountType[]).map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => patchReduction(subId, { type: t })}
                                    className={`flex-1 rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                                      redType === t
                                        ? "border-primary bg-primary text-white"
                                        : "border-line bg-surface text-ink"
                                    }`}
                                  >
                                    {t === "percent" ? "Pourcentage (%)" : "Montant fixe (DA)"}
                                  </button>
                                ))}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                                    Part école ({redType === "percent" ? "%" : "DA"})
                                  </label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={redSchool || ""}
                                    onChange={(e) =>
                                      patchReduction(subId, {
                                        schoolValue: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    placeholder="0"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                                    Part enseignant ({redType === "percent" ? "%" : "DA"})
                                  </label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={redTeacher || ""}
                                    onChange={(e) =>
                                      patchReduction(subId, {
                                        teacherValue: Math.max(0, Number(e.target.value) || 0),
                                      })
                                    }
                                    placeholder="0"
                                  />
                                </div>
                              </div>
                              {/* CE QUE ÇA DONNE, EN DINARS — le chiffre que la
                                  caisse réclamera et celui que la paie versera. */}
                              <p
                                className={`rounded-lg p-2 text-[10px] leading-relaxed ${
                                  redSchool > 0 || redTeacher > 0
                                    ? "bg-success/10 text-success"
                                    : "bg-danger/10 text-danger"
                                }`}
                              >
                                {redSchool > 0 || redTeacher > 0 ? (
                                  <>
                                    La famille paiera <strong>{formatDA(reducedUnit)}</strong> la
                                    séance au lieu de {formatDA(listUnit)} · l&apos;école garde{" "}
                                    <strong>{formatDA(reducedSchool)}</strong> (au lieu de{" "}
                                    {formatDA(schoolPart)}) · l&apos;enseignant touche{" "}
                                    <strong>{formatDA(reducedTeacher)}</strong> (au lieu de{" "}
                                    {formatDA(teacherPart)}). Son mois revient à{" "}
                                    <strong>{formatDA(reducedUnit * cycleSizeOf(sub))}</strong>.
                                  </>
                                ) : (
                                  <>
                                    Réduction activée mais à zéro : elle ne retire rien. Indiquez
                                    une part, ou décochez-la pour revenir au calcul normal.
                                  </>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        {offered ? (
                          <span className="text-[10px] font-semibold text-success">
                            Rien à encaisser sur cet emploi du temps.
                          </span>
                        ) : (
                          <>
                            <div>
                              <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                                {isEdit ? "Solde à ajouter (DA)" : "Avance versée (DA)"}
                              </label>
                              <Input
                                type="number"
                                step="0.01"
                                min={0}
                                value={paid || ""}
                                onChange={(e) =>
                                  setSolds({
                                    ...solds,
                                    [subId]: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                placeholder="0"
                                className="w-36"
                              />
                            </div>
                            {suggestion > 0 && (
                              <button
                                onClick={() => setSolds({ ...solds, [subId]: suggestion })}
                                className="pb-2.5 text-[10px] font-bold text-primary hover:underline"
                              >
                                Un mois ({formatDA(suggestion)})
                              </button>
                            )}
                            <span className="pb-2.5 text-[10px] text-muted">
                              ≈ {seances} séance(s) couverte(s)
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary-50/40 px-3 py-2">
                  <span className="text-xs font-semibold text-muted">
                    {isEdit ? "Total encaissé maintenant" : "Avance totale versée à l'inscription"}
                  </span>
                  <strong className="text-sm text-primary">{formatDA(totalSold)}</strong>
                </div>

                {!isEdit && totalSold > 0 && (
                  <p className="rounded-xl border border-success/40 bg-success/10 p-2.5 text-[10px] leading-relaxed text-success">
                    🧾 Après la création, l&apos;écran proposera d&apos;imprimer le{" "}
                    <strong>reçu de cette avance</strong> puis le{" "}
                    <strong>bon d&apos;inscription</strong>. L&apos;avance entre dans la caisse et
                    apparaît aussitôt dans l&apos;historique des paiements de l&apos;élève, emploi
                    du temps et mois compris.
                  </p>
                )}

                <p className="text-[10px] text-muted">
                  ℹ️ L&apos;élève entre sur chaque emploi du temps LÀ OÙ EN EST LE GROUPE : son
                  solde est versé sur ce mois-là, les séances déjà tenues avant lui restent vides
                  sur sa ligne et les mois précédents ne le comptent pas.
                </p>

                {/* -------------------------------------------------------
                    LES FRAIS D'INSCRIPTION — réclamés SEULEMENT si l'un des
                    emplois cochés entre dans le périmètre choisi par l'école
                    (tous les élèves, un niveau, des classes, des emplois
                    précis). Sinon ce bloc ne s'affiche même pas.

                    La famille peut en régler tout, une partie, ou rien : ce
                    qui reste part en DETTE sur la fiche, et la création n'est
                    jamais bloquée pour autant.
                    ------------------------------------------------------- */}
                {feeRequired > 0 && (
                  <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-warning">
                        🎫 Frais d&apos;inscription requis
                      </span>
                      <Badge tone="warning" className="font-mono font-bold">
                        {formatDA(feeRequired)}
                      </Badge>
                    </div>
                    <p className="text-[10px] leading-relaxed text-muted">
                      {feeSubIds.length} emploi(s) du temps coché(s) entrent dans le périmètre défini
                      par l&apos;école :{" "}
                      <strong className="text-ink">
                        {feeSubIds.map((id) => subLabel(id)).join(", ")}
                      </strong>
                      .
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                          Encaissé maintenant (DA)
                        </label>
                        <Input
                          type="number"
                          min={0}
                          max={feeRequired}
                          step="0.01"
                          value={feePaidNow || ""}
                          onChange={(e) =>
                            setFeePaidNow(
                              Math.min(
                                positiveMoney(Number(e.target.value.replace(",", ".")) || 0),
                                feeRequired,
                              ),
                            )
                          }
                          placeholder="0"
                          className="w-36"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setFeePaidNow(feeRequired)}
                        className="pb-2.5 text-[10px] font-bold text-primary hover:underline"
                      >
                        Tout régler ({formatDA(feeRequired)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFeePaidNow(0)}
                        className="pb-2.5 text-[10px] font-bold text-warning hover:underline"
                      >
                        Créer avec la dette
                      </button>
                    </div>
                    <p
                      className={`rounded-lg p-2 text-[10px] font-semibold ${
                        feeDebt > 0 ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                      }`}
                    >
                      {feeDebt > 0
                        ? `${formatDA(feeDebt)} resteront en DETTE sur sa fiche — visible partout tant qu'ils ne sont pas réglés.`
                        : "Frais entièrement réglés : aucune dette d'inscription sur sa fiche."}
                    </p>
                  </div>
                )}

                {!feeAlreadyAsked && feeRequired === 0 && (school?.registrationFee ?? 0) > 0 && paidSubIds.length > 0 && (
                  <p className="text-[10px] text-muted">
                    ℹ️ Aucun frais d&apos;inscription pour cet élève : les emplois du temps cochés
                    n&apos;entrent pas dans le périmètre défini sur la page Abonnements.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy
                ? isEdit
                  ? "Enregistrement…"
                  : "Création…"
                : isEdit
                  ? "Enregistrer les modifications"
                  : "Créer l'élève"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
