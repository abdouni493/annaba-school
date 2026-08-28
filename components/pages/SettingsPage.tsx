"use client";

import { useEffect, useRef, useState } from "react";
import { useData, type Database as DataDatabase } from "@/lib/store/data";
import {
  countRows,
  isRestorableDump,
  restoreBackup,
  type RestoreProgress,
  type RestoreReport,
} from "@/lib/supabase/restore";
import { useSession } from "@/lib/store/session";
import { uploadImage } from "@/lib/accounts/uploadImage";
import { changeOwnPassword } from "@/lib/accounts/users";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Settings,
  Shield,
  Download,
  Upload,
  AlertTriangle,
  School as SchoolIcon,
  Phone,
  Mail,
  MapPin,
  FileText,
  Lock,
  User,
  DollarSign,
  Save,
  Globe,
  Image,
  Coins,
  MessageCircle,
  CheckCircle2,
  FileJson,
  Loader2,
  X,
} from "lucide-react";
import { WhatsAppSettingsPanel } from "@/components/whatsapp/WhatsAppSettingsPanel";

import { useCan } from "@/lib/usePermissions";
export function SettingsPage() {
  const can = useCan("settings");
  const dataStore = useData();
  const { school, modules, moduleAbsenceRules, setModuleAbsenceRule, updateSchool } = dataStore;
  const sessionUser = useSession((s) => s.user);
  const updateUser = useSession((s) => s.updateUser);
  const [logoUploading, setLogoUploading] = useState(false);

  // Tabs navigation state
  /**
   * L'écran s'ouvre sur le PREMIER onglet auquel ce compte a droit. Il n'a pas
   * à tomber sur « Établissement » pour découvrir qu'il ne peut pas l'ouvrir.
   */
  const [activeTab, setActiveTab] = useState<"school" | "security" | "whatsapp" | "backup">(
    () =>
      (["school", "security", "whatsapp", "backup"] as const).find((t) => can(t)) ?? "school",
  );

  // School Form State
  const [schoolName, setSchoolName] = useState(school?.name || "");
  const [schoolDesc, setSchoolDesc] = useState(school?.description || "");
  const [schoolLogo, setSchoolLogo] = useState(school?.logo || "");
  const [schoolPhone, setSchoolPhone] = useState(school?.phone || "");
  const [schoolEmail, setSchoolEmail] = useState(school?.email || "");
  const [schoolAddress, setSchoolAddress] = useState(school?.address || "");
  const [articleFiscal, setArticleFiscal] = useState(school?.articleFiscal || "");
  const [registreCommerce, setRegistreCommerce] = useState(school?.registreCommerce || "");
  const [nif, setNif] = useState(school?.nif || "");
  const [nis, setNis] = useState(school?.nis || "");
  const [registrationFee, setRegistrationFee] = useState<number>(school?.registrationFee || 0);
  const [absencePenaltyEnabled, setAbsencePenaltyEnabled] = useState<boolean>(school?.absencePenaltyEnabled ?? true);
  const [absencePenaltySince, setAbsencePenaltySince] = useState<string>(school?.absencePenaltySince || "");
  const [absenceWeekStartDay, setAbsenceWeekStartDay] = useState<number>(school?.absenceWeekStartDay ?? 5);

  // `school` loads asynchronously (fetched from Supabase after mount), so
  // the useState initializers above only capture whatever was there at the
  // first render — usually still empty. Re-sync once the real row arrives.
  useEffect(() => {
    if (!school?.id) return;
    setSchoolName(school.name || "");
    setSchoolDesc(school.description || "");
    setSchoolLogo(school.logo || "");
    setSchoolPhone(school.phone || "");
    setSchoolEmail(school.email || "");
    setSchoolAddress(school.address || "");
    setArticleFiscal(school.articleFiscal || "");
    setRegistreCommerce(school.registreCommerce || "");
    setNif(school.nif || "");
    setNis(school.nis || "");
    setRegistrationFee(school.registrationFee || 0);
    setAbsencePenaltyEnabled(school.absencePenaltyEnabled ?? true);
    setAbsencePenaltySince(school.absencePenaltySince || "");
    setAbsenceWeekStartDay(school.absenceWeekStartDay ?? 5);
  }, [school?.id]);

  // Saved on its own (not folded into handleSaveSchool) so that, on a project
  // where the weekly-absence migration hasn't been applied yet, an unknown
  // column error here can't block the rest of the school form from saving.
  const handleSaveAbsenceBilling = () => {
    updateSchool({
      absencePenaltyEnabled,
      absencePenaltySince: absencePenaltySince || undefined,
      absenceWeekStartDay,
    });
  };

  // Admin Account Form State (name + password; email change requires
  // re-confirmation via Supabase Auth so it's shown read-only here)
  const [adminName, setAdminName] = useState(sessionUser?.name || "");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingAdmin, setSavingAdmin] = useState(false);

  useEffect(() => {
    if (sessionUser?.name) setAdminName(sessionUser.name);
  }, [sessionUser?.name]);

  // ---- Sauvegarde & restauration ------------------------------------------
  /**
   * LE FICHIER, PUIS SEULEMENT LE FICHIER.
   *
   * La restauration se faisait en collant le JSON dans une zone de texte : une
   * sauvegarde d'école pèse plusieurs mégaoctets, et aucun navigateur ne colle
   * ça sans se figer. On dépose donc le fichier — glissé ou choisi — il est lu,
   * compté, et ce qu'il contient s'affiche AVANT qu'une seule ligne parte.
   */
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreDump, setRestoreDump] = useState<Partial<DataDatabase> | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [restoreReading, setRestoreReading] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);
  const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
  const [dragging, setDragging] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const handleSaveSchool = () => {
    if (!schoolName.trim()) {
      alert("Le nom de l'établissement est requis.");
      return;
    }
    updateSchool({
      name: schoolName,
      description: schoolDesc,
      logo: schoolLogo,
      phone: schoolPhone,
      email: schoolEmail,
      address: schoolAddress,
      articleFiscal,
      registreCommerce,
      nif,
      nis,
      registrationFee: Number(registrationFee) || 0,
    });
  };

  const handleSaveAdmin = async () => {
    if (!sessionUser) return;
    if (!adminName.trim()) {
      alert("Le nom est requis.");
      return;
    }
    if (adminPassword && adminPassword.length < 6) {
      alert("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }

    setSavingAdmin(true);
    try {
      if (adminName.trim() !== sessionUser.name) {
        updateUser({ name: adminName.trim() });
      }
      if (adminPassword) {
        await changeOwnPassword(adminPassword);
        setAdminPassword("");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de la mise à jour.");
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleDownloadBackup = () => {
    const backupData: Record<string, any> = {};
    Object.keys(dataStore).forEach((key) => {
      const val = (dataStore as any)[key];
      if (typeof val !== "function") {
        backupData[key] = val;
      }
    });

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `backup-elilm-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /**
   * LIRE LE FICHIER DÉPOSÉ — et ne rien écrire encore.
   *
   * Tant que le contenu n'est pas lu et reconnu, le bouton de restauration
   * reste fermé : on ne lance pas un écrasement de base sur un fichier qu'on
   * n'a pas ouvert.
   */
  const readRestoreFile = async (file: File) => {
    setRestoreError("");
    setRestoreReport(null);
    setRestoreDump(null);
    setRestoreFile(file);
    setRestoreReading(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isRestorableDump(parsed)) {
        setRestoreError(
          "Ce fichier n'est pas une sauvegarde de l'application : il ne contient ni l'établissement ni la liste des élèves.",
        );
        return;
      }
      setRestoreDump(parsed);
    } catch (e) {
      setRestoreError(
        `Fichier illisible : ${e instanceof Error ? e.message : "format JSON invalide"}.`,
      );
    } finally {
      setRestoreReading(false);
    }
  };

  const clearRestoreFile = () => {
    setRestoreFile(null);
    setRestoreDump(null);
    setRestoreError("");
    setRestoreReport(null);
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  };

  /** Le lancement : table par table, et l'écran suit. */
  const handleRestoreBackup = async () => {
    if (!restoreDump || restoreProgress) return;
    setRestoreError("");
    setRestoreReport(null);
    const report = await restoreBackup(restoreDump, setRestoreProgress);
    setRestoreProgress(null);
    setRestoreReport(report);
    if (!report.ok) setRestoreError(report.error ?? "La restauration s'est interrompue.");
  };

  return (
    <div className="space-y-6">
      <PageHeader emoji="⚙️" title="Paramètres" subtitle="Configuration générale, sécurité et maintenance du système" />

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Settings Navigation Sidebar */}
        <div className="w-full md:w-64 flex flex-col gap-1.5 shrink-0 bg-surface border border-line p-3 rounded-2xl card-shadow">
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider px-3 mb-2 block">
            Catégories
          </span>
          
          {can("school") && (
<button
              onClick={() => setActiveTab("school")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                activeTab === "school"
                  ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                  : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
              }`}
            >
              <SchoolIcon className="h-4.5 w-4.5" />
              <span>Établissement</span>
            </button>
          )}

          {can("security") && (
<button
              onClick={() => setActiveTab("security")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                activeTab === "security"
                  ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                  : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
              }`}
            >
              <Shield className="h-4.5 w-4.5" />
              <span>Identifiants & Sécurité</span>
            </button>
          )}

          {can("whatsapp") && (
<button
              onClick={() => setActiveTab("whatsapp")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                activeTab === "whatsapp"
                  ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                  : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
              }`}
            >
              <MessageCircle className="h-4.5 w-4.5" />
              <span>WhatsApp</span>
            </button>
          )}

          {can("backup") && (
<button
              onClick={() => setActiveTab("backup")}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-all ${
                activeTab === "backup"
                  ? "bg-primary-50 text-primary border border-primary/20 shadow-sm"
                  : "text-muted hover:text-ink hover:bg-canvas/50 border border-transparent"
              }`}
            >
              <Download className="h-4.5 w-4.5" />
              <span>Sauvegarde & Données</span>
            </button>
          )}
        </div>

        {/* Settings Active View */}
        <div className="flex-1 w-full">
          {/* TAB 1: School Profile */}
          {activeTab === "school" && can("school") && (
            <Card className="border border-line rounded-2xl card-shadow">
              <CardBody className="space-y-6 p-6">
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <SchoolIcon className="h-5 w-5 text-primary" /> Profil de l'Établissement
                  </h3>
                  <p className="text-xs text-muted mt-1">Gérer les détails descriptifs et l'identité visuelle de votre école.</p>
                </div>

                {/* Section 1: General Info */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Informations Générales
                  </span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        Nom de l'école *
                      </label>
                      <Input
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        placeholder="Ex: École Privée El Ilm"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Slogan / Description
                      </label>
                      <Input
                        value={schoolDesc}
                        onChange={(e) => setSchoolDesc(e.target.value)}
                        placeholder="Ex: Cours de soutien & formations"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Coins className="h-3.5 w-3.5 text-muted" /> Frais d'inscription par défaut (DA)
                      </label>
                      <Input
                        type="number"
                        value={registrationFee || ""}
                        onChange={(e) => setRegistrationFee(Number(e.target.value))}
                        placeholder="Ex: 1000"
                        className="rounded-xl"
                      />
                    </div>

                    <div className="sm:col-span-2 border border-line/60 bg-canvas/10 p-4 rounded-2xl space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                        <div>
                          <label className="block text-xs font-bold text-ink">Facturation automatique des absences</label>
                          <p className="text-[10px] text-muted mt-0.5 leading-relaxed">
                            La semaine court d&apos;un <strong className="text-ink">vendredi au vendredi suivant</strong>.
                            Pour chaque module, si l&apos;élève n&apos;a ni scanné sa carte (sur son groupe ou sur
                            n&apos;importe quel autre groupe du même cours) ni été marqué présent de toute la semaine,
                            une séance de ce module est décomptée de son abonnement.
                          </p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={absencePenaltyEnabled}
                          onChange={(e) => setAbsencePenaltyEnabled(e.target.checked)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="text-xs font-semibold text-ink">
                          {absencePenaltyEnabled ? "Activée" : "Désactivée"}
                        </span>
                      </label>
                      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <div className="flex-1">
                          <label className="block text-[10px] font-semibold text-muted mb-1">
                            Facturer les semaines à partir du (les absences avant cette date ne sont jamais facturées)
                          </label>
                          <Input
                            type="date"
                            value={absencePenaltySince}
                            onChange={(e) => setAbsencePenaltySince(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <div className="sm:w-56">
                          <label className="block text-[10px] font-semibold text-muted mb-1">
                            La semaine commence le
                          </label>
                          <Select
                            value={String(absenceWeekStartDay)}
                            onChange={(e) => setAbsenceWeekStartDay(Number(e.target.value))}
                            className="rounded-xl"
                          >
                            <option value="5">Vendredi (par défaut)</option>
                            <option value="6">Samedi</option>
                            <option value="0">Dimanche</option>
                            <option value="1">Lundi</option>
                            <option value="2">Mardi</option>
                            <option value="3">Mercredi</option>
                            <option value="4">Jeudi</option>
                          </Select>
                        </div>
                        <Button variant="outline" onClick={handleSaveAbsenceBilling} className="shrink-0">
                          <Save className="h-3.5 w-3.5 me-1.5" /> Enregistrer
                        </Button>
                      </div>

                      {/* Per-module programming: each module can be excluded, or
                          use a window other than 7 days. */}
                      <div className="border-t border-line/50 pt-3 space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                          Programmation par module ({modules.length})
                        </label>
                        <p className="text-[10px] text-muted leading-relaxed">
                          Chaque module est facturé indépendamment : décochez-en un pour ne jamais facturer
                          ses absences, ou modifiez sa fenêtre (7 jours par défaut).
                        </p>
                        {modules.length === 0 ? (
                          <p className="text-[10px] italic text-muted py-2">Aucun module enregistré.</p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                            {modules.map((m) => {
                              const rule = moduleAbsenceRules.find((r) => r.moduleId === m.id);
                              const enabled = rule?.enabled ?? true;
                              const win = rule?.daysWindow ?? 7;
                              return (
                                <div
                                  key={m.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2"
                                >
                                  <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={enabled}
                                      onChange={(e) => setModuleAbsenceRule(m.id, e.target.checked, win)}
                                      className="h-4 w-4 accent-primary shrink-0"
                                      disabled={!absencePenaltyEnabled}
                                    />
                                    <span className={`text-xs font-semibold truncate ${enabled ? "text-ink" : "text-muted line-through"}`}>
                                      {m.name}
                                    </span>
                                  </label>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[10px] text-muted">Fenêtre</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      value={win}
                                      onChange={(e) =>
                                        setModuleAbsenceRule(m.id, enabled, Math.max(1, Number(e.target.value) || 7))
                                      }
                                      className="w-16 rounded-lg text-xs"
                                      disabled={!absencePenaltyEnabled || !enabled}
                                    />
                                    <span className="text-[10px] text-muted">jours</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="sm:col-span-2 border-t border-line/50 pt-4 mt-2 flex flex-col sm:flex-row items-center gap-4 bg-canvas/10 p-4 rounded-2xl">
                      <div className="h-16 w-16 rounded-2xl bg-canvas border border-line flex items-center justify-center overflow-hidden shrink-0 relative">
                        {schoolLogo ? (
                          <img src={schoolLogo} alt="Logo" className="h-full w-full object-cover" />
                        ) : (
                          <SchoolIcon className="h-8 w-8 text-muted" />
                        )}
                      </div>

                      <div className="flex-1 text-center sm:text-left space-y-1.5">
                        <label className="block text-xs font-bold text-ink">Logo de l'Établissement</label>
                        <p className="text-[10px] text-muted">Format recommandé : Image carrée (PNG, JPG), max 10 Mo.</p>

                        <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                          <label className="cursor-pointer bg-primary hover:bg-primary/90 text-white rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all shadow-sm flex items-center gap-1.5">
                            <Upload className="h-3.5 w-3.5" />
                            <span>{logoUploading ? "Envoi..." : "Importer une image"}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={logoUploading}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setLogoUploading(true);
                                try {
                                  const url = await uploadImage("logos", file);
                                  setSchoolLogo(url);
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : "Échec de l'envoi de l'image.");
                                } finally {
                                  setLogoUploading(false);
                                }
                              }}
                            />
                          </label>

                          {schoolLogo && (
                            <button
                              type="button"
                              onClick={() => setSchoolLogo("")}
                              className="bg-danger/10 hover:bg-danger/15 text-danger border border-danger/30 rounded-xl px-3 py-1.5 text-[11px] font-bold transition-all flex items-center gap-1.5"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Contact Details */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Coordonnées de Contact
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-muted" /> Numéro de téléphone
                      </label>
                      <Input
                        value={schoolPhone}
                        onChange={(e) => setSchoolPhone(e.target.value)}
                        placeholder="+213 XX XX XX XX"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted" /> Adresse Email
                      </label>
                      <Input
                        type="email"
                        value={schoolEmail}
                        onChange={(e) => setSchoolEmail(e.target.value)}
                        placeholder="contact@ecole.com"
                        className="rounded-xl"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted" /> Adresse Physique
                      </label>
                      <Input
                        value={schoolAddress}
                        onChange={(e) => setSchoolAddress(e.target.value)}
                        placeholder="Alger, Algérie"
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Legal & Fiscal info */}
                <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block border-b border-line pb-1.5">
                    Données Fiscales & Légales
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-muted" /> Article Fiscal
                      </label>
                      <Input
                        value={articleFiscal}
                        onChange={(e) => setArticleFiscal(e.target.value)}
                        placeholder="Ex: ART-2024-0091"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-muted" /> Registre de Commerce (RC)
                      </label>
                      <Input
                        value={registreCommerce}
                        onChange={(e) => setRegistreCommerce(e.target.value)}
                        placeholder="Ex: RC-16-554120"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">N.I.F.</label>
                      <Input
                        value={nif}
                        onChange={(e) => setNif(e.target.value)}
                        placeholder="Identifiant Fiscal"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">N.I.S.</label>
                      <Input
                        value={nis}
                        onChange={(e) => setNis(e.target.value)}
                        placeholder="Identifiant Statistique"
                        className="rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-line flex justify-end">
                  <Button
                    onClick={handleSaveSchool}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold"
                  >
                    <Save className="h-4 w-4" /> Enregistrer les informations
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {/* TAB 2: Credentials & Security */}
          {activeTab === "security" && can("security") && (
            <Card className="border border-line rounded-2xl card-shadow">
              <CardBody className="space-y-6 p-6">
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" /> Sécurité & Identifiants Admin
                  </h3>
                  <p className="text-xs text-muted mt-1">Modifier les accès au panneau d'administration général.</p>
                </div>

                {sessionUser ? (
                  <div className="space-y-5 text-xs">
                    <div className="bg-canvas/20 border border-line/60 rounded-2xl p-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted" /> Nom complet
                          </label>
                          <Input
                            value={adminName}
                            onChange={(e) => setAdminName(e.target.value)}
                            className="rounded-xl"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-muted" /> Adresse Email (connexion)
                          </label>
                          <Input type="email" value={sessionUser.email} disabled className="rounded-xl opacity-60" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-muted mb-1 flex items-center gap-1.5">
                            <Lock className="h-3.5 w-3.5 text-muted" /> Nouveau mot de passe
                          </label>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              value={adminPassword}
                              onChange={(e) => setAdminPassword(e.target.value)}
                              placeholder="Laisser vide pour ne pas changer"
                              className="rounded-xl w-full pr-12"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-ink text-[11px] font-bold"
                            >
                              {showPassword ? "Masquer" : "Afficher"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-line flex justify-end">
                      <Button
                        onClick={handleSaveAdmin}
                        disabled={savingAdmin}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold"
                      >
                        <Save className="h-4 w-4" /> {savingAdmin ? "..." : "Mettre à jour la sécurité"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-warning/10 border border-warning/20 rounded-2xl flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <span className="text-xs font-semibold">Compte administrateur introuvable.</span>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* TAB 3: WhatsApp gateway */}
          {activeTab === "whatsapp" && can("whatsapp") && <WhatsAppSettingsPanel />}

          {/* TAB 4: Backup & Restore */}
          {activeTab === "backup" && can("backup") && (
            <div className="space-y-6">
              {/* Export panel */}
              <Card className="border border-line rounded-2xl card-shadow">
                <CardBody className="space-y-4 p-6">
                  <div>
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <Download className="h-5 w-5 text-success" /> Sauvegarde locale de sécurité
                    </h3>
                    <p className="text-xs text-muted mt-1">Conservez une copie locale physique de toutes vos données.</p>
                  </div>

                  <p className="text-xs text-muted/80 leading-relaxed">
                    Téléchargez une copie complète au format <strong>JSON</strong> contenant toutes les informations enregistrées :
                    élèves, abonnements, présences, acomptes, journal de caisse et dépenses de fonctionnement.
                  </p>

                  <div className="pt-2">
                    <Button
                      onClick={handleDownloadBackup}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-success hover:bg-success/90 border-none px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md"
                    >
                      <Download className="h-4.5 w-4.5" /> Exporter la base de données (.json)
                    </Button>
                  </div>
                </CardBody>
              </Card>

              {/* Import panel */}
              <Card className="border border-line rounded-2xl card-shadow">
                <CardBody className="space-y-4 p-6">
                  <div>
                    <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                      <Upload className="h-5 w-5 text-warning" /> Restaurer une sauvegarde existante
                    </h3>
                    <p className="text-xs text-muted mt-1">Réinstaller un état précédent à partir de votre JSON exporté.</p>
                  </div>

                  <div className="p-4 bg-danger/10 border border-danger/25 rounded-2xl text-danger flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-xs block font-bold">Action Critique !</strong>
                      <span className="text-[11px] block mt-0.5 leading-relaxed">
                        L'importation écrase l'intégralité des données en mémoire courante de l'application. Assurez-vous
                        de posséder une sauvegarde récente avant de procéder.
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* ---- 1. LE FICHIER : déposé ou choisi ----------------- */}
                    <input
                      ref={restoreInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void readRestoreFile(file);
                      }}
                    />

                    {!restoreFile ? (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragging(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) void readRestoreFile(file);
                        }}
                        onClick={() => restoreInputRef.current?.click()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") restoreInputRef.current?.click();
                        }}
                        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
                          dragging
                            ? "border-primary bg-primary-50/60"
                            : "border-line bg-canvas/40 hover:border-primary hover:bg-primary-50/30"
                        }`}
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-50">
                          <Upload className="h-5 w-5 text-primary" />
                        </span>
                        <strong className="text-xs font-bold text-ink">
                          Déposez ici votre fichier de sauvegarde
                        </strong>
                        <span className="text-[11px] text-muted">
                          ou cliquez pour le choisir — le <code className="font-mono">.json</code>{" "}
                          exporté par le bouton ci-dessus
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-canvas/40 p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                            {restoreReading ? (
                              <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            ) : (
                              <FileJson className="h-5 w-5 text-primary" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <strong className="block truncate text-xs font-bold text-ink">
                              {restoreFile.name}
                            </strong>
                            <span className="block text-[10px] text-muted">
                              {(restoreFile.size / 1024 / 1024).toFixed(2)} Mo
                              {restoreDump
                                ? ` · ${countRows(restoreDump).toLocaleString("fr-FR")} ligne(s) · ${
                                    restoreDump.students?.length ?? 0
                                  } élève(s)`
                                : restoreReading
                                  ? " · lecture en cours…"
                                  : ""}
                            </span>
                          </div>
                        </div>
                        {!restoreProgress && (
                          <button
                            onClick={clearRestoreFile}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                            title="Retirer ce fichier"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* ---- 2. CE QUE LE FICHIER CONTIENT -------------------- */}
                    {restoreDump && !restoreProgress && !restoreReport && (
                      <div className="rounded-2xl border border-line bg-surface p-3">
                        <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">
                          Ce qui sera remis en place
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              ["Élèves", restoreDump.students?.length],
                              ["Emplois du temps", restoreDump.sessions?.length],
                              ["Enseignants", restoreDump.teachers?.length],
                              ["Inscriptions", restoreDump.enrollments?.length],
                              ["Versements", restoreDump.payments?.length],
                              ["Présences", restoreDump.attendance?.length],
                              ["Caisse", restoreDump.cash?.length],
                            ] as const
                          )
                            .filter(([, n]) => typeof n === "number")
                            .map(([label, n]) => (
                              <span
                                key={label}
                                className="rounded-lg border border-line bg-canvas/60 px-2 py-1 text-[10px] text-muted"
                              >
                                {label} <strong className="font-mono text-ink">{n}</strong>
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* ---- 3. LE TRAITEMENT, TABLE PAR TABLE ---------------- */}
                    {restoreProgress && (
                      <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary-50/40 p-4">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <strong className="text-xs font-bold text-ink">
                            {restoreProgress.phase === "clear"
                              ? "Nettoyage de la base"
                              : "Écriture des données"}
                          </strong>
                          <span className="ms-auto font-mono text-[10px] text-muted">
                            {restoreProgress.step} / {restoreProgress.total}
                          </span>
                        </div>

                        <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                            style={{
                              width: `${Math.round(
                                (restoreProgress.step / Math.max(1, restoreProgress.total)) * 100,
                              )}%`,
                            }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="truncate font-mono text-[11px] text-ink">
                            {restoreProgress.label}
                          </span>
                          <span className="font-mono text-[10px] text-muted">
                            {restoreProgress.rowsWritten.toLocaleString("fr-FR")} ligne(s) écrites
                          </span>
                        </div>
                        <p className="text-[10px] leading-relaxed text-muted">
                          Ne fermez pas cette page : chaque table part vers la base et attend sa
                          confirmation avant que la suivante ne commence.
                        </p>
                      </div>
                    )}

                    {/* ---- 4. LE COMPTE RENDU ------------------------------- */}
                    {restoreReport?.ok && (
                      <div className="rounded-2xl border border-success/40 bg-success/10 p-4">
                        <strong className="flex items-center gap-2 text-xs font-bold text-success">
                          <CheckCircle2 className="h-4 w-4" /> Restauration terminée
                        </strong>
                        <p className="mt-1 text-[11px] leading-relaxed text-ink">
                          {restoreReport.rows.toLocaleString("fr-FR")} ligne(s) remises en place sur{" "}
                          {restoreReport.collections} table(s).
                          {restoreReport.removed > 0 && (
                            <>
                              {" "}
                              {restoreReport.removed.toLocaleString("fr-FR")} ligne(s) absentes de la
                              sauvegarde ont été retirées.
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    {restoreError && (
                      <div className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{restoreError}</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      {restoreReport?.ok && (
                        <Button
                          onClick={clearRestoreFile}
                          variant="outline"
                          className="px-5 py-2.5 rounded-xl text-xs font-bold border-line text-ink"
                        >
                          Terminer
                        </Button>
                      )}
                      <Button
                        onClick={handleRestoreBackup}
                        disabled={!restoreDump || !!restoreProgress || restoreReading}
                        variant="outline"
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold border-line hover:bg-primary-50 text-ink"
                      >
                        {restoreProgress ? "Restauration en cours…" : "Lancer la Restauration"}
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
