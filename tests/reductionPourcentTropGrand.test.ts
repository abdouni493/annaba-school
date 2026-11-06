import { describe, it, expect } from "vitest";
import { normalizeCaseReduction } from "@/lib/helpers";

describe("une remise en % au-delà de 100 % est un montant en DA", () => {
  it("bascule en montant fixe", () => {
    expect(normalizeCaseReduction({ type: "percent", schoolValue: 200, teacherValue: 500 })).toEqual({
      type: "amount",
      schoolValue: 200,
      teacherValue: 500,
    });
  });
  it("laisse un vrai pourcentage tel quel", () => {
    const r = { type: "percent" as const, schoolValue: 20, teacherValue: 10 };
    expect(normalizeCaseReduction(r)).toBe(r);
  });
});
