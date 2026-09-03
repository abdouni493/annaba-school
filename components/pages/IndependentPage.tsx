"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  Calendar,
  Search,
  MoreVertical,
  Printer,
  X,
  Clock,
  Filter,
  LayoutGrid,
  Table as TableIcon,
  User,
  MapPin,
  Users,
} from "lucide-react";
import type { IndependentSession, Student } from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import {
  formatDateFr,
  independentTotals,
  registrationNumberOf,
  studentMatches,
} from "@/lib/helpers";
import { seanceLibreInvoiceHtml } from "@/lib/reports/documents";
import { TicketsAsk, type PrintableTicket } from "@/components/ui/TicketsAsk";
import { GroupSeanceSection } from "@/components/independent/GroupSeanceSection";
import { useSettings } from "@/lib/store/settings";
import { formatDA, money } from "@/lib/utils";

import { useCan } from "@/lib/usePermissions";
/** Everything the séance libre receipt needs, captured at creation time. */
interface CasualReceiptData {
  personName: string;
  /** set when the payer is a registered student */
  registrationNumber?: string;
  isRegisteredStudent: boolean;
  itemLabel: string;
  teacherName?: string;
  classLabel?: string;
  timeLabel?: string;
  price: number;
  date: string;
  createdAt: string;
}

/** One searchable item the reception can attach a séance libre to: either a
 *  regular course module, or a "séance libre" timing created in the planner. */
interface SeanceOption {
  key: string;
  kind: "cours" | "timing";
  label: string;
  price: number;
  sessionId: string;
  moduleName: string;
  classLabel: string;
  groupLabel: string;
  salleLabel: string;
  teacherName: string;
  teacherIsPassager: boolean;
  daysLabel: string;
  timeLabel: string;
  periodLabel?: string;
}
const DAY_LABELS: Record<string, string> = {
  saturday: "Sam",
  sunday: "Dim",
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
};

