"use client";

/**
 * "Nouvel élève" — the ONE creation screen of the app.
 *
 * Used from the Élèves page, from the dashboard, and from a group's présence
 * sheet (where the emploi du temps of the group arrives pre-ticked).
 *
 * Reception types the identity, picks the billing case, ticks the emplois du
 * temps the student follows and — for EACH of them — how much the family pays
 * now: that money becomes the opening SOLDE of that emploi. Saving offers the
 * bon d'inscription, which prints the identity, the emplois and every solde.
 */

import { useEffect, useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { BookOpen, Check, Trash2, Wallet } from "lucide-react";
import { createRoleUser } from "@/lib/demo/users";
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
  monthlyPriceOf,
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

export function CreateStudentModal({
  open,
  onClose,
  /** emplois du temps ticked as soon as the screen opens (the group it was
   *  opened from, typically) */
  defaultSubIds = [],
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultSubIds?: string[];
  onCreated?: (student: Student) => void;
}) {
  const db = useData();
  const { school, teachers, subscriptions, push, addSold, setStudentPassword } = db;
  const { language } = useSettings();
  const { addToast } = useToast();
  const { subLabel } = useClassTimings();

  // identity
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");

  // billing case
  const [studentCase, setStudentCase] = useState<StudentCase>("normal");
  const [teacherFatherId, setTeacherFatherId] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [caseRedType, setCaseRedType] = useState<DiscountType>("percent");
  const [caseRedSchool, setCaseRedSchool] = useState(0);
  const [caseRedTeacher, setCaseRedTeacher] = useState(0);
  const [unpaidTeacherIds, setUnpaidTeacherIds] = useState<string[]>([]);

  // inscriptions + the solde paid on each of them
  const [subIds, setSubIds] = useState<string[]>(defaultSubIds);
  const [solds, setSolds] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [voucher, setVoucher] = useState<string | null>(null);

  useEffect(() => {
    if (open) setSubIds(defaultSubIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSubIds.join("|")]);

  const nextNumber = useMemo(() => nextRegistrationNumber(db), [db.students]);
  const isFree = studentCase === "special";
  const totalSold = subIds.reduce((s, id) => s + (solds[id] || 0), 0);

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
    setSolds({});
  };

  const toggleTiming = (option: ClassTimingOption) => {
    const next = toggleTimingSelection(subIds, option);
    setSubIds(next);
    setSolds((prev) => {
      const clean: Record<string, number> = {};
      for (const id of next) clean[id] = prev[id] ?? 0;
      return clean;
    });
  };

  /** Suggested opening solde of an emploi: the price of one of its months. */
  const suggestFor = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return 0;
    return monthlyPriceOf(sub) || sub.pricePerSession * cycleSizeOf(sub);
  };

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      addToast({
        type: "danger",
        title: "Champs manquants",
        message: "Prénom, nom et téléphone sont obligatoires.",
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

    // Credentials and badge are minted silently — the desk types name + phone.
    const base = `${firstName}${lastName}`.toLowerCase().replace(/\s+/g, "");
    const suffix = birthDate.replace(/-/g, "") || phone.replace(/\D/g, "").slice(-4) || "0000";
    const email = `${base}${suffix}@elilm.com`;
    const password = `${base}${suffix}`;
    const rfid = uid("rfid");

    const subscriptionDates: Record<string, SubscriptionDates> = {};
    for (const subId of subIds) {
      if (!subscriptions.some((s) => s.id === subId)) continue;
      subscriptionDates[subId] = { subscribedAt: todayIso(), startDate: todayIso() };
    }
    const registrationDue = subIds.length > 0 && !isFree ? school?.registrationFee || 0 : 0;

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

      // Each solde is credited on its own emploi, on its month M1.
      for (const subId of subIds) {
        const amount = Math.max(0, Math.round(solds[subId] || 0));
        if (amount <= 0) continue;
        await addSold({
          studentId,
          subscriptionId: subId,
          amount,
          monthCode: "M1",
          description: `Inscription — solde initial (${subLabel(subId)})`,
        });
      }

      addToast({
        type: "success",
        title: `Élève créé — N° ${nextNumber}`,
        message:
          subIds.length > 0
            ? `${subIds.length} emploi(s) du temps · ${formatDA(totalSold)} versés.`
            : "Aucun emploi du temps pour le moment.",
        studentName: `${firstName} ${lastName}`,
      });

      setVoucher(
        inscriptionVoucherHtml(db, {
          student,
          language,
          registrationFee: registrationDue,
          lines: subIds.map((subId) => {
            const sub = subscriptions.find((s) => s.id === subId);
            return {
              label: subLabel(subId),
              monthSeances: cycleSizeOf(sub),
              unitPrice: sub?.pricePerSession ?? 0,
              sold: Math.max(0, Math.round(solds[subId] || 0)),
              monthCode: "M1",
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
      <Modal open={open} onClose={onClose} title="Nouvel élève" wide>
        <div className="space-y-4">
          {/* identity */}
          <div className="rounded-xl border border-line bg-canvas/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                👤 Informations personnelles
              </span>
              <Badge tone="primary" className="font-mono">
                N° {nextNumber}
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Prénom *</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Amine" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Nom *</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Benali" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Téléphone *</label>
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
              <p className="rounded-lg bg-primary-50/50 p-2 text-[10px] text-muted">
                Études gratuites : ni l&apos;école ni l&apos;enseignant ne sont payés pour cet élève.
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
                  <Wallet className="h-3 w-3" /> Solde versé pour chaque emploi du temps
                </span>
                {subIds.map((subId) => {
                  const sub = subscriptions.find((s) => s.id === subId);
                  const suggestion = suggestFor(subId);
                  const unit = sub?.pricePerSession ?? 0;
                  const paid = solds[subId] || 0;
                  const seances = unit > 0 ? Math.floor(paid / unit) : 0;
                  return (
                    <div key={subId} className="rounded-xl border border-line bg-surface p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <strong className="block text-[11px] text-ink">{subLabel(subId)}</strong>
                          <span className="text-[10px] text-muted">
                            {cycleSizeOf(sub)} séances / mois · séance à {formatDA(unit)}
                            {suggestion > 0 ? ` · mois à ${formatDA(suggestion)}` : ""}
                          </span>
                        </div>
                        <button
                          onClick={() => setSubIds(subIds.filter((id) => id !== subId))}
                          className="shrink-0 text-muted hover:text-danger"
                          title="Retirer cet emploi du temps"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div>
                          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted">
                            Solde payé (DA)
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={paid || ""}
                            onChange={(e) =>
                              setSolds({ ...solds, [subId]: Math.max(0, Number(e.target.value) || 0) })
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
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary-50/40 px-3 py-2">
                  <span className="text-xs font-semibold text-muted">Total versé à l&apos;inscription</span>
                  <strong className="text-sm text-primary">{formatDA(totalSold)}</strong>
                </div>

                {!isFree && (school?.registrationFee ?? 0) > 0 && (
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
              {busy ? "Création…" : "Créer l'élève"}
            </Button>
          </div>
        </div>
      </Modal>

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
