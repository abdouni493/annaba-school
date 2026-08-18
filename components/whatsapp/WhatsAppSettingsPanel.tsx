"use client";

import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, MessageCircle } from "lucide-react";

/**
 * Mode démo : l'application tourne entièrement en mémoire, sans serveur ni
 * passerelle Meta. Le panneau reste visible pour documenter la fonctionnalité,
 * mais il n'interroge plus rien et aucun message ne peut partir.
 */
export function WhatsAppSettingsPanel() {
  return (
    <Card className="border border-line rounded-2xl card-shadow">
      <CardBody className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <MessageCircle className="h-5 w-5 text-primary" /> WhatsApp Cloud API (Meta)
            </h3>
            <p className="mt-1 text-xs text-muted">
              Alertes de séances et de dette aux élèves et aux parents via le numéro WhatsApp
              officiel de l&apos;école.
            </p>
          </div>
          <Badge tone="warning">Désactivé en mode démo</Badge>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-xs text-ink">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span>
            Cette version de démonstration fonctionne sans backend : les données vivent en mémoire
            dans le navigateur. Les écrans d&apos;envoi restent accessibles pour la présentation,
            mais aucun message n&apos;est réellement transmis et aucun identifiant Meta n&apos;est
            requis.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
