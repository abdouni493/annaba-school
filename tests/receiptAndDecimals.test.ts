import { describe, it, expect } from "vitest";
import { buildSeed } from "@/tests/fixtures/seed";
import { inscriptionVoucherHtml, soldReceiptHtml } from "@/lib/reports/documents";
import { formatAmountVar } from "@/lib/whatsapp/templates";
import { groupSeanceTotals } from "@/lib/helpers";

/**
 * DEUX RÈGLES DE PAPIER, TENUES ICI.
 *
 * 1. LES MONTANTS IMPRIMÉS GARDENT LEURS DÉCIMALES. Un mois de 3 500 DA sur 8
 *    séances vaut 437,50 DA la séance. Les documents arrondissaient à l'entier
 *    (438 DA) : le papier remis à la famille ne disait pas la même chose que
 *    l'écran, et l'addition des lignes cessait d'égaler le total.
 *
 * 2. LE REÇU DE PAIEMENT NE DIT QUE CE QUI A ÉTÉ VERSÉ. Il ne porte plus aucun
 *    solde d'emploi du temps : un solde n'est vrai qu'à l'instant où il est
 *    imprimé, et deux exemplaires du même reçu finissaient par se contredire.
 */

/** `toLocaleString` sépare les milliers par une espace insécable étroite : on
 *  ramène toutes les espaces à l'espace ordinaire avant de comparer. */
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("les montants imprimés gardent leurs décimales", () => {
  it("écrit 437,50 DA sur le bon d'inscription, pas 438 DA", () => {
    const db = buildSeed();
    const html = inscriptionVoucherHtml(db, {
      student: db.students[0],
      language: "fr",
      lines: [
        { label: "عبادي", monthSeances: 8, unitPrice: 437.5, sold: 875, monthCode: "M1" },
      ],
    });
    expect(html).toContain("437,50");
    expect(html).not.toContain("438 DA");
  });

  it("laisse un compte rond sans décimales inutiles", () => {
    const db = buildSeed();
    const html = inscriptionVoucherHtml(db, {
      student: db.students[0],
      language: "fr",
      lines: [{ label: "عبادي", monthSeances: 4, unitPrice: 1500, sold: 6000, monthCode: "M1" }],
    });
    expect(norm(html)).toContain("1 500 DA");
    expect(norm(html)).not.toContain("1 500,00");
  });

  it("garde la virgule dans les messages envoyés à la famille", () => {
    expect(formatAmountVar(437.5)).toBe("437,50 DA");
    expect(formatAmountVar(4000)).toBe("4 000 DA");
  });

  it("ne perd pas les centimes sur une séance de groupe", () => {
    // 3 élèves à 437,50 DA : 1 312,50 — et non 1 314 (3 × 438).
    const totals = groupSeanceTotals({
      studentsCount: 3,
      pricePerStudent: 437.5,
      schoolPerStudent: 162.5,
    });
    expect(totals.pricePerStudent).toBe(437.5);
    expect(totals.schoolPerStudent).toBe(162.5);
    expect(totals.teacherPerStudent).toBe(275);
    expect(totals.total).toBe(1312.5);
    expect(totals.schoolTotal).toBe(487.5);
    expect(totals.teacherTotal).toBe(825);
  });
});

describe("le reçu de paiement ne parle que du montant versé", () => {
  const receipt = (language: "fr" | "ar") => {
    const db = buildSeed();
    return soldReceiptHtml(db, {
      student: db.students[0],
      language,
      title: "Reçu de paiement",
      lines: [{ label: "عبادي", monthCode: "M1", amount: 437.5 }],
    });
  };

  it("affiche bien ce que l'élève a versé, décimales comprises", () => {
    expect(receipt("fr")).toContain("437,50");
  });

  it("ne mentionne AUCUN solde d'emploi du temps", () => {
    expect(receipt("fr")).not.toContain("Nouveau solde");
    expect(receipt("ar")).not.toContain("الرصيد الجديد");
  });
});
