"use client";

/**
 * LES DROITS D'ACCÈS D'UN TRAVAILLEUR.
 *
 * L'écran se lit de gauche à droite, dans l'ordre de la décision :
 *
 *   à gauche  — TOUS les écrans de l'application, exactement comme la barre
 *               latérale les présente. On coche ceux qu'il verra.
 *   à droite  — les boutons de l'écran SÉLECTIONNÉ. On coche ceux qu'il pourra
 *               utiliser.
 *
 * Cocher un écran n'ouvre AUCUN bouton : un travailleur peut très bien
 * consulter les élèves sans pouvoir en créer un. Décocher un écran retire ses
 * boutons du même geste — ils n'auraient plus rien à ouvrir.
 */

import { useMemo, useState } from "react";
import { Check, ChevronRight, Eye, Lock, MousePointerClick, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  PERMISSION_PAGES,
  actionKey,
  type PermissionPage,
} from "@/lib/permissions";
import type { ReceptionStaff } from "@/lib/types";
import { workerName } from "@/lib/workers";

export function WorkerPermissionsModal({
  worker,
  onClose,
  onSave,
}: {
  worker: ReceptionStaff;
  onClose: () => void;
  onSave: (navKeys: string[], actionKeys: string[]) => void;
}) {
  // Les droits en cours d'édition partent de la fiche. La fenêtre est montée
  // AVEC LA CLÉ du travailleur : en ouvrir un autre la remonte, et l'état
  // repart donc de SES droits — sans effet de remise à zéro.
  const [pages, setPages] = useState<string[]>(worker.navKeys ?? []);
  const [actions, setActions] = useState<string[]>(worker.actionKeys ?? []);
  const [focused, setFocused] = useState<string>(
    worker.navKeys?.[0] ?? PERMISSION_PAGES[0].key,
  );

  const page = useMemo<PermissionPage>(
    () => PERMISSION_PAGES.find((p) => p.key === focused) ?? PERMISSION_PAGES[0],
    [focused],
  );

  const pageOn = (key: string) => pages.includes(key);
  const actionOn = (pageKey: string, id: string) => actions.includes(actionKey(pageKey, id));

  const countOn = (p: PermissionPage) =>
    p.actions.filter((a) => actionOn(p.key, a.id)).length;

  /** Décocher un écran retire ses boutons : ils n'ouvriraient plus rien. */
  const togglePage = (key: string) => {
    if (pageOn(key)) {
      setPages(pages.filter((k) => k !== key));
      setActions(actions.filter((a) => !a.startsWith(`${key}:`)));
    } else {
      setPages([...pages, key]);
      setFocused(key);
    }
  };

  /**
   * Cocher un bouton sur un écran resté fermé ouvre l'écran du même geste :
   * autrement le droit serait accordé et invisible.
   */
  const toggleAction = (pageKey: string, id: string) => {
    const key = actionKey(pageKey, id);
    if (actions.includes(key)) {
      setActions(actions.filter((a) => a !== key));
      return;
    }
    setActions([...actions, key]);
    if (!pageOn(pageKey)) setPages([...pages, pageKey]);
  };

  const toggleAllActions = (p: PermissionPage) => {
    const keys = p.actions.map((a) => actionKey(p.key, a.id));
    const allOn = keys.every((k) => actions.includes(k));
    if (allOn) {
      setActions(actions.filter((a) => !keys.includes(a)));
    } else {
      setActions([...new Set([...actions, ...keys])]);
      if (!pageOn(p.key)) setPages([...pages, p.key]);
    }
  };

  const grantEverything = () => {
    setPages(PERMISSION_PAGES.map((p) => p.key));
    setActions(PERMISSION_PAGES.flatMap((p) => p.actions.map((a) => actionKey(p.key, a.id))));
  };

  const revokeEverything = () => {
    setPages([]);
    setActions([]);
  };

  const totalActions = PERMISSION_PAGES.reduce((s, p) => s + p.actions.length, 0);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Droits d'accès — ${workerName(worker)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => onSave(pages, actions)} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Enregistrer les droits
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Ce que le travailleur verra, dit en une phrase avant de cocher. */}
        <div className="rounded-2xl border border-line bg-canvas/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-muted">
              Ce travailleur ne verra dans sa barre latérale que les écrans cochés à gauche, et
              sur chacun, que les boutons cochés à droite. Rien n&apos;est ouvert par défaut.
            </p>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={grantEverything}
                className="rounded-lg border border-line px-2.5 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary-50"
              >
                Tout autoriser
              </button>
              <button
                onClick={revokeEverything}
                className="rounded-lg border border-line px-2.5 py-1 text-[10px] font-bold text-danger transition-colors hover:bg-danger/10"
              >
                Tout retirer
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line/60 pt-2.5">
            <Badge tone={pages.length ? "primary" : "neutral"} className="font-mono text-[10px]">
              <Eye className="mr-1 inline h-3 w-3" />
              {pages.length}/{PERMISSION_PAGES.length} écran(s)
            </Badge>
            <Badge tone={actions.length ? "success" : "neutral"} className="font-mono text-[10px]">
              <MousePointerClick className="mr-1 inline h-3 w-3" />
              {actions.length}/{totalActions} bouton(s)
            </Badge>
            {pages.length === 0 && (
              <Badge tone="warning" className="text-[10px]">
                <Lock className="mr-1 inline h-3 w-3" />
                Il ne verra que le bouton « Déconnexion »
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          {/* ---- Colonne 1 : la barre latérale telle qu'il la verra --------- */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="border-b border-line bg-canvas px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted">
              Sa barre latérale
            </div>
            <div className="max-h-[26rem] overflow-y-auto p-1.5">
              {PERMISSION_PAGES.map((p) => {
                const on = pageOn(p.key);
                const n = countOn(p);
                return (
                  <div
                    key={p.key}
                    className={`mb-1 flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${
                      focused === p.key ? "bg-primary-50 ring-1 ring-primary/25" : "hover:bg-canvas/60"
                    }`}
                  >
                    <button
                      onClick={() => togglePage(p.key)}
                      title={on ? "Retirer cet écran" : "Ouvrir cet écran"}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        on
                          ? "border-primary bg-primary text-white"
                          : "border-line bg-surface text-transparent hover:border-primary/50"
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setFocused(p.key)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-start"
                    >
                      <span className="text-base leading-none">{p.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-xs font-semibold ${
                            on ? "text-ink" : "text-muted"
                          }`}
                        >
                          {p.label}
                        </span>
                        <span className="block text-[9px] font-bold uppercase tracking-wide text-muted">
                          {n}/{p.actions.length} bouton(s)
                        </span>
                      </span>
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 ${
                          focused === p.key ? "text-primary" : "text-muted/50"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- Colonne 2 : les boutons de l'écran sélectionné ------------- */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas px-3 py-2">
              <div className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
                  <span className="text-base leading-none">{page.emoji}</span>
                  {page.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted">{page.hint}</span>
              </div>
              {page.actions.length > 0 && (
                <button
                  onClick={() => toggleAllActions(page)}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary-50"
                >
                  {page.actions.every((a) => actionOn(page.key, a.id))
                    ? "Tout décocher"
                    : "Tout cocher"}
                </button>
              )}
            </div>

            {!pageOn(page.key) && (
              <div className="border-b border-warning/25 bg-warning/5 px-3 py-2 text-[10px] leading-relaxed text-warning">
                Cet écran n&apos;est pas dans sa barre latérale. Cocher un bouton ci-dessous
                l&apos;y ajoutera automatiquement — sans quoi le droit serait accordé et
                invisible.
              </div>
            )}

            <div className="max-h-[24rem] overflow-y-auto p-2">
              {/* Certains écrans se consultent sans rien écrire : cocher
                  l'écran suffit, il n'y a aucun bouton à ouvrir. */}
              {page.actions.length === 0 && (
                <p className="py-6 text-center text-[11px] italic text-muted">
                  Cet écran n&apos;a aucun bouton d&apos;action : le cocher à gauche suffit à le
                  rendre consultable.
                </p>
              )}
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {page.actions.map((a) => {
                  const on = actionOn(page.key, a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAction(page.key, a.id)}
                      className={`flex items-start gap-2 rounded-xl border p-2.5 text-start transition-colors ${
                        on
                          ? "border-success/40 bg-success/5"
                          : "border-line bg-canvas/30 hover:border-primary/30 hover:bg-primary-50/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          on
                            ? "border-success bg-success text-white"
                            : "border-line bg-surface text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[11px] font-bold ${on ? "text-ink" : "text-muted"}`}>
                          {a.label}
                        </span>
                        {a.hint && (
                          <span className="mt-0.5 block text-[9px] leading-snug text-muted">
                            {a.hint}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
