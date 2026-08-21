import { describe, it, expect } from "vitest";
import {
  clashingDays,
  hasUniformSalles,
  sessionSalleIds,
  sessionSalleOn,
} from "@/lib/helpers";
import type { ScheduleSession } from "@/lib/types";

/**
 * Salle jour par jour.
 *
 * Un emploi du temps peut occuper une salle différente selon le jour — Samedi
 * en Salle A, Mardi en Salle B, et c'est toujours UN SEUL emploi du temps.
 * `salleId` reste la salle PAR DÉFAUT (celle du premier jour) et `daySalles`
 * porte les exceptions, si bien qu'un emploi dans la même salle toute la
 * semaine ne stocke rien de plus.
 */

const base = (over: Partial<ScheduleSession> = {}): ScheduleSession => ({
  id: "ses-x",
  classId: "cls-1",
  moduleId: "mod-1",
  groupId: "grp-1",
  salleId: "sal-A",
  teacherId: "tea-1",
  days: ["saturday", "tuesday"],
  startTime: "08:00",
  endTime: "10:00",
  ...over,
});

describe("la salle d'un jour donné", () => {
  it("retombe sur la salle par défaut quand le jour n'a pas d'exception", () => {
    const s = base();
    expect(sessionSalleOn(s, "saturday")).toBe("sal-A");
    expect(sessionSalleOn(s, "tuesday")).toBe("sal-A");
    expect(hasUniformSalles(s)).toBe(true);
    expect(sessionSalleIds(s)).toEqual(["sal-A"]);
  });

  it("rend la salle propre au jour quand il en a une", () => {
    const s = base({ daySalles: { tuesday: "sal-B" } });
    expect(sessionSalleOn(s, "saturday")).toBe("sal-A");
    expect(sessionSalleOn(s, "tuesday")).toBe("sal-B");
    expect(hasUniformSalles(s)).toBe(false);
    expect(sessionSalleIds(s).sort()).toEqual(["sal-A", "sal-B"]);
  });

  it("sans jour, rend la salle par défaut de l'emploi", () => {
    expect(sessionSalleOn(base({ daySalles: { tuesday: "sal-B" } }))).toBe("sal-A");
  });

  it("une séance libre garde ses salles multiples", () => {
    const s = base({ isOpen: true, salleIds: ["sal-A", "sal-C"] });
    expect(sessionSalleIds(s).sort()).toEqual(["sal-A", "sal-C"]);
  });
});

describe("les conflits de salle se lisent JOUR PAR JOUR", () => {
  /** L'emploi déjà en place : Samedi en Salle A, Mardi en Salle B. */
  const existing = base({
    id: "ses-1",
    salleId: "sal-A",
    daySalles: { saturday: "sal-A", tuesday: "sal-B" },
  });

  const draft = {
    days: ["saturday", "tuesday"] as ScheduleSession["days"],
    startTime: "09:00",
    endTime: "11:00",
  };

  it("la Salle A n'est prise que le samedi", () => {
    expect(clashingDays(draft, existing, "sal-A")).toEqual(["saturday"]);
  });

  it("la Salle B n'est prise que le mardi", () => {
    expect(clashingDays(draft, existing, "sal-B")).toEqual(["tuesday"]);
  });

  it("une salle qu'il n'occupe aucun jour reste entièrement libre", () => {
    expect(clashingDays(draft, existing, "sal-C")).toEqual([]);
  });

  it("sans salle précisée, tous les jours qui se chevauchent remontent", () => {
    expect(clashingDays(draft, existing)).toEqual(["saturday", "tuesday"]);
  });

  it("des créneaux qui se touchent ne sont pas un conflit", () => {
    const after = { ...draft, startTime: "10:00", endTime: "12:00" };
    expect(clashingDays(after, existing, "sal-A")).toEqual([]);
  });

  it("une séance libre occupe toutes ses salles tous ses jours", () => {
    const open = base({
      id: "ses-open",
      isOpen: true,
      salleIds: ["sal-A", "sal-B"],
      days: ["saturday"],
    });
    expect(clashingDays(draft, open, "sal-A")).toEqual(["saturday"]);
    expect(clashingDays(draft, open, "sal-B")).toEqual(["saturday"]);
  });
});
