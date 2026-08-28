"use client";

/**
 * LA CLOCHE DE LA DIRECTION — l'argent encaissé par les travailleurs.
 *
 * Un travailleur ouvre la feuille de présence d'un groupe depuis le tableau de
 * bord, pointe les élèves, et encaisse au passage. L'argent entre bien en
 * caisse, mais l'administration ne le voyait qu'en dépouillant la caisse à la
 * fin de la journée.
 *
 * DEUX CHOSES REMONTENT ICI, parce que toutes deux font entrer de l'argent :
 *
 *  · LES VERSEMENTS — un solde rechargé, une dette réglée ;
 *  · LES SÉANCES LIBRES — un passager, ou un élève déjà inscrit venu suivre une
 *    séance d'un groupe où il n'est pas inscrit. Elles ne passaient nulle part :
 *    la caisse s'en souvenait, personne ne le savait, et aucun reçu ne partait.
 *
 * L'un comme l'autre y restent tant que la direction ne les a pas marqués lus.
 * Elle peut les imprimer — sur le reçu de l'école, celui-là même qu'on remet à
 * la famille — et l'impression propose alors de les retirer de la liste : le
 * geste normal, c'est d'imprimer puis de classer.
 *
 * Le bouton n'existe que pour l'administration : un travailleur n'a pas à se
 * surveiller lui-même.
 *
 * DEUX FAÇONS DE LE MONTRER, parce qu'une cloche se rate.
 *
 * `variant="bell"` est le bouton de l'en-tête, toujours là, qui porte son
 * compteur. `variant="banner"` est la bande qui barre le tableau de bord et qui
 * n'apparaît QUE s'il y a quelque chose à lire : de l'argent est entré en
 * caisse sans que la direction l'ait vu passer, et c'est le genre de chose
 * qu'on ne découvre pas en cliquant sur une icône qu'on avait oubliée.
 */

