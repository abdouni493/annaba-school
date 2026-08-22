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
 * temps the student follows and — for EACH of them — how much the family pays
 * now: that money becomes the opening SOLDE of that emploi. Saving offers the
 * bon d'inscription, which prints the identity, the emplois and every solde.
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
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { BookOpen, Check, Gift, Trash2, Wallet } from "lucide-react";
import { createRoleUser, resetUserPassword, updateUserEmail } from "@/lib/accounts/users";
import { formatDA } from "@/lib/utils";
import { inscriptionVoucherHtml } from "@/lib/reports/documents";
import { PrintAsk } from "@/components/attendance/PresenceSheet";
import {
  ClassTimingPicker,
  toggleTimingSelection,
  useClassTimings,
  type ClassTimingOption,
} from "@/components/students/ClassTimingPicker";
import {
  cycleSizeOf,
  joinPointFor,
  registrationNumberOf,
  soldFor,
  studentMonthPrice,
  nextRegistrationNumber,
  todayIso,
} from "@/lib/helpers";
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

export function CreateStudentModal(props: StudentFicheProps) {
  /** The bon d'inscription lives OUT here: it is offered once the screen has
   *  closed, so it must survive the form's unmount. */
  const [voucher, setVoucher] = useState<string | null>(null);
  return (
    <>
      {props.open && (
        <StudentFiche
          key={props.student?.id ?? `new|${(props.defaultSubIds ?? []).join("|")}`}
          {...props}
          onVoucher={setVoucher}
        />
      )}
      {voucher && (
        <PrintAsk
          html={voucher}
          onClose={() => setVoucher(null)}
          question="Imprimer le bon d'inscription de l'élève ?"
        />
      )}
    </>
  );
}

