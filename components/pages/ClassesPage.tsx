"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Edit, Eye, Plus, MoreVertical } from "lucide-react";
import type { SchoolClass, CoursLevel, FormationLevel } from "@/lib/types";
import {
  COURS_LEVELS,
  coursLevelLabel,
  studentFullyFree,
  totalRemainingSeances,
} from "@/lib/helpers";

/** Year options per school level. Kindergarten uses sections, the others the
 *  Algerian AP/AM/AS scale. */
function yearOptionsFor(level: CoursLevel): string[] {
  switch (level) {
    case "maternelle":
      return ["Petite section", "Moyenne section", "Grande section"];
    case "primaire":
      return ["1AP", "2AP", "3AP", "4AP", "5AP"];
    case "moyen":
      return ["1AM", "2AM", "3AM", "4AM"];
    case "lycee":
      return ["1AS", "2AS", "3AS"];
    default:
      return [];
  }
}

type LevelFilter = "all" | CoursLevel | "formation";

export function ClassesPage() {
  const db = useData();
  const { classes, classCategories, students, subscriptions, sessions, push, deleteFrom, updateItem } = db;

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<SchoolClass | null>(null);

  // Form states
  const [type, setType] = useState<"cours" | "formation">("cours");
  const [coursLevel, setCoursLevel] = useState<CoursLevel>("primaire");
  const [year, setYear] = useState("1AP");
  const [categoryId, setCategoryId] = useState("");
  const [formationLevel, setFormationLevel] = useState<FormationLevel>("A1");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Inline creations
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [formationLevelsList, setFormationLevelsList] = useState<string[]>(["A1", "A2", "B1", "B2", "C1", "C2"]);
  const [newLevelName, setNewLevelName] = useState("");
  const [showAddLevel, setShowAddLevel] = useState(false);

  // Active menu dropdown index
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // List filter by level
  const [filterLevel, setFilterLevel] = useState<LevelFilter>("all");

  // Helpers
  const getCategoryName = (cid?: string) => classCategories.find((c) => c.id === cid)?.name ?? "-";

  const derivedName = (): string => {
    if (type === "formation") return name;
    return [coursLevelLabel(coursLevel), year, coursLevel === "maternelle" ? getCategoryName(categoryId) : ""]
      .filter((p) => p && p !== "-")
      .join(" · ");
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    const newId = uid("cat");
    push("classCategories", { id: newId, name: newCategoryName.trim() });
    setCategoryId(newId);
    setNewCategoryName("");
    setShowAddCategory(false);
  };

  const handleCreateLevel = () => {
    if (!newLevelName.trim()) return;
    if (!formationLevelsList.includes(newLevelName)) {
      setFormationLevelsList([...formationLevelsList, newLevelName]);
    }
    setFormationLevel(newLevelName as FormationLevel);
    setNewLevelName("");
    setShowAddLevel(false);
  };

  const handleCreateClass = () => {
    const classId = uid("cls");
    const newClass: SchoolClass = {
      id: classId,
      type,
      name: derivedName() || (type === "cours" ? "Classe" : name),
      description,
      ...(type === "cours"
        ? { coursLevel, year, categoryId: coursLevel === "maternelle" ? categoryId || undefined : undefined }
        : { formationLevel }),
    };

    push("classes", newClass);
    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditClass = () => {
    if (!selectedClass) return;
    const updated: Partial<SchoolClass> = {
      type,
      name: derivedName() || selectedClass.name,
      description,
      coursLevel: type === "cours" ? coursLevel : undefined,
      year: type === "cours" ? year : undefined,
      categoryId: type === "cours" && coursLevel === "maternelle" ? categoryId || undefined : undefined,
      formationLevel: type === "formation" ? formationLevel : undefined,
    };
    updateItem("classes", selectedClass.id, updated);
    setIsEditOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setType("cours");
    setCoursLevel("primaire");
    setYear("1AP");
    setCategoryId("");
    setFormationLevel("A1");
    setName("");
    setDescription("");
    setSelectedClass(null);
    setShowAddCategory(false);
    setNewCategoryName("");
  };

  const openEdit = (cls: SchoolClass) => {
    setSelectedClass(cls);
    setShowAddCategory(false);
    setNewCategoryName("");
    setType(cls.type);
    setDescription(cls.description);
    if (cls.type === "cours") {
      setCoursLevel(cls.coursLevel || "primaire");
      setYear(cls.year || yearOptionsFor(cls.coursLevel || "primaire")[0]);
      setCategoryId(cls.categoryId || "");
    } else {
      setName(cls.name);
      setFormationLevel(cls.formationLevel || "A1");
    }
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (cls: SchoolClass) => {
    setSelectedClass(cls);
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cette classe ?")) {
      deleteFrom("classes", id);
      setActiveMenuId(null);
    }
  };

  // Filter students enrolled in selected class
  const getClassStudents = (classId: string) => {
    return students.filter((student) =>
      student.subscriptionIds.some((subId) => {
        const sub = subscriptions.find((s) => s.id === subId);
        if (!sub) return false;
        const session = sessions.find((s) => s.id === sub.sessionId);
        return session?.classId === classId;
      })
    );
  };

  const getStudentCount = (classId: string) => getClassStudents(classId).length;

  // Filter sessions (emploi) associated with class
  const getClassSessions = (classId: string) => sessions.filter((s) => s.classId === classId);

  // Classes shown in the grid, filtered by the selected level
  const visibleClasses = classes.filter((c) => {
    if (filterLevel === "all") return true;
    if (filterLevel === "formation") return c.type === "formation";
    return c.type === "cours" && c.coursLevel === filterLevel;
  });

  // The category / level block reused by the create and edit modals.
  const CoursFields = (
    <>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1 font-sans">Niveau scolaire</label>
        <Select
          value={coursLevel}
          onChange={(e) => {
            const lvl = e.target.value as CoursLevel;
            setCoursLevel(lvl);
            setYear(yearOptionsFor(lvl)[0] ?? "");
            if (lvl !== "maternelle") setCategoryId("");
          }}
          className="w-full"
        >
          {COURS_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted mb-1">
          {coursLevel === "maternelle" ? "Section / Année" : "Année"}
        </label>
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-full">
          {yearOptionsFor(coursLevel).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      </div>

      {/* Kindergarten only: an optional category, created inline. */}
      {coursLevel === "maternelle" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-muted">Catégorie (optionnel)</label>
            <button
              onClick={() => setShowAddCategory(!showAddCategory)}
              className="text-xs text-primary hover:underline"
            >
              {showAddCategory ? "Choisir existante" : "+ Nouvelle catégorie"}
            </button>
          </div>
          {showAddCategory ? (
            <div className="flex gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
                placeholder="Nom de la catégorie (ex: Groupe Matin)"
                className="flex-1"
              />
              <Button size="sm" onClick={handleCreateCategory}>
                Créer
              </Button>
            </div>
          ) : (
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
              <option value="">Aucune catégorie</option>
              {classCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </>
  );

  const FormationFields = (
    <>
      <div>
        <label className="block text-xs font-semibold text-muted mb-1">Nom de la classe</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Anglais débutants A1" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-semibold text-muted">Niveau de formation</label>
          <button onClick={() => setShowAddLevel(!showAddLevel)} className="text-xs text-primary hover:underline">
            {showAddLevel ? "Choisir existant" : "+ Nouveau niveau"}
          </button>
        </div>
        {showAddLevel ? (
          <div className="flex gap-2">
            <Input
              value={newLevelName}
              onChange={(e) => setNewLevelName(e.target.value)}
              placeholder="Nom du niveau (ex: C2)"
              className="flex-1"
            />
            <Button size="sm" onClick={handleCreateLevel}>
              Créer
            </Button>
          </div>
        ) : (
          <Select
            value={formationLevel}
            onChange={(e) => setFormationLevel(e.target.value as FormationLevel)}
            className="w-full"
          >
            {formationLevelsList.map((lvl) => (
              <option key={lvl} value={lvl}>
                Niveau {lvl}
              </option>
            ))}
          </Select>
        )}
      </div>
    </>
  );

  const TypePicker = (
    <div>
      <label className="block text-xs font-semibold text-muted mb-1">Type de classe</label>
      <div className="grid grid-cols-2 gap-2">
        <Button variant={type === "cours" ? "primary" : "outline"} onClick={() => setType("cours")} className="w-full text-center">
          Cours (Soutien scolaire)
        </Button>
        <Button variant={type === "formation" ? "primary" : "outline"} onClick={() => setType("formation")} className="w-full text-center">
          Formation (Langues, Pro)
        </Button>
      </div>
    </div>
  );

  const DescriptionField = (
    <div>
      <label className="block text-xs font-semibold text-muted mb-1">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description ou détails additionnels..."
        rows={3}
        className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none transition-colors focus:border-primary"
      />
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="🏫" title="Classes" subtitle="Gérer les classes et formations" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle Classe
        </Button>
      </div>

      {/* Filter by level */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">Filtrer par niveau :</span>
        <Select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value as LevelFilter)} className="min-w-[200px]">
          <option value="all">Tous les niveaux</option>
          {COURS_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
          <option value="formation">Formations</option>
        </Select>
        {filterLevel !== "all" && (
          <button onClick={() => setFilterLevel("all")} className="text-xs text-primary hover:underline">
            Réinitialiser
          </button>
        )}
        <span className="ms-auto text-xs text-muted">
          {visibleClasses.length} classe{visibleClasses.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid of classes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleClasses.map((cls) => {
          const studentCount = getStudentCount(cls.id);
          const levelText = cls.type === "cours" ? coursLevelLabel(cls.coursLevel) : cls.formationLevel;
          return (
            <Card key={cls.id} className="relative overflow-visible">
              <CardBody className="flex flex-col justify-between h-48">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge tone={cls.type === "cours" ? "primary" : "success"}>
                        {cls.type === "cours" ? "Cours" : "Formation"}
                      </Badge>
                      <h3 className="text-xl font-bold mt-2 text-ink truncate max-w-[200px]">{cls.name}</h3>
                    </div>
                    {/* Action Menu (Three dots) */}
                    <div className="relative">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === cls.id ? null : cls.id)}
                        className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      {activeMenuId === cls.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                          <div className="absolute right-0 mt-1 w-36 bg-surface border border-line rounded-xl shadow-lg z-20 overflow-hidden">
                            <button onClick={() => openDetails(cls)} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left">
                              <Eye className="h-4 w-4" /> Détails
                            </button>
                            <button onClick={() => openEdit(cls)} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left">
                              <Edit className="h-4 w-4" /> Modifier
                            </button>
                            <button onClick={() => handleDelete(cls.id)} className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left">
                              <Trash2 className="h-4 w-4" /> Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted mt-2 line-clamp-2">{cls.description || "Aucune description"}</p>
                </div>
                <div className="border-t border-line pt-3 mt-3 flex items-center justify-between text-xs text-muted">
                  <span>
                    Niveau: <strong className="text-ink font-semibold">{levelText}</strong>
                  </span>
                  <span className="text-primary font-bold text-sm bg-primary-50 px-2 py-1 rounded-lg">
                    {studentCount} {studentCount > 1 ? "Étudiants" : "Étudiant"}
                  </span>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {visibleClasses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line py-14 text-center">
          <p className="text-sm text-muted">Aucune classe pour ce niveau.</p>
        </div>
      )}

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer une nouvelle classe">
        <div className="space-y-4">
          {TypePicker}
          {type === "cours" ? CoursFields : FormationFields}
          {DescriptionField}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateClass}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier la classe">
        <div className="space-y-4">
          {TypePicker}
          {type === "cours" ? CoursFields : FormationFields}
          {DescriptionField}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditClass}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la classe" wide>
        {selectedClass && (
          <div className="space-y-6">
            {/* Header info */}
            <div className="bg-primary-50/50 rounded-xl p-4 border border-line grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span className="text-xs text-muted block">Nom / Année</span>
                <span className="font-bold text-ink">{selectedClass.name}</span>
              </div>
              <div>
                <span className="text-xs text-muted block">Type</span>
                <Badge tone={selectedClass.type === "cours" ? "primary" : "success"}>
                  {selectedClass.type === "cours" ? "Cours" : "Formation"}
                </Badge>
              </div>
              <div>
                <span className="text-xs text-muted block">Niveau</span>
                <span className="font-semibold text-ink">
                  {selectedClass.type === "cours" ? coursLevelLabel(selectedClass.coursLevel) : selectedClass.formationLevel}
                </span>
              </div>
              {selectedClass.type === "cours" && selectedClass.coursLevel === "maternelle" && selectedClass.categoryId && (
                <div>
                  <span className="text-xs text-muted block">Catégorie</span>
                  <span className="font-semibold text-ink">{getCategoryName(selectedClass.categoryId)}</span>
                </div>
              )}
            </div>

            <div>
              <span className="text-xs text-muted block font-semibold mb-1">Description</span>
              <p className="text-sm text-ink bg-surface border border-line rounded-xl p-3">
                {selectedClass.description || "Aucune description fournie."}
              </p>
            </div>

            {/* Grid of Sessions & Students tabs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sessions List */}
              <div className="border border-line rounded-xl p-4 bg-surface/50">
                <h4 className="font-bold text-ink mb-3 flex items-center gap-2">
                  📅 Emploi du temps ({getClassSessions(selectedClass.id).length})
                </h4>
                {getClassSessions(selectedClass.id).length === 0 ? (
                  <p className="text-xs text-muted italic">Aucun emploi du temps affecté à cette classe.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {getClassSessions(selectedClass.id).map((s) => {
                      const modName = db.modules.find((m) => m.id === s.moduleId)?.name ?? "Module";
                      const tName = db.teachers.find((t) => t.id === s.teacherId);
                      return (
                        <div key={s.id} className="text-xs bg-surface border border-line p-2.5 rounded-lg space-y-1">
                          <div className="flex justify-between font-bold text-ink">
                            <span>{s.title || modName}</span>
                            <span>{s.startTime} - {s.endTime}</span>
                          </div>
                          <div className="text-muted flex justify-between">
                            <span>Ens: {tName ? `${tName.firstName} ${tName.lastName}` : "-"}</span>
                            <span>Salle: {db.salles.find((sl) => sl.id === s.salleId)?.name ?? "-"}</span>
                          </div>
                          <div className="text-[10px] text-primary font-semibold">
                            {s.days.map((d) => d.substring(0, 3).toUpperCase()).join(", ")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Students List */}
              <div className="border border-line rounded-xl p-4 bg-surface/50">
                <h4 className="font-bold text-ink mb-3 flex items-center gap-2">
                  🎓 Étudiants Inscrits ({getClassStudents(selectedClass.id).length})
                </h4>
                {getClassStudents(selectedClass.id).length === 0 ? (
                  <p className="text-xs text-muted italic">Aucun étudiant inscrit dans cette classe.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {getClassStudents(selectedClass.id).map((stu) => (
                      <div key={stu.id} className="flex justify-between items-center text-xs bg-surface border border-line p-2.5 rounded-lg">
                        <div>
                          <strong className="text-ink block">{stu.firstName} {stu.lastName}</strong>
                          <span className="text-[10px] text-muted">{stu.phone}</span>
                        </div>
                        <Badge tone={studentFullyFree(stu) ? "success" : totalRemainingSeances(db, stu.id) === 0 ? "danger" : "primary"}>
                          {studentFullyFree(stu)
                            ? "Gratuit"
                            : `${totalRemainingSeances(db, stu.id)} séance(s)`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
