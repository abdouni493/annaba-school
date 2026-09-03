"use client";

/**
 * **SÉANCES LIBRES SOLO** — un ou plusieurs élèves NOMMÉS, hors de tout groupe.
 *
 * La réception fait la séance de bout en bout sur un seul écran :
 *
 *   1. l'ENSEIGNANT, la SALLE, le JOUR et les HORAIRES (heure et minute) ;
 *   2. les ÉLÈVES, un par un — on cherche d'abord la fiche de l'école, et si
 *      elle n'existe pas on tape simplement le nom. Autant d'élèves qu'on veut
 *      sur la même saisie ;
 *   3. une DESCRIPTION libre ;
 *   4. le PRIX TOTAL payé par UN élève, puis la part que l'ÉCOLE garde — ce qui
 *      revient à l'enseignant se calcule tout seul et s'affiche en clair.
 *
 * Puis la seule question qui compte pour la suite : **l'enseignant a-t-il
 * touché sa part ?**
 *
 *  · OUI  — la sortie de caisse est écrite tout de suite et la séance entre
 *           dans son historique comme réglée ;
 *  · NON  — la séance reste due, et elle le CRIE : sur le tableau de bord, sur
 *           la carte de l'enseignant et en haut de sa fiche. Un clic sur
 *           n'importe laquelle de ces alertes la solde, et son historique passe
 *           aussitôt de « à verser » à « versée ».
 *
 * Cette séance-là ne passe JAMAIS par l'écran de paie mensuelle : elle
 * n'appartient à aucun mois et à aucun emploi du temps, elle se règle ici.
 */

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { TicketsAsk, type PrintableTicket } from "@/components/ui/TicketsAsk";
import { printHtmlDocument } from "@/lib/print";
import { soloSeancePayslipHtml, soloSeanceTicketHtml } from "@/lib/reports/soloSeance";
import { formatDA } from "@/lib/utils";
import {
  formatDateFr,
  registrationNumberOf,
  salleName as salleNameOf,
  soloSeanceTotals,
  studentMatches,
  studentName,
  todayIso,
  unpaidSoloSeanceTotal,
} from "@/lib/helpers";
import { useAccessRights } from "@/lib/usePermissions";
import { canDoAction } from "@/lib/permissions";
import type { SoloSeance, SoloSeanceAttendee, Student } from "@/lib/types";
import {
  AlertTriangle,
  BadgeCheck,
  CalendarRange,
  Clock,
  Eye,
  HandCoins,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

interface Draft {
  id: string;
  teacherId: string;
  salleId: string;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  attendees: SoloSeanceAttendee[];
  pricePerStudent: number;
  schoolPerStudent: number;
  teacherPaid: boolean;
}

const emptyDraft = (): Draft => ({
  id: uid("sol"),
  teacherId: "",
  salleId: "",
  title: "",
  description: "",
  date: todayIso(),
  startTime: "08:00",
  endTime: "10:00",
  attendees: [],
  pricePerStudent: 0,
  schoolPerStudent: 0,
  teacherPaid: false,
});

export function SoloSeancePage() {
  const db = useData();
  const {
    soloSeances,
    teachers,
    salles,
    students,
    saveSoloSeance,
    deleteSoloSeance,
    setSoloSeanceTeacherPaid,
  } = db;
  const { language } = useSettings();
  const { addToast } = useToast();
  const rights = useAccessRights();
  const can = (action: string) => canDoAction(rights, "soloSeances", action);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherQuery, setTeacherQuery] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [freeName, setFreeName] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [details, setDetails] = useState<SoloSeance | null>(null);
  const [tickets, setTickets] = useState<PrintableTicket[]>([]);

  const teacherName = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };

  const totals = soloSeanceTotals(draft);

  const rows = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return [...soloSeances]
      .filter((g) => (onlyUnpaid ? !g.teacherPaid : true))
      .filter((g) =>
        q
          ? `${g.title} ${g.description ?? ""} ${teacherName(g.teacherId)} ${(g.attendees ?? [])
              .map((a) => a.name)
              .join(" ")}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => `${b.date}${b.createdAt ?? ""}`.localeCompare(`${a.date}${a.createdAt ?? ""}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloSeances, listQuery, onlyUnpaid, teachers]);

  const grand = rows.reduce(
    (acc, g) => {
      const t = soloSeanceTotals(g);
      acc.total += t.total;
      acc.school += t.schoolTotal;
      acc.teacher += t.teacherTotal;
      acc.students += t.students;
      return acc;
    },
    { total: 0, school: 0, teacher: 0, students: 0 },
  );
  const owed = unpaidSoloSeanceTotal(db);

  // ---- la saisie -----------------------------------------------------------

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setTeacherQuery("");
    setStudentQuery("");
    setFreeName("");
    setFormOpen(true);
  };

  const openEdit = (g: SoloSeance) => {
    setDraft({
      id: g.id,
      teacherId: g.teacherId,
      salleId: g.salleId ?? "",
      title: g.title,
      description: g.description ?? "",
      date: g.date,
      startTime: g.startTime,
      endTime: g.endTime,
      attendees: [...(g.attendees ?? [])],
      pricePerStudent: g.pricePerStudent,
      schoolPerStudent: g.schoolPerStudent,
      teacherPaid: g.teacherPaid,
    });
    setEditingId(g.id);
    setTeacherQuery("");
    setStudentQuery("");
    setFreeName("");
    setFormOpen(true);
  };

  /** Un élève DÉJÀ CONNU de l'école : sa fiche suit la séance dans son historique. */
  const addStudent = (s: Student) => {
    if (draft.attendees.some((a) => a.studentId === s.id)) return;
    setDraft((d) => ({
      ...d,
      attendees: [...d.attendees, { studentId: s.id, name: studentName(s) }],
    }));
    setStudentQuery("");
  };

  /** Un élève que l'école ne connaît pas : on ne lui crée pas de fiche pour une
   *  séance — son nom suffit, exactement comme pour un passager. */
  const addFreeName = () => {
    const name = freeName.trim();
    if (!name) return;
    setDraft((d) => ({ ...d, attendees: [...d.attendees, { name }] }));
    setFreeName("");
  };

  const removeAttendee = (index: number) =>
    setDraft((d) => ({ ...d, attendees: d.attendees.filter((_, i) => i !== index) }));

  const submit = async () => {
    if (!draft.teacherId) {
      addToast({
        type: "danger",
        title: "Enseignant manquant",
        message: "Choisissez l'enseignant qui donne cette séance.",
      });
      return;
    }
    if (!draft.title.trim()) {
      addToast({
        type: "danger",
        title: "Intitulé manquant",
        message: "Nommez cette séance — c'est ce qui figure sur les bons et sur la fiche de paie.",
      });
      return;
    }
    if (totals.students <= 0) {
      addToast({
        type: "danger",
        title: "Aucun élève",
        message: "Ajoutez au moins un élève : une fiche de l'école, ou simplement un nom.",
      });
      return;
    }
    if (totals.pricePerStudent <= 0) {
      addToast({
        type: "danger",
        title: "Prix manquant",
        message: "Indiquez ce qu'un élève paie pour cette séance.",
      });
      return;
    }

    const row: SoloSeance = {
      id: draft.id,
      teacherId: draft.teacherId,
      salleId: draft.salleId || undefined,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      attendees: totals.attendees,
      pricePerStudent: totals.pricePerStudent,
      schoolPerStudent: totals.schoolPerStudent,
      teacherPaid: draft.teacherPaid,
      createdAt: new Date().toISOString(),
    };

    const res = await saveSoloSeance(row);
    if (!res.ok) {
      addToast({ type: "danger", title: "Enregistrement impossible", message: "Réessayez." });
      return;
    }
    setFormOpen(false);
    addToast({
      type: "success",
      title: editingId ? "Séance libre solo modifiée" : "Séance libre solo créée",
      message: draft.teacherPaid
        ? `${formatDA(totals.total)} encaissés · ${formatDA(totals.teacherTotal)} versés à ${teacherName(
            draft.teacherId,
          )}.`
        : `${formatDA(totals.total)} encaissés · ${formatDA(
            totals.teacherTotal,
          )} restent à verser à ${teacherName(draft.teacherId)} — l'alerte est en place.`,
    });
    if (!editingId) openTickets(row);
  };

  const remove = async (g: SoloSeance) => {
    if (
      !confirm(
        `Supprimer « ${g.title} » ?\nLa recette et, si elle a été versée, la part de l'enseignant seront retirées de la caisse et des rapports.`,
      )
    )
      return;
    const res = await deleteSoloSeance(g.id);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Séance supprimée" : "Suppression impossible",
      message: res.ok ? "Caisse, fiche enseignant et rapports mis à jour." : "Réessayez.",
    });
  };

  /** « Il a touché sa part » — le geste que toutes les alertes proposent. */
  const settle = async (g: SoloSeance, paid: boolean) => {
    const res = await setSoloSeanceTeacherPaid(g.id, paid);
    if (!res.ok) {
      addToast({ type: "danger", title: "Opération impossible", message: "Réessayez." });
      return;
    }
    addToast({
      type: "success",
      title: paid ? "Part versée à l'enseignant" : "Versement annulé",
      message: paid
        ? `${formatDA(res.amount ?? 0)} versés à ${teacherName(g.teacherId)} — l'alerte disparaît.`
        : `La part de ${teacherName(g.teacherId)} redevient due : l'alerte est de retour.`,
    });
  };

  // ---- les documents -------------------------------------------------------

  /** Un bon par élève : chacun repart avec le sien, et chacun se réimprime seul. */
  const openTickets = (g: SoloSeance) => {
    const t = soloSeanceTotals(g);
    setTickets(
      t.attendees.map((a, i) => {
        const student = a.studentId ? students.find((s) => s.id === a.studentId) : undefined;
        return {
          id: `${g.id}-${i}`,
          title: a.name,
          subtitle: `${g.title} · ${formatDateFr(g.date)} · ${g.startTime} - ${g.endTime}`,
          amount: t.pricePerStudent,
          html: soloSeanceTicketHtml(db, {
            seance: g,
            payer: a.name,
            registrationNumber: student ? registrationNumberOf(db, student) : undefined,
            language,
          }),
        };
      }),
    );
  };

  const printPayslip = (g: SoloSeance) => {
    const teacher = teachers.find((t) => t.id === g.teacherId);
    if (!teacher) return;
    printHtmlDocument(soloSeancePayslipHtml(db, { seance: g, teacher, language }));
  };

  const shownTeachers = teachers.filter((t) =>
    `${t.firstName} ${t.lastName} ${t.phone ?? ""}`.toLowerCase().includes(teacherQuery.toLowerCase()),
  );
  const shownStudents =
    studentQuery.trim().length >= 1
      ? students.filter((s) => studentMatches(db, s, studentQuery)).slice(0, 8)
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <PageHeader
          emoji="🎟️"
          title="Séances Libres Solo"
          subtitle="Une séance vendue à des élèves nommés, hors de tout groupe — la part de l'enseignant se règle ici"
        />
        {can("create") && (
          <Button onClick={openCreate} className="gap-2 self-start sm:self-center">
            <Plus className="h-4 w-4" /> Nouvelle séance solo
          </Button>
        )}
      </div>

      {/* ---- L'ALERTE : ce que l'école doit encore aux enseignants --------- */}
      {owed > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
            <div>
              <strong className="block text-sm text-danger">
                {formatDA(owed)} de séances libres solo restent à verser
              </strong>
              <span className="block text-[11px] text-danger/80">
                Chaque séance non réglée s&apos;affiche aussi sur le tableau de bord et sur la fiche
                de l&apos;enseignant concerné.
              </span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOnlyUnpaid(true)} className="gap-1.5">
            <HandCoins className="h-3.5 w-3.5" /> Voir les séances à régler
          </Button>
        </div>
      )}

      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Séances" value={String(rows.length)} tone="text-ink" />
            <Tile label="Élèves cumulés" value={String(grand.students)} tone="text-primary" />
            <Tile label="Total encaissé" value={formatDA(grand.total)} tone="text-success" />
            <Tile label="Part école" value={formatDA(grand.school)} tone="text-primary" />
            <Tile label="À verser" value={formatDA(owed)} tone={owed > 0 ? "text-danger" : "text-muted"} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Rechercher — intitulé, enseignant ou nom d'élève…"
                className="pl-9"
              />
            </div>
            <Button
              size="sm"
              variant={onlyUnpaid ? "primary" : "outline"}
              onClick={() => setOnlyUnpaid((v) => !v)}
              className="gap-1.5"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> À régler seulement
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-xs italic text-muted">
              {onlyUnpaid
                ? "Aucune séance en attente de règlement."
                : "Aucune séance libre solo pour le moment."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-canvas/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5">Date &amp; horaire</th>
                    <th className="px-3 py-2.5">Séance</th>
                    <th className="px-3 py-2.5">Enseignant</th>
                    <th className="px-3 py-2.5">Élèves</th>
                    <th className="px-3 py-2.5 text-right">Prix / élève</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">École</th>
                    <th className="px-3 py-2.5 text-right">Enseignant</th>
                    <th className="px-3 py-2.5 text-center">Part versée</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const t = soloSeanceTotals(g);
                    return (
                      <tr
                        key={g.id}
                        className={`border-t border-line/60 ${
                          g.teacherPaid ? "hover:bg-primary-50/30" : "bg-danger/5"
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <span className="block font-semibold text-ink">{formatDateFr(g.date)}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {g.startTime} → {g.endTime}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <strong className="block text-ink">{g.title}</strong>
                          <span className="block text-[10px] text-muted">
                            {g.salleId ? `Salle ${salleNameOf(db, g.salleId)}` : "Salle non précisée"}
                            {g.description ? ` · ${g.description}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-muted">{teacherName(g.teacherId)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {t.attendees.slice(0, 3).map((a, i) => (
                              <Badge
                                key={`${g.id}-a-${i}`}
                                tone={a.studentId ? "primary" : "neutral"}
                                className="text-[9px]"
                                title={a.studentId ? "Élève inscrit à l'école" : "Nom saisi à la main"}
                              >
                                {a.name}
                              </Badge>
                            ))}
                            {t.students > 3 && (
                              <Badge tone="neutral" className="text-[9px]">
                                +{t.students - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatDA(t.pricePerStudent)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-success">
                          {formatDA(t.total)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-primary">
                          {formatDA(t.schoolTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-warning">
                          {formatDA(t.teacherTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {g.teacherPaid ? (
                            <Badge tone="success" className="gap-1 text-[9px]">
                              <BadgeCheck className="h-3 w-3" /> Versée
                            </Badge>
                          ) : can("pay_teacher") ? (
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => settle(g, true)}
                              className="gap-1 text-[10px]"
                              title="Marquer la part de l'enseignant comme versée — l'alerte disparaît partout"
                            >
                              <HandCoins className="h-3 w-3" /> À verser
                            </Button>
                          ) : (
                            <Badge tone="danger" className="text-[9px]">
                              À verser
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn title="Voir le détail" onClick={() => setDetails(g)}>
                              <Eye className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Imprimer les bons des élèves" onClick={() => openTickets(g)}>
                              <Printer className="h-3.5 w-3.5" />
                            </IconBtn>
                            {can("edit") && (
                              <IconBtn title="Modifier" onClick={() => openEdit(g)} tone="text-warning">
                                <Pencil className="h-3.5 w-3.5" />
                              </IconBtn>
                            )}
                            {can("delete") && (
                              <IconBtn title="Supprimer" onClick={() => remove(g)} tone="text-danger">
                                <Trash2 className="h-3.5 w-3.5" />
                              </IconBtn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- la saisie ---------------------------------------------------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "Modifier la séance libre solo" : "Nouvelle séance libre solo"}
        wide
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* --- colonne 1 : le cadre de la séance --- */}
          <div className="space-y-4">
            <Field label="Nom de la séance">
              <Input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Ex : Rattrapage de maths — samedi matin"
              />
            </Field>

            <Field label="Enseignant">
              <Input
                value={teacherQuery}
                onChange={(e) => setTeacherQuery(e.target.value)}
                placeholder="Rechercher un enseignant…"
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
                {shownTeachers.length === 0 ? (
                  <p className="p-2 text-center text-[11px] italic text-muted">Aucun enseignant.</p>
                ) : (
                  shownTeachers.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, teacherId: t.id })}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-xs transition-colors ${
                        draft.teacherId === t.id
                          ? "bg-primary text-white"
                          : "text-ink hover:bg-primary-50"
                      }`}
                    >
                      <span>
                        {t.firstName} {t.lastName}
                      </span>
                      {t.isPassager && (
                        <span className="text-[9px] opacity-80">passager</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </Field>

            <Field label="Salle">
              <select
                value={draft.salleId}
                onChange={(e) => setDraft({ ...draft, salleId: e.target.value })}
                className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
              >
                <option value="">— Salle non précisée —</option>
                {salles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Date">
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="Début">
                <Input
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                />
              </Field>
              <Field label="Fin">
                <Input
                  type="time"
                  value={draft.endTime}
                  onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Description (facultative)">
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
                placeholder="Ce qui a été fait pendant la séance, ce qu'il faut en retenir…"
                className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink"
              />
            </Field>
          </div>

          {/* --- colonne 2 : les élèves et l'argent --- */}
          <div className="space-y-4">
            <Field label="Élèves de l'école">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  placeholder="Chercher un élève — nom ou n° d'inscription…"
                  className="pl-9"
                />
              </div>
              {shownStudents.length > 0 && (
                <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
                  {shownStudents.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => addStudent(s)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-xs text-ink transition-colors hover:bg-primary-50"
                    >
                      <span>{studentName(s)}</span>
                      <span className="font-mono text-[10px] text-muted">
                        {registrationNumberOf(db, s)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[10px] text-muted">
                Sa fiche suivra la séance : elle apparaîtra dans son historique, sur « Voir les
                détails ».
              </p>
            </Field>

            <Field label="…ou un élève que l'école ne connaît pas">
              <div className="flex gap-2">
                <Input
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFreeName();
                    }
                  }}
                  placeholder="Nom et prénom…"
                />
                <Button variant="outline" onClick={addFreeName} className="shrink-0 gap-1.5">
                  <UserPlus className="h-4 w-4" /> Ajouter
                </Button>
              </div>
            </Field>

            <div className="rounded-xl border border-line bg-canvas/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong className="flex items-center gap-1.5 text-xs text-ink">
                  <Users className="h-3.5 w-3.5 text-primary" /> Élèves de la séance
                </strong>
                <Badge tone="primary" className="font-mono text-[10px]">
                  {totals.students}
                </Badge>
              </div>
              {draft.attendees.length === 0 ? (
                <p className="py-3 text-center text-[11px] italic text-muted">
                  Aucun élève pour l&apos;instant.
                </p>
              ) : (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {draft.attendees.map((a, i) => (
                    <div
                      key={`${a.studentId ?? "libre"}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
                    >
                      <span className="min-w-0 truncate text-ink">
                        {a.name}
                        <Badge
                          tone={a.studentId ? "primary" : "neutral"}
                          className="ms-1.5 text-[8px]"
                        >
                          {a.studentId ? "fiche" : "hors fiche"}
                        </Badge>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttendee(i)}
                        className="shrink-0 rounded-lg p-1 text-danger hover:bg-danger/10"
                        title="Retirer de la séance"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Prix total pour UN élève">
                <Input
                  type="number"
                  min={0}
                  value={draft.pricePerStudent || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, pricePerStudent: Number(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="Part de l'école sur ce prix">
                <Input
                  type="number"
                  min={0}
                  value={draft.schoolPerStudent || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, schoolPerStudent: Number(e.target.value) || 0 })
                  }
                />
              </Field>
            </div>

            {/* Le calcul, sous les yeux : ce que l'enseignant touche est ce qui
                reste du prix une fois la part de l'école retirée. */}
            <div className="space-y-1.5 rounded-xl border border-primary/30 bg-primary-50/40 p-3 text-[11px]">
              <Line label="Part de l'enseignant par élève" value={formatDA(totals.teacherPerStudent)} />
              <Line label={`Total encaissé (${totals.students} élève(s))`} value={formatDA(totals.total)} />
              <Line label="Dont part de l'école" value={formatDA(totals.schoolTotal)} />
              <Line
                label="Dont part de l'enseignant"
                value={formatDA(totals.teacherTotal)}
                strong
              />
            </div>

            {/* LA QUESTION QUI DÉCLENCHE (OU NON) L'ALERTE. */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                draft.teacherPaid
                  ? "border-success/40 bg-success/10"
                  : "border-danger/40 bg-danger/10"
              }`}
            >
              <input
                type="checkbox"
                checked={draft.teacherPaid}
                onChange={(e) => setDraft({ ...draft, teacherPaid: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-current"
              />
              <span className="text-[11px] leading-relaxed">
                <strong className="block text-ink">
                  L&apos;enseignant a touché sa part ({formatDA(totals.teacherTotal)})
                </strong>
                <span className={draft.teacherPaid ? "text-success" : "text-danger"}>
                  {draft.teacherPaid
                    ? "La sortie de caisse est écrite tout de suite et la séance entre dans son historique comme réglée."
                    : "La séance reste due : une alerte s'affichera sur le tableau de bord, sur sa carte et sur sa fiche, jusqu'à ce qu'elle soit versée."}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setFormOpen(false)}>
            Annuler
          </Button>
          <Button onClick={submit} className="gap-1.5">
            <CalendarRange className="h-4 w-4" />
            {editingId ? "Enregistrer les modifications" : "Créer la séance"}
          </Button>
        </div>
      </Modal>

      {/* ---- le détail ---------------------------------------------------- */}
      <Modal
        open={details !== null}
        onClose={() => setDetails(null)}
        title="Détail de la séance libre solo"
      >
        {details && (
          <SoloDetails
            seance={details}
            teacherLabel={teacherName(details.teacherId)}
            room={details.salleId ? salleNameOf(db, details.salleId) : ""}
            onPrintTickets={() => openTickets(details)}
            onPrintPayslip={() => printPayslip(details)}
            onSettle={() => settle(details, !details.teacherPaid)}
            canSettle={can("pay_teacher")}
          />
        )}
      </Modal>

      {tickets.length > 0 && <TicketsAsk tickets={tickets} onClose={() => setTickets([])} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SoloDetails({
  seance,
  teacherLabel,
  room,
  onPrintTickets,
  onPrintPayslip,
  onSettle,
  canSettle,
}: {
  seance: SoloSeance;
  teacherLabel: string;
  room: string;
  onPrintTickets: () => void;
  onPrintPayslip: () => void;
  onSettle: () => void;
  canSettle: boolean;
}) {
  const t = soloSeanceTotals(seance);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/30 bg-primary-50/40 p-3">
        <strong className="block text-sm text-ink">{seance.title}</strong>
        <span className="block text-[11px] text-muted">
          {formatDateFr(seance.date)} ·{" "}
          <span className="font-mono">
            {seance.startTime} → {seance.endTime}
          </span>
          {room ? ` · Salle ${room}` : ""}
        </span>
        <span className="block text-[11px] text-muted">Enseignant : {teacherLabel}</span>
        {seance.description && (
          <p className="mt-1.5 text-[11px] text-ink">{seance.description}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Élèves" value={String(t.students)} tone="text-primary" />
        <Tile label="Encaissé" value={formatDA(t.total)} tone="text-success" />
        <Tile label="Part école" value={formatDA(t.schoolTotal)} tone="text-primary" />
        <Tile
          label={seance.teacherPaid ? "Versé à l'enseignant" : "À verser"}
          value={formatDA(t.teacherTotal)}
          tone={seance.teacherPaid ? "text-success" : "text-danger"}
        />
      </div>

      <div className="rounded-2xl border border-line">
        <div className="border-b border-line bg-canvas/60 px-3 py-2">
          <strong className="flex items-center gap-1.5 text-xs text-ink">
            <Users className="h-3.5 w-3.5 text-primary" /> Les élèves
          </strong>
        </div>
        <div className="max-h-52 divide-y divide-line/60 overflow-y-auto">
          {t.attendees.map((a, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="text-ink">
                {a.name}
                <Badge tone={a.studentId ? "primary" : "neutral"} className="ms-1.5 text-[8px]">
                  {a.studentId ? "fiche de l'école" : "hors fiche"}
                </Badge>
              </span>
              <span className="font-mono text-muted">{formatDA(t.pricePerStudent)}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 ${
          seance.teacherPaid ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"
        }`}
      >
        <span className="flex items-center gap-2 text-[11px]">
          {seance.teacherPaid ? (
            <>
              <BadgeCheck className="h-4 w-4 text-success" />
              <span className="text-success">
                Part versée{seance.teacherPaidAt ? ` le ${formatDateFr(seance.teacherPaidAt)}` : ""}.
              </span>
            </>
          ) : (
            <>
              <Clock className="h-4 w-4 text-danger" />
              <span className="text-danger">
                {formatDA(t.teacherTotal)} restent à verser à l&apos;enseignant.
              </span>
            </>
          )}
        </span>
        {canSettle && (
          <Button
            size="sm"
            variant={seance.teacherPaid ? "outline" : "danger"}
            onClick={onSettle}
            className="gap-1.5"
          >
            <HandCoins className="h-3.5 w-3.5" />
            {seance.teacherPaid ? "Annuler le versement" : "Il a touché sa part"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onPrintTickets} className="gap-1.5">
          <Printer className="h-4 w-4" /> Bons des élèves
        </Button>
        <Button variant="outline" onClick={onPrintPayslip} className="gap-1.5">
          <Printer className="h-4 w-4" /> Fiche de paie
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block font-sans text-xs font-semibold text-muted">{label}</label>
      {children}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-3 text-center">
      <span className="block text-[10px] font-semibold uppercase text-muted">{label}</span>
      <strong className={`block font-mono text-sm ${tone}`}>{value}</strong>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-mono ${strong ? "font-black text-primary" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  tone = "text-primary",
  children,
}: {
  title: string;
  onClick: () => void;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition-colors hover:bg-primary-50 ${tone}`}
    >
      {children}
    </button>
  );
}
