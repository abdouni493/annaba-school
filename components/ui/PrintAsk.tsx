"use client";

/**
 * « Imprimer le reçu ? » — la question posée après chaque encaissement, jamais
 * imposée. Elle vit ici, dans les briques d'interface, parce que trois écrans
 * la posent : la feuille de présence, l'écran « Payer & recharger » et le
 * règlement des frais.
 */

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { printHtmlDocument } from "@/lib/print";

export function PrintAsk({
  html,
  onClose,
  question = "Imprimer le reçu du paiement ?",
}: {
  html: string;
  onClose: () => void;
  question?: string;
}) {
  return (
    <Modal open onClose={onClose} title="Impression">
      <div className="space-y-4">
        <p className="text-sm text-ink">{question}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Non, merci
          </Button>
          <Button
            onClick={() => {
              printHtmlDocument(html);
              onClose();
            }}
            className="gap-1.5"
          >
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
