"use client";

/**
 * **Séances libres de GROUPE** — une séance ponctuelle vendue à un groupe
 * entier, sans nommer un seul élève.
 *
 * La réception choisit l'enseignant, la date, les horaires, nomme la séance,
 * puis tape trois nombres : combien d'élèves, combien paie un élève, et combien
 * l'école garde sur ce prix. Tout le reste se calcule :
 *
 *     part enseignant par élève = prix élève − part école
 *     total encaissé            = élèves × prix élève
 *     total école               = élèves × part école
 *     total enseignant          = élèves × part enseignant
 *
 * À la création, l'écran propose d'imprimer la **fiche de paie** de
 * l'enseignant — qui n'affiche jamais la part de l'école. La séance apparaît
 * ensuite dans l'historique de paiement de l'enseignant, dans la caisse et dans
 * les rapports ; la modifier ou la supprimer déplace ces trois-là avec elle.
 */

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { printHtmlDocument } from "@/lib/print";
import { groupSeancePayslipHtml } from "@/lib/reports/groupSeance";
import { formatDA } from "@/lib/utils";
import { formatDateFr, groupSeanceTotals, todayIso } from "@/lib/helpers";
import type { GroupSeance } from "@/lib/types";
import {
  CalendarRange,
  Edit,
  Eye,
  Printer,
  Search,
  Trash2,
  Users,
  UsersRound,
} from "lucide-react";

interface Draft {
  id: string;
  teacherId: string;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  studentsCount: number;
  pricePerStudent: number;
  schoolPerStudent: number;
}

const emptyDraft = (): Draft => ({
  id: uid("gsl"),
  teacherId: "",
  title: "",
  description: "",
  date: todayIso(),
  startTime: "08:00",
  endTime: "10:00",
  studentsCount: 0,
  pricePerStudent: 0,
  schoolPerStudent: 0,
});