export function IndependentPage() {
  const can = useCan("independent");
  const db = useData();
  const {
    independent,
    teachers,
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    groups,
    salles,
    deleteFrom,
    updateItem,
    createPassagerSeances,
  } = db;
  const { language } = useSettings();

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedCasual, setSelectedCasual] = useState<IndependentSession | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Main list: search / filters / layout
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [listSearch, setListSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<"all" | "student" | "passager">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "cours" | "timing">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Form: séance libre
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [itemKindTab, setItemKindTab] = useState<"all" | "cours" | "timing">("all");
  const [selectedItem, setSelectedItem] = useState<SeanceOption | null>(null);
  const [casualDate, setCasualDate] = useState(new Date().toISOString().split("T")[0]);
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  /**
   * CE QUE L'ÉCOLE GARDE sur le prix. Le reste va à l'enseignant, et se règle
   * avec le mois de l'emploi du temps où la date tombe. `null` = pas encore
   * saisi : on prend alors le prix entier (l'école garde tout), qui est
   * exactement ce que faisaient les séances libres avant ce partage.
   */
  const [schoolShare, setSchoolShare] = useState<number | null>(null);
  /** Les élèves de passage saisis d'un coup — un nom par ligne, vide permis. */
  const [passagerNames, setPassagerNames] = useState<string[]>([""]);

  // Once a séance libre is created, immediately offer to print its receipt.
  const [receiptData, setReceiptData] = useState<CasualReceiptData | null>(null);
  /** les bons de la saisie qu'on vient de faire — un par élève, imprimables séparément */
  const [tickets, setTickets] = useState<PrintableTicket[]>([]);

  // ---- Helpers --------------------------------------------------------------

  const nameOf = <T extends { id: string; name: string }>(list: T[], id?: string) =>
    list.find((x) => x.id === id)?.name ?? "-";

  const getStudentName = (sid?: string) => {
    const s = students.find((st) => st.id === sid);
    return s ? `${s.firstName} ${s.lastName}` : "-";
  };

  const classLabelOf = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "-";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };

  /**
   * Everything the reception can attach a séance libre to:
   *   - "cours": a regular course module (its full context is displayed so the
   *     agent can tell two identical module names apart),
   *   - "timing": a séance libre créneau created on the Emploi du Temps page —
   *     selecting it loads that créneau's own price.
   * Perfectionnements are no longer part of this screen.
   */
  const seanceOptions = useMemo<SeanceOption[]>(() => {
    const list: SeanceOption[] = [];

    sessions.forEach((s) => {
      const sub = subscriptions.find((su) => su.sessionId === s.id);
      const t = teachers.find((te) => te.id === s.teacherId);
      const isOpen = !!s.isOpen;
      const classLabel = isOpen
        ? (s.classIds?.length ? s.classIds : [s.classId]).map(classLabelOf).join(" · ")
        : classLabelOf(s.classId);
      const groupLabel = isOpen
        ? (s.groupIds?.length ? s.groupIds : [s.groupId]).map((id) => nameOf(groups, id)).join(" · ")
        : nameOf(groups, s.groupId);
      const salleLabel = isOpen
        ? (s.salleIds?.length ? s.salleIds : [s.salleId]).map((id) => nameOf(salles, id)).join(" · ")
        : nameOf(salles, s.salleId);
      const moduleName = nameOf(modules, s.moduleId);

      list.push({
        key: s.id,
        kind: isOpen ? "timing" : "cours",
        label: isOpen ? s.title || `Séance Libre — ${moduleName}` : `${moduleName} — ${classLabel}`,
        price: sub?.pricePerSession ?? s.openPrice ?? 0,
        sessionId: s.id,
        moduleName,
        classLabel,
        groupLabel,
        salleLabel,
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        teacherIsPassager: !!t?.isPassager,
        daysLabel: s.days.map((d) => DAY_LABELS[d] ?? d).join(" · "),
        timeLabel: `${s.startTime} - ${s.endTime}`,
        periodLabel:
          isOpen && s.periodStart && s.periodEnd
            ? `${formatDateFr(s.periodStart)} → ${formatDateFr(s.periodEnd)}`
            : undefined,
      });
    });

    return list.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "timing" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, subscriptions, teachers, modules, classes, groups, salles]);

  const filteredOptions = seanceOptions.filter((o) => {
    if (itemKindTab !== "all" && o.kind !== itemKindTab) return false;
    if (!itemSearchQuery.trim()) return true;
    const q = itemSearchQuery.toLowerCase();
    return `${o.label} ${o.moduleName} ${o.classLabel} ${o.groupLabel} ${o.salleLabel} ${o.teacherName}`
      .toLowerCase()
      .includes(q);
  });

  /** Student lookup by name OR card number (RFID) — an empty selection means
   *  the attendee is recorded as a "passager". */
  const matchedStudents = useMemo(() => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return students.filter((st) => studentMatches(db, st, studentSearchQuery)).slice(0, 25);
  }, [students, studentSearchQuery]);

  const effectivePrice = customPrice ?? selectedItem?.price ?? 0;
  /** La part de l'école, bornée au prix : elle ne peut pas manger plus que tout. */
  const effectiveSchoolShare = Math.min(
    Math.max(0, schoolShare ?? effectivePrice),
    Math.max(0, effectivePrice),
  );
  const unitTeacherShare = money(Math.max(0, effectivePrice) - effectiveSchoolShare);
  /** Combien de personnes cette création enregistre : un élève nommé, ou N passagers. */
  const attendeeCount = selectedStudent || selectedCasual ? 1 : Math.max(1, passagerNames.length);
  const seanceTotals = {
    total: money(Math.max(0, effectivePrice) * attendeeCount),
    school: money(effectiveSchoolShare * attendeeCount),
    teacher: money(unitTeacherShare * attendeeCount),
  };

  /** Ajuste le nombre de passagers sans perdre les noms déjà tapés. */
  const setPassagerCount = (n: number) => {
    const next = Math.max(1, Math.min(60, n));
    setPassagerNames((prev) =>
      next <= prev.length ? prev.slice(0, next) : [...prev, ...Array(next - prev.length).fill("")],
    );
  };

  /** Reverse lookup used by the list/cards to describe a stored séance. */
  const optionForSession = (sessionId?: string) =>
    sessionId ? seanceOptions.find((o) => o.sessionId === sessionId) : undefined;

  // ---- Main list ------------------------------------------------------------

  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return independent
      .filter((ind) => {
        const person = ind.studentId ? getStudentName(ind.studentId) : ind.passagerName ?? "";
        if (q && !`${person} ${ind.itemLabel}`.toLowerCase().includes(q)) return false;
        if (payerFilter === "student" && !ind.studentId) return false;
        if (payerFilter === "passager" && ind.studentId) return false;
        if (kindFilter !== "all") {
          const opt = optionForSession(ind.sessionId);
          const kind = opt?.kind ?? "cours";
          if (kind !== kindFilter) return false;
        }
        if (fromDate && ind.date < fromDate) return false;
        if (toDate && ind.date > toDate) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [independent, listSearch, payerFilter, kindFilter, fromDate, toDate, students, seanceOptions]);

  const totalCollected = filteredList.reduce((s, i) => s + i.price, 0);

  const clearListFilters = () => {
    setListSearch("");
    setPayerFilter("all");
    setKindFilter("all");
    setFromDate("");
    setToDate("");
  };

  // ---- Create / edit --------------------------------------------------------

  const resetForm = () => {
    setSelectedStudent(null);
    setStudentSearchQuery("");
    setItemSearchQuery("");
    setItemKindTab("all");
    setSelectedItem(null);
    setCasualDate(new Date().toISOString().split("T")[0]);
    setCustomPrice(null);
    setSchoolShare(null);
    setPassagerNames([""]);
    setSelectedCasual(null);
  };

  const openCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (ind: IndependentSession) => {
    setSelectedCasual(ind);
    setCasualDate(ind.date);
    setCustomPrice(ind.price);
    setSchoolShare(ind.schoolShare ?? ind.price);
    setPassagerNames([ind.passagerName ?? ""]);

    const student = ind.studentId ? students.find((s) => s.id === ind.studentId) : undefined;
    setSelectedStudent(student ?? null);
    setStudentSearchQuery(student ? `${student.firstName} ${student.lastName}` : ind.passagerName ?? "");

    setSelectedItem(optionForSession(ind.sessionId) ?? null);
    setItemSearchQuery("");
    setItemKindTab("all");
    setIsFormOpen(true);
    setActiveMenuId(null);
  };

  const handleSubmit = async () => {
    if (!selectedItem) {
      alert("Veuillez sélectionner un cours ou un créneau de séance libre.");
      return;
    }

    const price = Math.max(0, effectivePrice);
    const school = effectiveSchoolShare;

    // ---- MODIFIER une séance déjà enregistrée -------------------------------
    // Une modification porte toujours sur UNE ligne : on ne « démultiplie » pas
    // une séance existante, on la corrige.
    if (selectedCasual) {
      const typed = studentSearchQuery.trim();
      updateItem("independent", selectedCasual.id, {
        studentId: selectedStudent ? selectedStudent.id : undefined,
        passagerName: selectedStudent ? undefined : typed || "Passager",
        itemLabel: selectedItem.label,
        price,
        schoolShare: school,
        teacherId: sessions.find((x) => x.id === selectedItem.sessionId)?.teacherId,
        date: casualDate,
        sessionId: selectedItem.sessionId,
        startTime: selectedItem.timeLabel.split(" - ")[0],
        endTime: selectedItem.timeLabel.split(" - ")[1],
      });
      setIsFormOpen(false);
      resetForm();
      return;
    }

    // ---- CRÉER : un élève nommé, ou autant de passagers qu'il en est venu ---
    // Les deux passent par la même écriture : la séance entre en caisse, la
    // part de l'enseignant part avec le mois où la date tombe.
    const names = selectedStudent
      ? [`${selectedStudent.firstName} ${selectedStudent.lastName}`]
      : passagerNames.map((n) => n.trim());

    const res = await createPassagerSeances({
      sessionId: selectedItem.sessionId,
      date: casualDate,
      names,
      price,
      schoolShare: school,
      itemLabel: selectedItem.label,
      startTime: selectedItem.timeLabel.split(" - ")[0],
      endTime: selectedItem.timeLabel.split(" - ")[1],
      studentId: selectedStudent?.id,
    });

    if (!res.ok) {
      alert("Cette séance libre n'a pas pu être enregistrée.");
      return;
    }

    setIsFormOpen(false);

    // UN BON PAR ÉLÈVE — jamais un seul reçu au nom du premier.
    //
    // Six passagers saisis d'un coup, c'étaient six séances en base mais un
    // unique ticket « Karim + 5 passager(s) » pour le total : les cinq autres
    // repartaient les mains vides et rien ne se réimprimait à l'unité. Chaque
    // séance créée porte donc son propre bon, à son nom, pour son prix — et la
    // fenêtre laisse imprimer celui qu'on veut, ou tous à la suite.
    const item = selectedItem;
    const registration = selectedStudent ? registrationNumberOf(db, selectedStudent) : undefined;
    setTickets(
      (res.ids ?? []).map((id, i) => {
        const payer = names[i]?.trim() || names[0]?.trim() || "Passager";
        return {
          id,
          title: payer,
          subtitle: `${item.label} · ${formatDateFr(casualDate)} · ${item.timeLabel}`,
          amount: price,
          html: seanceLibreInvoiceHtml(db, {
            payer,
            registrationNumber: registration,
            classLabel: item.classLabel,
            itemLabel: item.label,
            price,
            date: casualDate,
            time: item.timeLabel,
            language,
          }),
        };
      }),
    );

    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer cette séance libre ?")) {
      deleteFrom("independent", id);
      setActiveMenuId(null);
    }
  };

  // ---- Receipt --------------------------------------------------------------

  /** The séance-libre receipt: one small, streamlined ticket, never an A4. */
  const handlePrintReceipt = (data: CasualReceiptData) => {
    printHtmlDocument(
      seanceLibreInvoiceHtml(db, {
        payer: data.personName,
        registrationNumber: data.registrationNumber,
        classLabel: data.classLabel,
        itemLabel: data.itemLabel,
        price: data.price,
        date: data.date,
        time: data.timeLabel,
        language,
      }),
    );
  };

  const reprint = (ind: IndependentSession) => {
    const opt = optionForSession(ind.sessionId);
    handlePrintReceipt({
      personName: ind.studentId ? getStudentName(ind.studentId) : ind.passagerName ?? "-",
      isRegisteredStudent: !!ind.studentId,
      itemLabel: ind.itemLabel,
      teacherName: opt?.teacherName,
      classLabel: opt?.classLabel,
      timeLabel: ind.startTime && ind.endTime ? `${ind.startTime} - ${ind.endTime}` : opt?.timeLabel,
      price: ind.price,
      date: ind.date,
      createdAt: ind.createdAt ?? `${ind.date}T12:00:00.000Z`,
    });
  };

  const createdStamp = (ind: IndependentSession) => {
    const iso = ind.createdAt ?? `${ind.date}T12:00:00.000Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return ind.date;
    return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          emoji="🎓"
          title="Séances Libres"
          subtitle="Enregistrer les séances ponctuelles des élèves inscrits et des passagers"
        />
        {can("create") && (
<Button onClick={openCreate} className="flex items-center gap-2 self-start sm:self-center">
            <Plus className="h-4 w-4" /> Nouvelle Séance Libre
          </Button>
        )}
      </div>

      {/* Séances libres vendues à un GROUPE entier — on saisit le nombre
          d'élèves, jamais leurs noms. */}
      <GroupSeanceSection />

      {/* Filters toolbar */}
      <Card className="border border-line">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Rechercher & Filtrer
            </span>
            <div className="flex items-center gap-2">
              {(listSearch || payerFilter !== "all" || kindFilter !== "all" || fromDate || toDate) && (
                <button onClick={clearListFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                  <X className="h-3 w-3" /> Réinitialiser
                </button>
              )}
              <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "cards" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" /> Cartes
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "table" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <TableIcon className="h-3 w-3" /> Tableau
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Nom de l'élève, passager ou séance..."
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Type de payeur</label>
              <Select value={payerFilter} onChange={(e) => setPayerFilter(e.target.value as typeof payerFilter)} className="w-full">
                <option value="all">Tous</option>
                <option value="student">Élèves inscrits</option>
                <option value="passager">Passagers</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Origine</label>
              <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="w-full">
                <option value="all">Toutes</option>
                <option value="timing">Créneaux séance libre</option>
                <option value="cours">Cours normaux</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Du</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Au</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-[11px]">
            <Badge tone="primary" className="font-bold">{filteredList.length} séance(s)</Badge>
            <Badge tone="success" className="font-bold">{formatDA(totalCollected)} encaissés</Badge>
            <Badge tone="neutral" className="font-bold">
              {filteredList.filter((i) => !i.studentId).length} passager(s)
            </Badge>
          </div>
        </CardBody>
      </Card>

      {filteredList.length === 0 ? (
        <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
          Aucune séance libre ne correspond aux filtres actuels.
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredList.map((ind) => {
            const opt = optionForSession(ind.sessionId);
            return (
              <Card
                key={ind.id}
                className={`relative transition-all duration-300 ${
                  activeMenuId === ind.id
                    ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                    : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
                }`}
              >
                <CardBody className="flex flex-col justify-between min-h-[230px] relative p-5">
                  {/* Actions overlay panel */}
                  {activeMenuId === ind.id && (
                    <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                      <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[10px] text-muted uppercase tracking-wider truncate">
                          Actions: {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName}
                        </span>
                        <button
                          onClick={() => setActiveMenuId(null)}
                          className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 my-2 flex-1 items-center">
                        {can("view") && (
<button
                            onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); setActiveMenuId(null); }}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" /> Détails
                          </button>
                        )}
                        {can("edit") && (
<button
                            onClick={() => openEdit(ind)}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Edit className="h-3.5 w-3.5" /> Modifier
                          </button>
                        )}
                        {can("print") && (
<button
                            onClick={() => { reprint(ind); setActiveMenuId(null); }}
                            className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                          >
                            <Printer className="h-3.5 w-3.5" /> Réimprimer le reçu
                          </button>
                        )}
                      </div>

                      <div className="border-t border-line pt-2">
                        {can("delete") && (
<button
                            onClick={() => handleDelete(ind.id)}
                            className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-success/10 border border-success/20 text-success font-bold text-xs flex items-center justify-center shrink-0">
                          {ind.studentId ? "🎓" : "🚶"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-ink truncate">
                            {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName}
                          </h4>
                          <span className="text-[10px] text-muted block font-mono truncate">
                            {ind.studentId ? "Élève Inscrit" : "Passager Occasionnel"}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveMenuId(activeMenuId === ind.id ? null : ind.id)}
                        className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2 text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">
                            {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                          </span>
                          <span className="font-semibold text-ink block truncate">{ind.itemLabel}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">Tarif Payé</span>
                          <span className="font-bold text-success">{formatDA(ind.price)}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase font-sans">Date séance</span>
                          <strong className="text-ink mt-0.5 font-mono block">{formatDateFr(ind.date)}</strong>
                          {ind.startTime && (
                            <span className="text-[9px] text-muted font-mono">{ind.startTime} - {ind.endTime}</span>
                          )}
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase">Créée le</span>
                          <strong className="text-ink mt-0.5 font-mono block text-[10px]">{createdStamp(ind)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1.5 truncate">
                      <User className="h-3 w-3 shrink-0" />
                      {opt?.teacherName ?? "-"}
                      {opt?.teacherIsPassager && (
                        <Badge tone="warning" className="text-[8px] px-1 py-0">Passager</Badge>
                      )}
                    </span>
                    <Badge tone="success" className="font-mono font-bold text-[10px]">{formatDA(ind.price)}</Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="border border-line rounded-2xl overflow-hidden bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                  <th className="p-3">Élève / Passager</th>
                  <th className="p-3">Séance</th>
                  <th className="p-3">Enseignant</th>
                  <th className="p-3">Date & horaire</th>
                  <th className="p-3">Créée le</th>
                  <th className="p-3 text-right">Tarif</th>
                  <th className="p-3 text-right">Part école</th>
                  <th className="p-3 text-right">Part enseignant</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((ind) => {
                  const opt = optionForSession(ind.sessionId);
                  return (
                    <tr key={ind.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                      <td className="p-3">
                        <span className="font-bold text-ink block">
                          {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName}
                        </span>
                        <Badge tone={ind.studentId ? "primary" : "warning"} className="text-[9px] mt-0.5">
                          {ind.studentId ? "Inscrit" : "Passager"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="text-ink block truncate max-w-[220px]">{ind.itemLabel}</span>
                        <span className="text-[10px] text-muted">
                          {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                        </span>
                      </td>
                      <td className="p-3 text-ink">{opt?.teacherName ?? "-"}</td>
                      <td className="p-3 font-mono text-[10px]">
                        {formatDateFr(ind.date)}
                        {ind.startTime && <span className="block text-muted">{ind.startTime} - {ind.endTime}</span>}
                      </td>
                      <td className="p-3 font-mono text-[10px] text-muted">{createdStamp(ind)}</td>
                      {(() => {
                        const split = independentTotals(ind);
                        return (
                          <>
                            <td className="p-3 text-right font-bold text-success font-mono">
                              {formatDA(split.price)}
                            </td>
                            <td className="p-3 text-right font-mono text-muted">
                              {formatDA(split.school)}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-primary">
                              {formatDA(split.teacher)}
                              <span className="block text-[9px] font-normal text-muted">
                                {ind.teacherPaid ? "réglée" : "à régler"}
                              </span>
                            </td>
                          </>
                        );
                      })()}
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          {can("view") && (
<button
                              onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); }}
                              className="p-1.5 rounded-lg hover:bg-primary-50 text-ink"
                              title="Détails"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {can("print") && (
<button onClick={() => reprint(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-ink" title="Réimprimer">
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {can("edit") && (
<button onClick={() => openEdit(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-primary" title="Modifier">
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {can("delete") && (
<button onClick={() => handleDelete(ind.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger" title="Supprimer">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Créer / modifier une séance libre                                   */}
      {/*                                                                     */}
      {/* Le même geste qu'à la feuille de présence, en plus large : on        */}
      {/* cherche l'emploi du temps, on dit QUI est venu — un élève inscrit,   */}
      {/* ou un ou plusieurs passagers dont le nom est facultatif — puis on    */}
      {/* tape le prix total et la part de l'école. Le reste va à             */}
      {/* l'enseignant, et s'affiche pendant la saisie.                       */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={selectedCasual ? "Modifier la séance libre" : "Enregistrer une séance libre"}
        wide
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ---- QUI est venu ---- */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                Élève inscrit (facultatif) — nom, n° d&apos;inscription ou n° de carte
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    if (selectedStudent) setSelectedStudent(null);
                  }}
                  placeholder="Nom, n° d'inscription (00001), téléphone ou carte RFID…"
                  className="pl-9"
                />
              </div>
              <p className="text-[10px] text-muted mt-1 leading-relaxed">
                Laissez ce champ <strong>vide</strong> pour une séance de{" "}
                <strong>passagers</strong> : vous les saisirez juste en dessous, autant qu&apos;il
                en est venu, et leurs noms restent facultatifs.
              </p>
            </div>

            {studentSearchQuery.trim() !== "" && !selectedStudent && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted font-bold block uppercase font-sans">
                  Résultats ({matchedStudents.length}) :
                </span>
                <div className="border border-line rounded-xl max-h-44 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {matchedStudents.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setSelectedStudent(st);
                        setStudentSearchQuery(`${st.firstName} ${st.lastName}`);
                      }}
                      className="w-full text-start p-2.5 rounded-xl text-xs flex justify-between items-center transition-all hover:bg-primary-50 text-ink border border-transparent"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold block truncate">
                          {st.firstName} {st.lastName}
                        </span>
                        <span className="text-[9px] text-muted block mt-0.5 font-mono">
                          N° {registrationNumberOf(db, st)} · 📞 {st.phone || "—"}
                        </span>
                      </div>
                    </button>
                  ))}
                  {matchedStudents.length === 0 && (
                    <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-line">
                      Aucun élève inscrit sous ce nom — la séance sera enregistrée pour le passager{" "}
                      <strong>&laquo;&nbsp;{studentSearchQuery}&nbsp;&raquo;</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedStudent && (
              <div className="bg-primary-50/50 border border-line rounded-xl p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] text-muted block uppercase font-bold">
                      Élève sélectionné
                    </span>
                    <strong className="text-ink block mt-0.5">
                      {selectedStudent.firstName} {selectedStudent.lastName}
                    </strong>
                    <span className="text-muted">
                      N° {registrationNumberOf(db, selectedStudent)} — une séance libre se règle en
                      espèces et ne touche <strong className="text-ink">aucun</strong> de ses
                      soldes.
                      {selectedStudent.isFree && " (élève gratuit)"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(null);
                      setStudentSearchQuery("");
                    }}
                    className="shrink-0 rounded-lg border border-line p-1 text-muted hover:bg-danger/10 hover:text-danger"
                    title="Revenir à une séance de passagers"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ---- LES PASSAGERS : autant qu'il en est venu, noms facultatifs */}
            {!selectedStudent && !selectedCasual && (
              <div className="space-y-2 rounded-xl border border-line bg-canvas/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    👥 Élèves de passage ({passagerNames.length})
                  </span>
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
                    <button
                      type="button"
                      onClick={() => setPassagerCount(passagerNames.length - 1)}
                      disabled={passagerNames.length <= 1}
                      className="h-6 w-6 rounded text-muted hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="min-w-[42px] text-center font-mono text-xs font-bold text-ink">
                      {passagerNames.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPassagerCount(passagerNames.length + 1)}
                      className="h-6 w-6 rounded text-muted hover:bg-primary-50 hover:text-ink"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed text-muted">
                  Un nom par ligne, <strong className="text-ink">vide est permis</strong> : la ligne
                  s&apos;enregistre alors sous « Passager ». Réglez d&apos;abord le nombre, puis
                  nommez ceux que vous connaissez.
                </p>
                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto">
                  {passagerNames.map((n, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center font-mono text-[10px] text-muted">
                        {i + 1}
                      </span>
                      <Input
                        value={n}
                        onChange={(e) =>
                          setPassagerNames((prev) =>
                            prev.map((v, j) => (j === i ? e.target.value : v)),
                          )
                        }
                        placeholder={`Passager ${i + 1} — nom facultatif`}
                      />
                      {passagerNames.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPassagerNames((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line text-danger hover:bg-danger/10"
                          title="Retirer cette ligne"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                Date de la séance
              </label>
              <Input
                type="date"
                value={casualDate}
                onChange={(e) => setCasualDate(e.target.value)}
              />
            </div>
          </div>

          {/* ---- QUEL emploi du temps, et POUR COMBIEN ---- */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                Rechercher l&apos;emploi du temps suivi (par nom) *
              </label>
              <div className="flex gap-1.5 mb-2">
                {([
                  { key: "all", label: "Tout" },
                  { key: "timing", label: "Créneaux séance libre" },
                  { key: "cours", label: "Cours normaux" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setItemKindTab(tab.key)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      itemKindTab === tab.key ? "bg-primary text-white" : "bg-canvas text-muted hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="Nom de l'emploi du temps, classe, groupe, salle ou enseignant…"
                  className="pl-9"
                />
              </div>
              <div className="border border-line rounded-xl max-h-56 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                {filteredOptions.length === 0 ? (
                  <p className="text-[10px] text-muted italic p-3 text-center">Aucun résultat.</p>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSel = selectedItem?.key === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => {
                          setSelectedItem(opt);
                          setCustomPrice(opt.price);
                          // Par défaut, l'école garde tout : c'est le
                          // comportement d'avant le partage, et il se corrige
                          // d'un chiffre juste en dessous.
                          setSchoolShare(opt.price);
                        }}
                        className={`w-full text-start p-2.5 rounded-lg text-xs transition-colors border ${
                          isSel
                            ? "bg-primary/10 border-primary/40 text-ink"
                            : "hover:bg-primary-50 text-ink border-transparent"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <strong className="font-bold block min-w-0 truncate">
                            {opt.kind === "timing" && <span className="mr-1">🎯</span>}
                            {opt.label}
                          </strong>
                          <strong className="text-primary shrink-0">{formatDA(opt.price)}</strong>
                        </div>
                        {/* Full context so two identical module names stay distinguishable */}
                        <div className="mt-1 space-y-0.5 text-[10px] text-muted">
                          <div className="flex items-center gap-1"><User className="h-3 w-3 shrink-0" /> {opt.teacherName}{opt.teacherIsPassager ? " (passager)" : ""}</div>
                          <div className="flex items-center gap-1"><Users className="h-3 w-3 shrink-0" /> {opt.classLabel} · Gr: {opt.groupLabel}</div>
                          <div className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /> {opt.salleLabel}</div>
                          <div className="flex items-center gap-1 font-mono"><Clock className="h-3 w-3 shrink-0" /> {opt.daysLabel} · {opt.timeLabel}</div>
                          {opt.periodLabel && (
                            <div className="flex items-center gap-1 font-mono"><Calendar className="h-3 w-3 shrink-0" /> {opt.periodLabel}</div>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedItem && (
              <div className="space-y-3 rounded-xl border border-primary/25 bg-primary-50/40 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  💰 Le prix de la séance
                </span>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Prix total / élève *
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={effectivePrice || ""}
                      onChange={(e) => setCustomPrice(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Part de l&apos;école / élève *
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={effectiveSchoolShare || ""}
                      onChange={(e) => setSchoolShare(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">
                      Part de l&apos;enseignant / élève
                    </label>
                    <div className="flex h-9 items-center rounded-xl border border-primary/40 bg-surface px-3 font-mono text-sm font-black text-primary">
                      {formatDA(unitTeacherShare)}
                    </div>
                    <span className="mt-0.5 block text-[9px] text-muted">
                      calculée : prix − part école
                    </span>
                  </div>
                </div>

                <p className="text-[10px] leading-relaxed text-muted">
                  Tarif chargé depuis{" "}
                  {selectedItem.kind === "timing" ? "le créneau" : "l'abonnement"} :{" "}
                  <strong>{formatDA(selectedItem.price)}</strong>. Modifiable pour cette séance
                  uniquement. La part de l&apos;enseignant se réglera avec le{" "}
                  <strong>mois de cet emploi du temps</strong> où la date tombe, dans sa table
                  « Retards de paiement &amp; séances libres ».
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <FormTotal label="Total encaissé" value={formatDA(seanceTotals.total)} tone="text-success" />
                  <FormTotal label="Total école" value={formatDA(seanceTotals.school)} tone="text-ink" />
                  <FormTotal label="Total enseignant" value={formatDA(seanceTotals.teacher)} tone="text-primary" />
                </div>

                <div className="rounded-xl border border-success/25 bg-success/10 p-3 text-xs">
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted">Qui paie</span>
                    <strong className="text-ink text-right">
                      {selectedStudent
                        ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
                        : selectedCasual
                          ? studentSearchQuery.trim() || "Passager"
                          : `${attendeeCount} élève(s) de passage`}
                    </strong>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-success/25 pt-2">
                    <span className="font-semibold text-success">Total à encaisser</span>
                    <strong className="text-sm font-extrabold text-success">
                      {formatDA(seanceTotals.total)}
                    </strong>
                  </div>
                </div>

                {effectivePrice > 0 && unitTeacherShare === 0 && (
                  <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                    L&apos;école garde tout : cette séance ne rapportera rien à l&apos;enseignant.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-6 border-t border-line">
          <Button variant="outline" onClick={() => setIsFormOpen(false)}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!selectedItem}>
            {selectedCasual
              ? "Enregistrer les modifications"
              : `Valider le paiement — ${formatDA(seanceTotals.total)}`}
          </Button>
        </div>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Details                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la séance libre" wide>
        {selectedCasual && (() => {
          const opt = optionForSession(selectedCasual.sessionId);
          const student = selectedCasual.studentId
            ? students.find((s) => s.id === selectedCasual.studentId)
            : undefined;
          return (
            <div className="space-y-5 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
                <div>
                  <span className="text-[10px] text-muted block uppercase">Élève / Passager</span>
                  <strong className="text-ink block">
                    {student ? `${student.firstName} ${student.lastName}` : selectedCasual.passagerName}
                  </strong>
                  <Badge tone={student ? "primary" : "warning"} className="text-[9px] mt-1">
                    {student ? "Élève inscrit" : "Passager"}
                  </Badge>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Séance</span>
                  <strong className="text-ink block break-words">{selectedCasual.itemLabel}</strong>
                  <span className="text-[10px] text-muted">
                    {opt?.kind === "timing" ? "Créneau séance libre" : "Cours normal"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Date & horaire</span>
                  <strong className="text-ink block font-mono">{formatDateFr(selectedCasual.date)}</strong>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedCasual.startTime ? `${selectedCasual.startTime} - ${selectedCasual.endTime}` : opt?.timeLabel ?? "-"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Montant encaissé</span>
                  <strong className="text-success block text-base">{formatDA(selectedCasual.price)}</strong>
                  <span className="text-[10px] text-muted">Créée le {createdStamp(selectedCasual)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    📚 Contexte de la séance
                  </h4>
                  {[
                    ["Module", opt?.moduleName],
                    ["Classe / Niveau", opt?.classLabel],
                    ["Groupe(s)", opt?.groupLabel],
                    ["Salle(s)", opt?.salleLabel],
                    ["Enseignant", opt ? `${opt.teacherName}${opt.teacherIsPassager ? " (passager)" : ""}` : undefined],
                    ["Jours", opt?.daysLabel],
                    ["Période", opt?.periodLabel],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label} className="flex justify-between border-b border-line/50 pb-1.5 last:border-0">
                        <span className="text-muted">{label} :</span>
                        <strong className="text-ink text-right">{value}</strong>
                      </div>
                    ) : null,
                  )}
                </div>

                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    💰 Règlement
                  </h4>
                  {(() => {
                    // Le partage tel qu'il a été saisi : ce que l'école garde,
                    // et ce qui reste dû à l'enseignant sur cette séance-là.
                    const split = independentTotals(selectedCasual);
                    return (
                      <>
                        <div className="flex justify-between border-b border-line/50 pb-1.5">
                          <span className="text-muted">Montant encaissé :</span>
                          <strong className="text-success">{formatDA(split.price)}</strong>
                        </div>
                        <div className="flex justify-between border-b border-line/50 pb-1.5">
                          <span className="text-muted">Part de l&apos;école :</span>
                          <strong className="text-ink">{formatDA(split.school)}</strong>
                        </div>
                        <div className="flex justify-between border-b border-line/50 pb-1.5">
                          <span className="text-muted">Part de l&apos;enseignant :</span>
                          <strong className="text-primary">
                            {formatDA(split.teacher)}
                            {split.unsplit && (
                              <span className="ms-1 text-[9px] font-normal text-warning">
                                (part non répartie)
                              </span>
                            )}
                          </strong>
                        </div>
                        <div className="flex justify-between border-b border-line/50 pb-1.5">
                          <span className="text-muted">Statut de cette part :</span>
                          <Badge tone={selectedCasual.teacherPaid ? "success" : "warning"} className="text-[9px]">
                            {selectedCasual.teacherPaid
                              ? "déjà réglée"
                              : "à régler avec le mois de cet emploi"}
                          </Badge>
                        </div>
                      </>
                    );
                  })()}
                  <div className="flex justify-between border-b border-line/50 pb-1.5">
                    <span className="text-muted">Mode :</span>
                    <strong className="text-ink">Espèces (encaissé)</strong>
                  </div>
                  {student && (
                    <div className="flex justify-between border-b border-line/50 pb-1.5">
                      <span className="text-muted">Soldes d&apos;abonnement :</span>
                      <strong className="text-ink">Aucun débité</strong>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Enregistrée le :</span>
                    <strong className="text-ink font-mono">{createdStamp(selectedCasual)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-line">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => reprint(selectedCasual)}>
                    <Printer className="h-4 w-4" /> Imprimer le reçu
                  </Button>
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => { setIsDetailsOpen(false); openEdit(selectedCasual); }}>
                    <Edit className="h-4 w-4" /> Modifier
                  </Button>
                </div>
                <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Séance libre created -> propose the receipt right away */}
      {tickets.length > 0 && <TicketsAsk tickets={tickets} onClose={() => setTickets([])} />}

      <Modal open={receiptData !== null} onClose={() => setReceiptData(null)} title="Reçu de la Séance Libre">
        {receiptData && (
          <div className="space-y-6 text-center py-4">
            <div className="mx-auto w-12 h-12 bg-success/10 rounded-full flex items-center justify-center text-success text-xl">
              ✔
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-ink">Séance libre enregistrée avec succès !</h3>
              <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
                <strong>{receiptData.itemLabel}</strong> pour <strong>{receiptData.personName}</strong> —{" "}
                <strong>{formatDA(receiptData.price)}</strong> encaissés.
                <br />
                Souhaitez-vous imprimer le reçu ?
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-4 border-t border-line">
              <Button variant="outline" onClick={() => setReceiptData(null)} className="px-5 py-2 rounded-xl text-xs font-bold">
                Ignorer
              </Button>
              <Button
                onClick={() => { handlePrintReceipt(receiptData); setReceiptData(null); }}
                className="px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <Printer className="h-4 w-4" /> Imprimer le Reçu
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Un total du formulaire — trois nombres qu'on lit d'un coup d'œil. */
function FormTotal({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2 text-center">
      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <strong className={`block font-mono text-sm ${tone}`}>{value}</strong>
    </div>
  );
}