function StudentFiche({
  onClose,
  defaultSubIds = [],
  joinDate,
  student: editing,
  onCreated,
  onVoucher,
}: StudentFicheProps & { onVoucher: (html: string) => void }) {
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

  // billing case
  const [studentCase, setStudentCase] = useState<StudentCase>(
    editing?.studentCase ?? (editing?.isFree ? "special" : "normal"),
  );
  const [teacherFatherId, setTeacherFatherId] = useState(editing?.teacherFatherId ?? "");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [caseRedType, setCaseRedType] = useState<DiscountType>(
    editing?.caseReduction?.type ?? "percent",
  );
  const [caseRedSchool, setCaseRedSchool] = useState(editing?.caseReduction?.schoolValue ?? 0);
  const [caseRedTeacher, setCaseRedTeacher] = useState(editing?.caseReduction?.teacherValue ?? 0);
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
  const [solds, setSolds] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  // edit only: the portal login, which a fiche being created does not have yet
  const [editEmail, setEditEmail] = useState(editing?.email ?? "");
  const [editPassword, setEditPassword] = useState("");
  const [editRfid, setEditRfid] = useState(editing?.rfid ?? "");

  const nextNumber = useMemo(() => nextRegistrationNumber(db), [db.students]);
  const shownNumber = editing ? registrationNumberOf(db, editing) : nextNumber;
  const isFree = studentCase === "special";
  /** Cet emploi du temps est-il offert à l'élève tel que la fiche est cochée ? */
  const freeOn = (subId: string) => isFree && freeSubIds.includes(subId);
  /** Ce que la fiche enregistrera : rien à écrire hors du cas spécial. */
  const freeList = isFree ? subIds.filter((id) => freeSubIds.includes(id)) : undefined;
  const paidSubIds = subIds.filter((id) => !freeOn(id));
  // Un emploi offert n’encaisse rien : il ne compte pas dans le total, même si
  // un montant y avait été saisi avant qu’on ne le passe en « offert ».
  const totalSold = paidSubIds.reduce((s, id) => s + (solds[id] || 0), 0);

  /** The day he comes in on — what the sheet was showing, or today. */
  const arrivalDay = joinDate || todayIso();

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
    setCaseRedType("percent");
    setCaseRedSchool(0);
    setCaseRedTeacher(0);
    setUnpaidTeacherIds([]);
    setSubIds(defaultSubIds);
    setFreeSubIds(defaultSubIds);
    setSolds({});
  };

  const toggleTiming = (option: ClassTimingOption) => {
    const next = toggleTimingSelection(subIds, option);
    const added = next.filter((id) => !subIds.includes(id));
    setSubIds(next);
    // Un emploi qu'on vient de cocher sur un « cas spécial » arrive OFFERT :
    // c'est ce que le cas promet, et le décocher le rend payant.
    setFreeSubIds((prev) => [...new Set([...prev, ...added])].filter((id) => next.includes(id)));
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

  /**
   * Suggested opening solde of an emploi: the price of one of its months FOR
   * HIM. An « école seule » élève ne paie que la part de l'école, donc son mois
   * coûte cette part-là et pas le prix complet.
   */
  const suggestFor = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return 0;
    const asStudent = {
      ...(editing ?? ({} as Student)),
      studentCase,
      isFree,
      freeSubscriptionIds: freeList,
    };
    return (
      studentMonthPrice(asStudent as Student, sub) ||
      sub.pricePerSession * cycleSizeOf(sub)
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
    if (studentCase === "school_only" && unpaidTeacherIds.length === 0) {
      addToast({
        type: "danger",
        title: "Enseignants à exclure",
        message: "Sélectionnez au moins un enseignant qui ne sera pas payé.",
      });
      return;
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
          email: editEmail.trim() || editing.email,
          rfid: editRfid.trim() || editing.rfid,
          isFree,
          studentCase,
          freeSubscriptionIds: freeList,
          teacherFatherId: studentCase === "teacher_child" ? teacherFatherId : undefined,
          caseReduction:
            studentCase === "reduction"
              ? ({
                  type: caseRedType,
                  schoolValue: caseRedSchool || 0,
                  teacherValue: caseRedTeacher || 0,
                } as CaseReduction)
              : undefined,
          unpaidTeacherIds: studentCase === "school_only" ? unpaidTeacherIds : undefined,
        });

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
          const amount = Math.max(0, Math.round(solds[subId] || 0));
          if (amount <= 0) continue;
          await addSold({
            studentId: editing.id,
            subscriptionId: subId,
            amount,
            monthCode: joinPointOf(subId).monthCode,
            description: `Solde versé (${subLabel(subId)})`,
          });
        }

        addToast({
          type: "success",
          title: "Fiche enregistrée",
          message:
            totalSold > 0
              ? `${subIds.length} emploi(s) du temps · ${formatDA(totalSold)} versés en plus.`
              : `${subIds.length} emploi(s) du temps.`,
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
    // Les frais d'inscription ne sont dus que si l'élève PAIE quelque chose :
    // un cas spécial dont un seul emploi reste payant les doit, un cas spécial
    // entièrement offert ne les doit pas.
    const registrationDue = paidSubIds.length > 0 ? school?.registrationFee || 0 : 0;

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
        email,
        rfid,
        isFree,
        studentCase,
        freeSubscriptionIds: freeList,
        teacherFatherId: studentCase === "teacher_child" ? teacherFatherId : undefined,
        caseReduction:
          studentCase === "reduction"
            ? ({
                type: caseRedType,
                schoolValue: caseRedSchool || 0,
                teacherValue: caseRedTeacher || 0,
              } as CaseReduction)
            : undefined,
        unpaidTeacherIds: studentCase === "school_only" ? unpaidTeacherIds : undefined,
        subscriptionIds: subIds,
        subscriptionDates,
        registrationDue,
      };
      push("students", student);
      await setStudentPassword(studentId, password);

      // Each solde is credited on its own emploi, on the month he COMES IN on:
      // a child registered during M2 pays for M2, never for a month he missed.
      // Les emplois offerts sont sautes : il n’y a rien a encaisser dessus.
      for (const subId of paidSubIds) {
        const amount = Math.max(0, Math.round(solds[subId] || 0));
        if (amount <= 0) continue;
        await addSold({
          studentId,
          subscriptionId: subId,
          amount,
          monthCode: joinPointOf(subId).monthCode,
          description: `Inscription — solde initial (${subLabel(subId)})`,
        });
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

      onVoucher(
        inscriptionVoucherHtml(db, {
          student,
          language,
          registrationFee: registrationDue,
          lines: subIds.map((subId) => {
            const sub = subscriptions.find((s) => s.id === subId);
            const offered = freeOn(subId);
            return {
              // Le bon d’inscription dit ce que la famille paie réellement :
              // un emploi offert y apparaît à 0 DA et le dit en toutes lettres.
              label: offered ? `${subLabel(subId)} (offert)` : subLabel(subId),
              monthSeances: cycleSizeOf(sub),
              unitPrice: offered ? 0 : sub?.pricePerSession ?? 0,
              sold: offered ? 0 : Math.max(0, Math.round(solds[subId] || 0)),
              monthCode: joinPointOf(subId).monthCode,
            };
          }),
        }),
      );

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

  return (
    <>
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
              <div>
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
                  onClick={() => setStudentCase(opt.value)}
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

            {(studentCase === "teacher_child" || studentCase === "school_only") && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted">
                  {studentCase === "teacher_child"
                    ? "L'école est payée sur le salaire de l'enseignant père."
                    : "Seule l'école est payée. Cochez les enseignants qui ne seront PAS payés."}
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

            {studentCase === "reduction" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {(["percent", "amount"] as DiscountType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCaseRedType(t)}
                      className={`flex-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                        caseRedType === t
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
                    <label className="mb-1 block text-[10px] font-semibold text-muted">
                      Part école ({caseRedType === "percent" ? "%" : "DA"})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={caseRedSchool || ""}
                      onChange={(e) => setCaseRedSchool(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">
                      Part enseignant ({caseRedType === "percent" ? "%" : "DA"})
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={caseRedTeacher || ""}
                      onChange={(e) => setCaseRedTeacher(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
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

            <ClassTimingPicker selectedSubIds={subIds} onToggle={toggleTiming} />

            {subIds.length > 0 && (
              <div className="space-y-2">
                <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted">
                  <Wallet className="h-3 w-3" />{" "}
                  {isEdit
                    ? "Solde à AJOUTER sur chaque emploi du temps (laisser 0 pour ne rien encaisser)"
                    : "Solde versé pour chaque emploi du temps"}
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
                          onClick={() => setSubIds(subIds.filter((id) => id !== subId))}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Retirer cet emploi du temps"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

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

                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        {offered ? (
                          <span className="text-[10px] font-semibold text-success">
                            Rien à encaisser sur cet emploi du temps.
                          </span>
                        ) : (
                          <>
                            <div>
                              <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                                {isEdit ? "Solde à ajouter (DA)" : "Solde payé (DA)"}
                              </label>
                              <Input
                                type="number"
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
                    {isEdit ? "Total encaissé maintenant" : "Total versé à l'inscription"}
                  </span>
                  <strong className="text-sm text-primary">{formatDA(totalSold)}</strong>
                </div>

                <p className="text-[10px] text-muted">
                  ℹ️ L&apos;élève entre sur chaque emploi du temps LÀ OÙ EN EST LE GROUPE : son
                  solde est versé sur ce mois-là, les séances déjà tenues avant lui restent vides
                  sur sa ligne et les mois précédents ne le comptent pas.
                </p>

                {paidSubIds.length > 0 && (school?.registrationFee ?? 0) > 0 && (
                  <p className="text-[10px] text-muted">
                    ℹ️ Frais d&apos;inscription uniques de{" "}
                    <strong className="text-ink">{formatDA(school!.registrationFee!)}</strong> ajoutés à sa
                    fiche.
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
