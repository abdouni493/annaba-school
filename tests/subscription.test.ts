import { describe, it, expect } from "vitest";
import {
  addDays,
  hasMonthlyPlan,
  lostSeances,
  monthlyExpiry,
  monthlyPriceOf,
  monthlySeancesValue,
  remainingSeances,
} from "@/lib/helpers";
import type { Enrollment, Subscription } from "@/lib/types";

const sub = (fields: Partial<Subscription>): Subscription => ({
  id: "sub-x",
  sessionId: "ses-x",
  pricePerSession: 500,
  ...fields,
});

const enrollment = (fields: Partial<Enrollment>): Enrollment => ({
  id: "enr-x",
  studentId: "stu-x",
  subscriptionId: "sub-x",
  paidSeances: 8,
  consumedSeances: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...fields,
});

/** A YYYY-MM-DD key N days away from today, to build past/future expiries. */
const fromToday = (days: number) => addDays(new Date().toLocaleDateString("fr-CA"), days);

describe("monthlyExpiry — un mois, jamais un jour de plus", () => {
  it("un mois commencé le 16/08 court jusqu'au 15/09 inclus", () => {
    expect(monthlyExpiry("2026-08-16")).toBe("2026-09-15");
  });

  it("fin de mois court : le 31/01 tombe sur le 27/02 (février tronqué)", () => {
    expect(monthlyExpiry("2026-01-31")).toBe("2026-02-27");
  });

  it("plusieurs mois d'affilée", () => {
    expect(monthlyExpiry("2026-08-16", 3)).toBe("2026-11-15");
  });
});

describe("formule mensuelle du tarif", () => {
  it("absente tant qu'aucune séance n'est comprise dans le mois", () => {
    expect(hasMonthlyPlan(sub({}))).toBe(false);
    expect(hasMonthlyPlan(sub({ monthlySeances: 0 }))).toBe(false);
    expect(hasMonthlyPlan(sub({ monthlySeances: 8 }))).toBe(true);
  });

  it("prix du mois par défaut = séances × prix d'une séance", () => {
    expect(monthlyPriceOf(sub({ monthlySeances: 8 }))).toBe(4000);
  });

  it("le prix saisi par l'école l'emporte sur le total calculé", () => {
    const tariff = sub({ monthlySeances: 8, monthlyPrice: 3500 });
    expect(monthlyPriceOf(tariff)).toBe(3500);
    expect(monthlySeancesValue(tariff)).toBe(4000);
  });
});

describe("expiration d'une inscription au mois", () => {
  it("les séances restent disponibles pendant le mois", () => {
    expect(remainingSeances(enrollment({ expiryDate: fromToday(5) }))).toBe(5);
    expect(lostSeances(enrollment({ expiryDate: fromToday(5) }))).toBe(0);
  });

  it("le jour de l'expiration compte encore", () => {
    expect(remainingSeances(enrollment({ expiryDate: fromToday(0) }))).toBe(5);
  });

  it("le mois écoulé emporte les séances non consommées", () => {
    const expired = enrollment({ expiryDate: fromToday(-1) });
    expect(remainingSeances(expired)).toBe(0);
    expect(lostSeances(expired)).toBe(5);
  });

  it("une inscription sans échéance ne périme jamais", () => {
    expect(remainingSeances(enrollment({}))).toBe(5);
    expect(lostSeances(enrollment({}))).toBe(0);
  });
});
