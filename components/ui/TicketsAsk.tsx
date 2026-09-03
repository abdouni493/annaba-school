"use client";

/**
 * « LES BONS DE LA SÉANCE » — un bon par élève, imprimable séparément.
 *
 * Une séance libre saisie pour six passagers ne produisait qu'UN seul reçu, au
 * nom du premier d'entre eux et pour le total encaissé : les cinq autres
 * repartaient sans rien, et personne ne pouvait réimprimer le bon d'un seul.
 *
 * Cette fenêtre pose donc la question autrement. Elle liste les bons — un par
 * personne, chacun à SON nom et pour SON prix — et laisse imprimer celui qu'on
 * veut, quand on veut. « Tout imprimer » les enchaîne un par un : chaque bon
 * reste un document indépendant, la boîte de dialogue suivante ne s'ouvrant
 * qu'une fois la précédente refermée.
 */

import { useState } from "react";
import { Check, Printer } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { printHtmlDocument, printHtmlDocuments } from "@/lib/print";
import { formatDA } from "@/lib/utils";

export interface PrintableTicket {
  id: string;
  /** le nom qui figure sur le bon */
  title: string;
  /** la séance, la date, l'heure — ce qui situe le bon */
  subtitle?: string;
  /** ce que ce bon-là encaisse */
  amount?: number;
  /** le document complet, prêt pour l'imprimante */
  html: string;
}

export function TicketsAsk({
  tickets,
  onClose,
  title = "Bons de la séance libre",
  question = "Chaque élève a son bon. Imprimez celui que vous voulez — ou tous, l'un après l'autre.",
}: {
  tickets: PrintableTicket[];
  onClose: () => void;
  title?: string;
  question?: string;
}) {
  /** Ceux qui sont déjà partis à l'imprimante — pour ne pas les chercher deux fois. */
  const [printed, setPrinted] = useState<string[]>([]);

  if (tickets.length === 0) return null;

  const markPrinted = (ids: string[]) =>
    setPrinted((prev) => [...new Set([...prev, ...ids])]);

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-ink">{question}</p>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pe-1">
          {tickets.map((t) => {
            const done = printed.includes(t.id);
            return (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                  done ? "border-success/40 bg-success/5" : "border-line bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-ink">{t.title}</strong>
                  {t.subtitle && (
                    <span className="block truncate text-[11px] text-muted">{t.subtitle}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {typeof t.amount === "number" && (
                    <Badge tone="success" className="font-mono text-[10px]">
                      {formatDA(t.amount)}
                    </Badge>
                  )}
                  {done && <Check className="h-4 w-4 text-success" />}
                  <Button
                    size="sm"
                    variant={done ? "outline" : "primary"}
                    onClick={() => {
                      markPrinted([t.id]);
                      printHtmlDocument(t.html);
                    }}
                    className="gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" /> {done ? "Réimprimer" : "Imprimer"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
          {tickets.length > 1 && (
            <Button
              onClick={() => {
                markPrinted(tickets.map((t) => t.id));
                printHtmlDocuments(tickets.map((t) => t.html));
              }}
              className="gap-1.5"
            >
              <Printer className="h-4 w-4" /> Tout imprimer ({tickets.length})
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