export function GroupSeanceSection() {
  const db = useData();
  const { groupSeances, teachers, saveGroupSeance, deleteGroupSeance } = db;
  const { language } = useSettings();
  const { addToast } = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teacherQuery, setTeacherQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [details, setDetails] = useState<GroupSeance | null>(null);
  /** la séance qu'on vient de créer : on propose sa fiche de paie */
  const [printAsk, setPrintAsk] = useState<GroupSeance | null>(null);

  const teacherName = (id: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };

  const rows = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return [...groupSeances]
      .filter((g) =>
        q ? `${g.title} ${g.description ?? ""} ${teacherName(g.teacherId)}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSeances, listQuery, teachers]);

  const totals = groupSeanceTotals(draft);
  const grand = rows.reduce(
    (acc, g) => {
      const t = groupSeanceTotals(g);
      acc.total += t.total;
      acc.school += t.schoolTotal;
      acc.teacher += t.teacherTotal;
      acc.students += t.students;
      return acc;
    },
    { total: 0, school: 0, teacher: 0, students: 0 },
  );

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setTeacherQuery("");
    setFormOpen(true);
  };

  const openEdit = (g: GroupSeance) => {
    setDraft({
      id: g.id,
      teacherId: g.teacherId,
      title: g.title,
      description: g.description ?? "",
      date: g.date,
      startTime: g.startTime,
      endTime: g.endTime,
      studentsCount: g.studentsCount,
      pricePerStudent: g.pricePerStudent,
      schoolPerStudent: g.schoolPerStudent,
    });
    setEditingId(g.id);
    setTeacherQuery("");
    setFormOpen(true);
  };

  const submit = async () => {
    if (!draft.teacherId) {
      addToast({ type: "danger", title: "Enseignant manquant", message: "Sélectionnez l'enseignant de la séance." });
      return;
    }
    if (!draft.title.trim()) {
      addToast({ type: "danger", title: "Intitulé manquant", message: "Nommez cette séance libre." });
      return;
    }
    if (totals.students <= 0 || totals.pricePerStudent <= 0) {
      addToast({
        type: "danger",
        title: "Chiffres incomplets",
        message: "Indiquez le nombre d'élèves et le prix payé par un élève.",
      });
      return;
    }

    const row: GroupSeance = {
      id: draft.id,
      teacherId: draft.teacherId,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      studentsCount: totals.students,
      pricePerStudent: totals.pricePerStudent,
      schoolPerStudent: totals.schoolPerStudent,
      createdAt: new Date().toISOString(),
    };
    const res = await saveGroupSeance(row);
    if (!res.ok) {
      addToast({ type: "danger", title: "Enregistrement impossible", message: "Réessayez." });
      return;
    }
    setFormOpen(false);
    addToast({
      type: "success",
      title: editingId ? "Séance libre modifiée" : "Séance libre créée",
      message: `${formatDA(totals.total)} encaissés · ${formatDA(totals.teacherTotal)} pour ${teacherName(
        draft.teacherId,
      )} · caisse et rapports mis à jour.`,
    });
    if (!editingId) setPrintAsk(row);
  };

  const remove = async (g: GroupSeance) => {
    if (
      !confirm(
        `Supprimer « ${g.title} » ?\nLa recette et la paie de l'enseignant seront retirées de la caisse, de sa fiche et des rapports.`,
      )
    )
      return;
    const res = await deleteGroupSeance(g.id);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Séance libre supprimée" : "Suppression impossible",
      message: res.ok ? "Caisse, fiche enseignant et rapports mis à jour." : "Réessayez.",
    });
  };

  const printPayslip = (g: GroupSeance) => {
    const teacher = teachers.find((t) => t.id === g.teacherId);
    if (!teacher) return;
    printHtmlDocument(groupSeancePayslipHtml(db, { seance: g, teacher, language }));
  };

  const shownTeachers = teachers.filter((t) =>
    `${t.firstName} ${t.lastName} ${t.phone ?? ""}`.toLowerCase().includes(teacherQuery.toLowerCase()),
  );

  return (
    <>
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-base font-black text-ink">
                <UsersRound className="h-5 w-5 text-primary" /> Séances libres de groupe
              </h3>
              <p className="text-[11px] text-muted">
                Une séance ponctuelle vendue à un groupe entier — on saisit le nombre d&apos;élèves,
                pas leurs noms.
              </p>
            </div>
            <Button onClick={openCreate} className="gap-2">
              <UsersRound className="h-4 w-4" /> Nouvelle séance de groupe
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Séances" value={String(rows.length)} tone="text-ink" />
            <Tile label="Élèves cumulés" value={String(grand.students)} tone="text-primary" />
            <Tile label="Total encaissé" value={formatDA(grand.total)} tone="text-success" />
            <Tile label="Part enseignants" value={formatDA(grand.teacher)} tone="text-warning" />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Rechercher une séance de groupe — intitulé ou enseignant…"
              className="pl-9"
            />
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Aucune séance libre de groupe pour le moment.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[900px] text-xs">
                <thead className="bg-canvas/60">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5">Date &amp; horaire</th>
                    <th className="px-3 py-2.5">Séance</th>
                    <th className="px-3 py-2.5">Enseignant</th>
                    <th className="px-3 py-2.5 text-center">Élèves</th>
                    <th className="px-3 py-2.5 text-right">Prix / élève</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">École</th>
                    <th className="px-3 py-2.5 text-right">Enseignant</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const t = groupSeanceTotals(g);
                    return (
                      <tr key={g.id} className="border-t border-line/60 hover:bg-primary-50/30">
                        <td className="px-3 py-2.5">
                          <span className="block font-semibold text-ink">{formatDateFr(g.date)}</span>
                          <span className="block font-mono text-[10px] text-muted">
                            {g.startTime} → {g.endTime}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <strong className="block text-ink">{g.title}</strong>
                          {g.description && (
                            <span className="block text-[10px] text-muted">{g.description}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted">{teacherName(g.teacherId)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge tone="primary" className="gap-1 font-mono">
                            <Users className="h-3 w-3" /> {t.students}
                          </Badge>
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
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn title="Voir les détails" onClick={() => setDetails(g)}>
                              <Eye className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Imprimer la fiche de paie" onClick={() => printPayslip(g)}>
                              <Printer className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Modifier" onClick={() => openEdit(g)}>
                              <Edit className="h-3.5 w-3.5" />
                            </IconBtn>
                            <IconBtn title="Supprimer" danger onClick={() => remove(g)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconBtn>
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

      {/* ---- create / edit ---------------------------------------------- */}
      {formOpen && (
        <Modal
          open
          onClose={() => setFormOpen(false)}
          title={editingId ? "Modifier la séance libre de groupe" : "Nouvelle séance libre de groupe"}
          wide
        >
          <div className="space-y-4">
            {/* enseignant */}
            <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                👨‍🏫 Enseignant
              </span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={teacherQuery}
                  onChange={(e) => setTeacherQuery(e.target.value)}
                  placeholder="Rechercher un enseignant…"
                  className="pl-9"
                />
              </div>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {shownTeachers.length === 0 ? (
                  <p className="py-3 text-center text-[11px] italic text-muted">
                    Aucun enseignant ne correspond.
                  </p>
                ) : (
                  shownTeachers.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, teacherId: t.id })}
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                        draft.teacherId === t.id
                          ? "border-primary bg-primary text-white"
                          : "border-line bg-surface text-ink hover:bg-primary-50"
                      }`}
                    >
                      <span>
                        {t.firstName} {t.lastName}
                      </span>
                      {t.phone && <span className="opacity-70">{t.phone}</span>}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* identité de la séance */}
            <div className="space-y-3 rounded-xl border border-line bg-canvas/30 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                🗓️ La séance
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Intitulé de la séance *
                  </label>
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Ex: Révision générale — Bac blanc"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Date *</label>
                  <Input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Heure de début *</label>
                  <Input
                    type="time"
                    value={draft.startTime}
                    onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">Heure de fin *</label>
                  <Input
                    type="time"
                    value={draft.endTime}
                    onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  Description (optionnel)
                </label>
                <Input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Ex: 3ᵉ AS — toutes séries"
                />
              </div>
            </div>

            {/* les chiffres */}
            <div className="space-y-3 rounded-xl border border-primary/25 bg-primary-50/40 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                💰 Les chiffres
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Nombre total d&apos;élèves *
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.studentsCount || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, studentsCount: Math.max(0, Number(e.target.value) || 0) })
                    }
                    placeholder="Ex: 25"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Prix de la séance / élève *
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.pricePerStudent || ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        pricePerStudent: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    placeholder="Ex: 500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    Part de l&apos;école / élève *
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.schoolPerStudent || ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        schoolPerStudent: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    placeholder="Ex: 200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile
                  label="Enseignant / élève"
                  value={formatDA(totals.teacherPerStudent)}
                  hint="prix élève − part école"
                  tone="text-warning"
                />
                <Tile label="Total encaissé" value={formatDA(totals.total)} hint={`${totals.students} × ${totals.pricePerStudent}`} tone="text-success" />
                <Tile label="Total école" value={formatDA(totals.schoolTotal)} tone="text-primary" />
                <Tile label="Total enseignant" value={formatDA(totals.teacherTotal)} tone="text-warning" />
              </div>
              {totals.schoolPerStudent >= totals.pricePerStudent && totals.pricePerStudent > 0 && (
                <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                  L&apos;école garde tout : cette séance ne rapporte rien à l&apos;enseignant.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Annuler
              </Button>
              <Button onClick={submit}>
                {editingId ? "Enregistrer les modifications" : "Créer la séance"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---- details ---------------------------------------------------- */}
      {details && (
        <Modal open onClose={() => setDetails(null)} title="Détails de la séance libre de groupe">
          {(() => {
            const t = groupSeanceTotals(details);
            return (
              <div className="space-y-3">
                <div className="rounded-xl bg-primary-50/60 p-3">
                  <strong className="block text-sm text-ink">{details.title}</strong>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <CalendarRange className="h-3 w-3" />
                    {formatDateFr(details.date)} ·{" "}
                    <span className="font-mono">
                      {details.startTime} → {details.endTime}
                    </span>{" "}
                    · {teacherName(details.teacherId)}
                  </span>
                  {details.description && (
                    <span className="mt-1 block text-[11px] text-ink">{details.description}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Élèves" value={String(t.students)} tone="text-ink" />
                  <Tile label="Prix / élève" value={formatDA(t.pricePerStudent)} tone="text-ink" />
                  <Tile label="Part école / élève" value={formatDA(t.schoolPerStudent)} tone="text-primary" />
                  <Tile
                    label="Part enseignant / élève"
                    value={formatDA(t.teacherPerStudent)}
                    tone="text-warning"
                  />
                  <Tile label="Total encaissé" value={formatDA(t.total)} tone="text-success" />
                  <Tile label="Total école" value={formatDA(t.schoolTotal)} tone="text-primary" />
                  <Tile label="Total enseignant" value={formatDA(t.teacherTotal)} tone="text-warning" />
                  <Tile
                    label="Créée le"
                    value={formatDateFr(details.createdAt.slice(0, 10))}
                    tone="text-muted"
                  />
                </div>
                <div className="flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="outline" onClick={() => setDetails(null)}>
                    Fermer
                  </Button>
                  <Button onClick={() => printPayslip(details)} className="gap-1.5">
                    <Printer className="h-4 w-4" /> Fiche de paie
                  </Button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* ---- « imprimer la fiche de paie ? » ------------------------------ */}
      {printAsk && (
        <Modal open onClose={() => setPrintAsk(null)} title="Impression">
          <div className="space-y-4">
            <p className="text-sm text-ink">
              Séance enregistrée. Imprimer la <strong>fiche de paie</strong> de{" "}
              {teacherName(printAsk.teacherId)} ?
            </p>
            <p className="text-[11px] text-muted">
              La fiche remise à l&apos;enseignant n&apos;affiche jamais la part de l&apos;école :
              seulement les élèves, sa part par élève et son total.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPrintAsk(null)}>
                Non, merci
              </Button>
              <Button
                onClick={() => {
                  printPayslip(printAsk);
                  setPrintAsk(null);
                }}
                className="gap-1.5"
              >
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
            </div>
          </div>
        </Modal>
      )}
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
      <strong className={`block font-mono text-sm ${tone}`}>{value}</strong>
      {hint && <span className="block text-[9px] text-muted">{hint}</span>}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-line transition-colors ${
        danger ? "text-danger hover:bg-danger/10" : "text-primary hover:bg-primary-50"
      }`}
    >
      {children}
    </button>
  );
}
