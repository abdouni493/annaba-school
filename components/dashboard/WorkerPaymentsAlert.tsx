"use client";

/**
 * LA CLOCHE DE LA DIRECTION — les encaissements saisis par les travailleurs.
 *
 * Un travailleur ouvre la feuille de présence d'un groupe depuis le tableau de
 * bord, pointe les élèves, et encaisse au passage. L'argent entre bien en
 * caisse, mais l'administration ne le voyait qu'en dépouillant la caisse à la
 * fin de la journée.
 *
 * Chaque versement signé d'un travailleur remonte donc ici, et y reste tant que
 * la direction ne l'a pas marqué lu. Elle peut l'imprimer — sur le reçu de
 * l'école, celui-là même qu'on remet à la famille — et l'impression propose
 * alors de le retirer de la liste : le geste normal, c'est d'imprimer puis de
 * classer.
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
import { Bell, BellRing, Check, CheckCheck, Clock, Printer, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { useSettings } from "@/lib/store/settings";
import { printHtmlDocument } from "@/lib/print";
import { paymentReceiptHtml } from "@/lib/reports/documents";
import { enrollmentLabel, formatDateFr, studentName } from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import type { Payment } from "@/lib/types";

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
  /** le versement dont on vient de lancer l'impression, et qu'on propose de classer */
  const [justPrinted, setJustPrinted] = useState<Payment | null>(null);

  /**
   * Ce qui remonte : un versement écrit par un compte de rôle « reception »
   * — c'est-à-dire un travailleur — et pas encore lu. Ce que l'administration
   * saisit elle-même ne remonte jamais : elle le sait déjà.
   */
  const pending = useMemo(
    () =>
      db.payments
        .filter((p) => p.createdByRole === "reception" && !p.alertRead)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [db.payments],
  );

  const total = pending.reduce((s, p) => s + p.amountPaid, 0);

  const markRead = (payment: Payment) => {
    updateItem("payments", payment.id, { alertRead: true });
  };

  const markAllRead = () => {
    for (const p of pending) updateItem("payments", p.id, { alertRead: true });
    addToast({
      type: "success",
      title: "Alertes classées",
      message: `${pending.length} encaissement(s) marqué(s) comme lus.`,
    });
  };

  const print = (payment: Payment) => {
    try {
      printHtmlDocument(paymentReceiptHtml(db, { payment, language }));
      setJustPrinted(payment);
    } catch {
      addToast({
        type: "danger",
        title: "Impression impossible",
        message: "L'élève de ce versement n'existe plus.",
      });
    }
  };

  const labelOf = (p: Payment): string => {
    const enr = p.enrollmentId ? db.enrollments.find((e) => e.id === p.enrollmentId) : undefined;
    if (enr) return enrollmentLabel(db, enr);
    if (p.chargeId) {
      const charge = db.studentCharges.find((c) => c.id === p.chargeId);
      if (charge) return `Frais — ${charge.name}`;
    }
    return p.description || "Versement";
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
          Paiements des travailleurs
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
              Les versements encaissés par un travailleur — depuis une feuille de présence, une
              fiche d&apos;élève ou le comptoir — apparaissent ici jusqu&apos;à ce que vous les
              marquiez comme lus.
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
              {pending.map((p) => {
                const student = db.students.find((s) => s.id === p.studentId);
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <strong className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                        {student ? studentName(student) : "Élève supprimé"}
                        <Badge
                          tone={p.type === "debt_payment" ? "success" : "primary"}
                          className="px-1.5 py-0 text-[9px]"
                        >
                          {p.type === "debt_payment" ? "Règlement de dette" : "Achat de séances"}
                        </Badge>
                      </strong>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {labelOf(p)}
                        {p.monthCode ? ` · ${p.monthCode}` : ""}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[9px] text-muted">
                        <span className="flex items-center gap-1">
                          <User className="h-2.5 w-2.5" />
                          {p.createdByName || "Travailleur inconnu"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDateFr(p.date.slice(0, 10))} {fmtClock(p.date)}
                        </span>
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <strong className="font-mono text-sm font-bold text-success">
                        +{formatDA(p.amountPaid)}
                      </strong>
                      <button
                        title="Imprimer le reçu"
                        onClick={() => print(p)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-primary transition-colors hover:bg-primary-50"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      <button
                        title="Marquer comme lu"
                        onClick={() => markRead(p)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 text-[10px] font-bold text-success transition-colors hover:bg-success/20"
                      >
                        <Check className="h-3.5 w-3.5" /> Lu
                      </button>
                    </div>
                  </div>
                );
              })}
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
              Le reçu de{" "}
              <strong>
                {db.students.find((s) => s.id === justPrinted.studentId)
                  ? studentName(db.students.find((s) => s.id === justPrinted.studentId)!)
                  : "cet élève"}
              </strong>{" "}
              a été envoyé à l&apos;impression. Voulez-vous le retirer des alertes ?
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