import { useMemo, useState } from "react";
import { Bell, BellRing, Check, CheckCheck, Clock, Printer, Ticket, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { paymentReceiptHtml, seanceLibreInvoiceHtml } from "@/lib/reports/documents";
import {
  enrollmentLabel,
  formatDateFr,
  independentTotals,
  passagerLabel,
  registrationNumberOf,
  studentName,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import type { IndependentSession, Payment } from "@/lib/types";

/**
 * Une ligne de la cloche, quelle que soit sa nature : un versement ou une
 * séance libre. Les deux se lisent pareil — qui, combien, quand, par qui — et
 * l'écran n'a donc qu'une seule sorte de carte à dessiner.
 */
interface AlertRow {
  key: string;
  kind: "payment" | "seance";
  payment?: Payment;
  seance?: IndependentSession;
  /** l'élève ou le passager que la ligne nomme */
  who: string;
  /** ce que la ligne dit en dessous du nom */
  detail: string;
  amount: number;
  date: string;
  author: string;
}

export function WorkerPaymentsAlert({
  variant = "bell",
}: {
  variant?: "bell" | "banner";
} = {}) {
  const db = useData();
  const updateItem = useData((s) => s.updateItem);
  const { addToast } = useToast();
  const language = useSettings((s) => s.language);

  const [open, setOpen] = useState(false);
  /** la ligne dont on vient de lancer l'impression, et qu'on propose de classer */
  const [justPrinted, setJustPrinted] = useState<AlertRow | null>(null);

  /**
   * Ce qui remonte : une ligne écrite par un compte de rôle « reception » —
   * c'est-à-dire un travailleur — et pas encore lue. Versements et séances
   * libres suivent la même règle, et se rangent ensemble du plus récent au plus
   * ancien. Ce que l'administration saisit elle-même ne remonte jamais : elle
   * le sait déjà.
   */
  const pending = useMemo(() => {
    /** Ce qu'un versement dit sous le nom : l'emploi du temps qu'il crédite,
     *  le frais qu'il règle, ou à défaut son libellé. */
    const labelOf = (p: Payment): string => {
      const enr = p.enrollmentId ? db.enrollments.find((e) => e.id === p.enrollmentId) : undefined;
      if (enr) return enrollmentLabel(db, enr);
      if (p.chargeId) {
        const charge = db.studentCharges.find((c) => c.id === p.chargeId);
        if (charge) return `Frais — ${charge.name}`;
      }
      return p.description || "Versement";
    };

    const rows: AlertRow[] = [];
    for (const p of db.payments) {
      if (p.createdByRole !== "reception" || p.alertRead) continue;
      const student = db.students.find((s) => s.id === p.studentId);
      rows.push({
        key: p.id,
        kind: "payment",
        payment: p,
        who: student ? studentName(student) : "Élève supprimé",
        detail: `${labelOf(p)}${p.monthCode ? ` · ${p.monthCode}` : ""}`,
        amount: p.amountPaid,
        date: p.date,
        author: p.createdByName || "Travailleur inconnu",
      });
    }
    // Une séance libre n'a pas de `date` horodatée : sa journée suffit, et
    // `createdAt` sert à la ranger parmi les versements de la même journée.
    for (const ind of db.independent) {
      if (ind.createdByRole !== "reception" || ind.alertRead) continue;
      rows.push({
        key: ind.id,
        kind: "seance",
        seance: ind,
        who: passagerLabel(db, ind),
        detail: `Séance libre — ${ind.itemLabel}${
          ind.startTime ? ` · ${ind.startTime}–${ind.endTime ?? ""}` : ""
        }`,
        amount: independentTotals(ind).price,
        date: ind.createdAt || `${ind.date}T12:00:00.000Z`,
        author: ind.createdByName || "Travailleur inconnu",
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [db]);

  const total = pending.reduce((s, r) => s + r.amount, 0);
  const seanceCount = pending.filter((r) => r.kind === "seance").length;

  const markRead = (row: AlertRow) => {
    updateItem(row.kind === "payment" ? "payments" : "independent", row.key, { alertRead: true });
  };

  const markAllRead = () => {
    for (const r of pending) markRead(r);
    addToast({
      type: "success",
      title: "Alertes classées",
      message: `${pending.length} encaissement(s) marqué(s) comme lus.`,
    });
  };

  const print = (row: AlertRow) => {
    try {
      if (row.kind === "payment") {
        printHtmlDocument(paymentReceiptHtml(db, { payment: row.payment!, language }));
      } else {
        const ind = row.seance!;
        const student = ind.studentId
          ? db.students.find((s) => s.id === ind.studentId)
          : undefined;
        printHtmlDocument(
          seanceLibreInvoiceHtml(db, {
            payer: row.who,
            registrationNumber: student ? registrationNumberOf(db, student) : undefined,
            itemLabel: ind.itemLabel,
            price: independentTotals(ind).price,
            date: ind.date,
            time: ind.startTime ? `${ind.startTime} - ${ind.endTime ?? ""}` : undefined,
            language,
          }),
        );
      }
      setJustPrinted(row);
    } catch {
      addToast({
        type: "danger",
        title: "Impression impossible",
        message: "L'élève de cette ligne n'existe plus.",
      });
    }
  };

  const fmtClock = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  };

  // La bande ne s'affiche que lorsqu'il y a réellement quelque chose à lire :
  // une alerte permanente n'est plus une alerte.
  if (variant === "banner" && pending.length === 0) return null;

  return (
    <>
      {variant === "banner" ? (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-left transition-colors hover:bg-warning/15"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/20">
            <BellRing className="h-4.5 w-4.5 text-warning" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-[12px] font-bold text-ink">
              {pending.length} encaissement{pending.length > 1 ? "s" : ""} saisi
              {pending.length > 1 ? "s" : ""} par un travailleur, non lu
              {pending.length > 1 ? "s" : ""}
              {seanceCount > 0 && (
                <span className="font-normal text-muted">
                  {" "}
                  · dont {seanceCount} séance{seanceCount > 1 ? "s" : ""} libre
                  {seanceCount > 1 ? "s" : ""}
                </span>
              )}
            </strong>
            <span className="block text-[10px] leading-relaxed text-muted">
              {formatDA(total)} entré{pending.length > 1 ? "s" : ""} en caisse depuis un compte de
              travailleur. Cliquez pour lire, imprimer les reçus et classer.
            </span>
          </span>
          <Badge tone="warning" className="shrink-0 font-mono text-[10px]">
            {formatDA(total)}
          </Badge>
        </button>
      ) : (
        <Button
          variant={pending.length > 0 ? "secondary" : "outline"}
          onClick={() => setOpen(true)}
          className="relative gap-2"
        >
          {pending.length > 0 ? (
            <BellRing className="h-4 w-4 text-warning" />
          ) : (
            <Bell className="h-4 w-4 text-muted" />
          )}
          Encaissements des travailleurs
          {pending.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {pending.length > 99 ? "99+" : pending.length}
            </span>
          )}
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title="Encaissements saisis par les travailleurs"
        footer={
          <>
            {pending.length > 0 && (
              <Button variant="outline" onClick={markAllRead} className="gap-1.5">
                <CheckCheck className="h-4 w-4" /> Tout marquer comme lu
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>Fermer</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-canvas/40 p-3">
            <p className="max-w-lg text-[11px] leading-relaxed text-muted">
              Tout ce qu&apos;un travailleur a fait entrer en caisse — un versement depuis une
              feuille de présence, une fiche d&apos;élève ou le comptoir, et les{" "}
              <strong className="text-ink">séances libres</strong> vendues sur un créneau —
              apparaît ici jusqu&apos;à ce que vous le marquiez comme lu.
            </p>
            <div className="flex gap-1.5">
              <Badge tone={pending.length ? "warning" : "success"} className="font-mono text-[10px]">
                {pending.length} non lu(s)
              </Badge>
              <Badge tone="success" className="font-mono text-[10px]">
                {formatDA(total)}
              </Badge>
            </div>
          </div>

          {pending.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-10 text-center text-[11px] italic text-muted">
              Aucun encaissement de travailleur en attente de lecture.
            </p>
          ) : (
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {pending.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <strong className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                      {row.who}
                      {row.kind === "seance" ? (
                        <Badge tone="warning" className="px-1.5 py-0 text-[9px]">
                          <Ticket className="me-1 inline h-2.5 w-2.5" />
                          {row.seance?.studentId ? "Séance libre — élève inscrit" : "Séance libre"}
                        </Badge>
                      ) : (
                        <Badge
                          tone={row.payment?.type === "debt_payment" ? "success" : "primary"}
                          className="px-1.5 py-0 text-[9px]"
                        >
                          {row.payment?.type === "debt_payment"
                            ? "Règlement de dette"
                            : "Achat de séances"}
                        </Badge>
                      )}
                    </strong>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">
                      {row.detail}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[9px] text-muted">
                      <span className="flex items-center gap-1">
                        <User className="h-2.5 w-2.5" />
                        {row.author}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDateFr(row.date.slice(0, 10))} {fmtClock(row.date)}
                      </span>
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <strong className="font-mono text-sm font-bold text-success">
                      +{formatDA(row.amount)}
                    </strong>
                    <button
                      title="Imprimer le reçu"
                      onClick={() => print(row)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-primary transition-colors hover:bg-primary-50"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <button
                      title="Marquer comme lu"
                      onClick={() => markRead(row)}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 text-[10px] font-bold text-success transition-colors hover:bg-success/20"
                    >
                      <Check className="h-3.5 w-3.5" /> Lu
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Imprimer puis classer : c'est le geste normal, on le propose plutôt que
          de l'imposer — un reçu réimprimé pour une autre raison ne doit pas
          faire disparaître l'alerte. */}
      {justPrinted && (
        <Modal open onClose={() => setJustPrinted(null)} title="Reçu imprimé">
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-ink">
              Le reçu de <strong>{justPrinted.who}</strong> a été envoyé à l&apos;impression.
              Voulez-vous le retirer des alertes ?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setJustPrinted(null)}>
                Le garder en alerte
              </Button>
              <Button
                onClick={() => {
                  markRead(justPrinted);
                  setJustPrinted(null);
                }}
                className="gap-1.5"
              >
                <Check className="h-4 w-4" /> Retirer des alertes
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
