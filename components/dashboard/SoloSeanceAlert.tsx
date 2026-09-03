"use client";

/**
 * « CET ENSEIGNANT N'A PAS ENCORE TOUCHÉ SA PART » — l'alerte des séances
 * libres solo, partout où elle doit se voir.
 *
 * Une séance libre solo ne passe par aucun écran de paie mensuelle : sa part
 * est soit versée le jour même, soit DUE. Tant qu'elle l'est, elle doit sauter
 * aux yeux là où l'on regarde :
 *
 *   · `banner`  — sur le tableau de bord, en travers de l'écran ;
 *   · `card`    — sur la carte de l'enseignant, en petit ;
 *   · `inline`  — en haut de sa fiche, avec le détail de chaque séance.
 *
 * Les trois lisent la même liste (`unpaidSoloSeances`) et proposent le même
 * geste : un clic verse la part, écrit la sortie de caisse et fait disparaître
 * l'alerte des trois endroits d'un coup — l'historique de l'enseignant passant
 * dans le même mouvement de « à verser » à « versée ».
 */

import { useState } from "react";
import { useData } from "@/lib/store/data";
import { useToast } from "@/lib/store/toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDA } from "@/lib/utils";
import { formatDateFr, soloSeanceTotals, unpaidSoloSeances } from "@/lib/helpers";
import type { SoloSeance } from "@/lib/types";
import { AlertTriangle, HandCoins, Ticket } from "lucide-react";

export function SoloSeanceAlert({
  variant = "banner",
  teacherId,
}: {
  variant?: "banner" | "card" | "inline";
  /** limite l'alerte à UN enseignant — sa carte, sa fiche */
  teacherId?: string;
}) {
  const db = useData();
  const { setSoloSeanceTeacherPaid } = db;
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);

  const rows = unpaidSoloSeances(db, teacherId);
  if (rows.length === 0) return null;

  const total = rows.reduce((s, g) => s + soloSeanceTotals(g).teacherTotal, 0);
  const teacherName = (id: string) => {
    const t = db.teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}` : "—";
  };

  const settle = async (g: SoloSeance) => {
    const res = await setSoloSeanceTeacherPaid(g.id, true);
    addToast({
      type: res.ok ? "success" : "danger",
      title: res.ok ? "Part versée" : "Opération impossible",
      message: res.ok
        ? `${formatDA(res.amount ?? 0)} versés à ${teacherName(g.teacherId)} — « ${g.title} ».`
        : "Réessayez.",
    });
  };

  // ---- la pastille d'une carte d'enseignant --------------------------------
  if (variant === "card") {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          title="Des séances libres solo lui sont encore dues — cliquer pour les régler"
          className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[9px] font-bold text-white transition-transform hover:scale-105"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {formatDA(total)} à verser
        </button>
        {open && (
          <SettleModal
            rows={rows}
            teacherLabel={teacherName}
            onSettle={settle}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  // ---- le bandeau du tableau de bord --------------------------------------
  if (variant === "banner") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-start transition-colors hover:bg-danger/15"
        >
          <span className="flex items-center gap-3">
            <Ticket className="h-5 w-5 shrink-0 text-danger" />
            <span>
              <strong className="block text-sm text-danger">
                {rows.length} séance(s) libre(s) solo à régler — {formatDA(total)}
              </strong>
              <span className="block text-[11px] text-danger/80">
                Ces enseignants n&apos;ont pas encore touché leur part. Cliquez pour la verser.
              </span>
            </span>
          </span>
          <Badge tone="danger" className="gap-1">
            <HandCoins className="h-3 w-3" /> Régler
          </Badge>
        </button>
        {open && (
          <SettleModal
            rows={rows}
            teacherLabel={teacherName}
            onSettle={settle}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  // ---- le bandeau détaillé, en haut d'une fiche d'enseignant --------------
  return (
    <div className="space-y-2 rounded-2xl border border-danger/40 bg-danger/10 p-3">
      <strong className="flex items-center gap-2 text-xs text-danger">
        <AlertTriangle className="h-4 w-4" />
        {rows.length} séance(s) libre(s) solo non réglée(s) — {formatDA(total)} à verser
      </strong>
      <div className="space-y-1.5">
        {rows.map((g) => {
          const t = soloSeanceTotals(g);
          return (
            <div
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-surface px-3 py-2 text-xs"
            >
              <span className="min-w-0">
                <strong className="block truncate text-ink">{g.title}</strong>
                <span className="block text-[10px] text-muted">
                  {formatDateFr(g.date)} · {g.startTime}–{g.endTime} · {t.students} élève(s)
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono font-bold text-danger">{formatDA(t.teacherTotal)}</span>
                <Button size="sm" variant="danger" onClick={() => settle(g)} className="gap-1">
                  <HandCoins className="h-3 w-3" /> Il a touché sa part
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettleModal({
  rows,
  teacherLabel,
  onSettle,
  onClose,
}: {
  rows: SoloSeance[];
  teacherLabel: (id: string) => string;
  onSettle: (g: SoloSeance) => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Séances libres solo à régler">
      <div className="space-y-3">
        <p className="text-[11px] text-muted">
          Ces séances ont été encaissées auprès des élèves, mais la part de l&apos;enseignant n&apos;a
          pas encore été versée. Un clic la verse : la sortie de caisse est écrite et son historique
          passe aussitôt à « versée ».
        </p>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pe-1">
          {rows.map((g) => {
            const t = soloSeanceTotals(g);
            return (
              <div
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-ink">{g.title}</strong>
                  <span className="block text-[10px] text-muted">
                    {teacherLabel(g.teacherId)} · {formatDateFr(g.date)} · {g.startTime}–{g.endTime} ·{" "}
                    {t.students} élève(s)
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono font-bold text-danger">{formatDA(t.teacherTotal)}</span>
                  <Button size="sm" variant="danger" onClick={() => onSettle(g)} className="gap-1">
                    <HandCoins className="h-3 w-3" /> Verser
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
