"use client";

/**
 * L'ÉCRAN QU'ON N'A PAS LE DROIT D'OUVRIR.
 *
 * La barre latérale ne montre déjà que les écrans autorisés, mais une adresse
 * tapée à la main, un signet ou un lien reçu passeraient à côté du menu. Plutôt
 * qu'une page blanche ou une erreur, le travailleur lit ce qui se passe et sait
 * à qui s'adresser.
 */

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export function AccessDenied() {
  return (
    <Card className="mx-auto max-w-lg border border-line card-shadow">
      <CardBody className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10">
          <ShieldAlert className="h-7 w-7 text-warning" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-bold text-ink">Écran non autorisé</h2>
          <p className="text-xs leading-relaxed text-muted">
            Votre compte n&apos;a pas accès à cet écran. L&apos;administration décide, travailleur
            par travailleur, des écrans visibles et des actions permises — demandez-lui
            d&apos;ouvrir celui-ci si vous en avez besoin.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline">Retour</Button>
        </Link>
      </CardBody>
    </Card>
  );
}
