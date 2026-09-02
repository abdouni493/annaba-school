"use client";

/**
 * IMPRIMER LE REÇU D'UN ANCIEN VERSEMENT — depuis le tableau de bord.
 *
 * La réception cherche l'élève (nom, prénom, téléphone, e-mail ou numéro
 * d'inscription), le choisit, et lit alors TOUT son historique de versements,
 * du plus récent au plus ancien. Un clic réimprime le reçu de l'un d'eux — le
 * papier de l'école, celui-là même qui sort au moment de l'encaissement, mais
 * qui ne dit ici que CE QUE L'ÉLÈVE A VERSÉ ce jour-là (pas de solde du jour).
 */

import { useMemo, useState } from "react";
import { ArrowLeft, Hash, Phone, Printer, Receipt, Search, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import {
  enrollmentLabel,
  registrationNumberOf,
  studentMatches,
  studentName,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { paymentReceiptHtml } from "@/lib/reports/documents";
import type { Payment, Student } from "@/lib/types";

/** Combien de fiches on propose au plus : au-delà, on affine la recherche. */
const MAX_RESULTS = 40;

export function StudentPaymentsPrintModal({ onClose }: { onClose: () => void }) {
  const db = useData();
  const { language } = useSettings();
  const { addToast } = useToast();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);

  // Les élèves qui répondent à la recherche : nom, prénom, téléphone, second
  // téléphone, numéro d'inscription — et l'e-mail, comme sur l'écran Élèves.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Student[];
    return db.students
      .filter(
        (s) =>
          studentMatches(db, s, query) || (s.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, db.students]);

  // Tout l'historique du versement, du plus récent au plus ancien.
  const payments = useMemo(
    () =>
      selected
        ? db.payments
            .filter((p) => p.studentId === selected.id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
    [selected, db.payments],
  );

  const printReceipt = (p: Payment) => {
    try {
      printHtmlDocument(paymentReceiptHtml(db, { payment: p, language }));
    } catch {
      addToast({
        type: "danger",
        title: "Impression impossible",
        message: "Ce versement ne porte sur aucun élève connu.",
      });
    }
  };

  const labelOf = (p: Payment): string => {
    if (p.type === "debt_payment") return p.description || "Règlement de dette";
    const enr = db.enrollments.find((e) => e.id === p.enrollmentId);
    return enr ? enrollmentLabel(db, enr) : p.description || "Versement";
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Imprimer un ancien paiement"
    >
      {!selected ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Cherchez l&apos;élève par nom, prénom, téléphone, e-mail ou numéro d&apos;inscription,
            puis choisissez-le pour voir tous ses versements.
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom, téléphone, e-mail, N° d'inscription…"
              className="pl-9"
            />
          </div>

          {query.trim().length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Tapez quelque chose pour rechercher un élève.
            </p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Aucun élève ne correspond à cette recherche.
            </p>
          ) : (
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
              {results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-canvas/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary-50/40"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary">
                      <User className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm text-ink">
                        {studentName(s)}
                      </strong>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Hash className="h-2.5 w-2.5" />
                          {registrationNumberOf(db, s)}
                        </span>
                        {s.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-2.5 w-2.5" />
                            {s.phone}
                          </span>
                        )}
                      </span>
                    </span>
                  </span>
                  <Badge tone="neutral" className="shrink-0 text-[10px]">
                    {db.payments.filter((p) => p.studentId === s.id).length} versement(s)
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-primary-50 hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Changer d&apos;élève
            </button>
            <span className="flex flex-col items-end">
              <strong className="text-sm text-ink">{studentName(selected)}</strong>
              <span className="font-mono text-[10px] text-muted">
                N° {registrationNumberOf(db, selected)}
              </span>
            </span>
          </div>

          <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
            {payments.length === 0 ? (
              <p className="py-8 text-center text-xs italic text-muted">
                Cet élève n&apos;a aucun versement enregistré.
              </p>
            ) : (
              payments.map((p) => {
                const isDebt = p.type === "debt_payment";
                return (
                  <div
                    key={p.id}
                    className="flex items-start justify-between gap-2 rounded-xl border border-line bg-canvas/40 p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <strong className="flex items-center gap-1.5 text-ink">
                        <Badge tone={isDebt ? "success" : "primary"} className="px-1.5 py-0 text-[9px]">
                          {isDebt ? "Règlement de dette" : "Achat de séances"}
                        </Badge>
                        <span className="truncate">{labelOf(p)}</span>
                      </strong>
                      <span className="text-[10px] text-muted">
                        {p.date.substring(0, 16).replace("T", " ")}
                        {p.monthCode ? ` · ${p.monthCode}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <strong className="font-bold text-success">+{formatDA(p.amountPaid)}</strong>
                      <button
                        onClick={() => printReceipt(p)}
                        title="Imprimer le reçu de ce paiement"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-primary transition-colors hover:bg-primary-50"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <p className="flex items-center gap-1.5 border-t border-line pt-3 text-[10px] text-muted">
            <Receipt className="h-3.5 w-3.5" /> Le reçu réimprimé ne montre que le montant versé ce
            jour-là, jamais un solde.
          </p>
        </div>
      )}
    </Modal>
  );
}
