import { describe, it, expect, beforeEach } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import {
  clashingDays,
  hasUniformTimes,
  minutesOf,
  sessionTimeLabel,
  sessionTimesOn,
  timesOverlap,
} from "@/lib/helpers";
import type { Day, ScheduleSession } from "@/lib/types";

/**
 * Horaires jour par jour.
 *
 * Un emploi du temps peut tourner à des heures différentes selon le jour —
 * Samedi 08:00 et Mardi 14:00 sur le même module. `startTime`/`endTime` restent
 * l'horaire PAR DÉFAUT et `dayTimes` porte les exceptions, si bien qu'un emploi
 * aux mêmes heures toute la semaine ne stocke rien de plus.
 */

const base = (over: Partial<ScheduleSession> = {}): ScheduleSession => ({
  id: "ses-x",
  classId: "cls-1",
  moduleId: "mod-1",
  groupId: "grp-1",
  salleId: "sal-1",
  teacherId: "tea-1",
  days: ["saturday", "tuesday"],
  startTime: "08:00",
  endTime: "10:00",
  ...over,
});

describe("horaire d'un jour donné", () => {
  it("retombe sur l'horaire par défaut quand le jour n'a pas d'exception", () => {
    const s = base();
    expect(sessionTimesOn(s, "saturday")).toEqual({ startTime: "08:00", endTime: "10:00" });
    expect(sessionTimesOn(s, "tuesday")).toEqual({ startTime: "08:00", endTime: "10:00" });
  });

  it("rend l'horaire propre au jour quand il en a un", () => {
    const s = base({ dayTimes: { tuesday: { startTime: "14:00", endTime: "16:00" } } });
    expect(sessionTimesOn(s, "saturday")).toEqual({ startTime: "08:00", endTime: "10:00" });
    expect(sessionTimesOn(s, "tuesday")).toEqual({ startTime: "14:00", endTime: "16:00" });
  });

  it("résume les horaires distincts d'un emploi", () => {
    expect(sessionTimeLabel(base())).toBe("08:00 – 10:00");
    expect(sessionTimeLabel(base({ dayTimes: { tuesday: { startTime: "14:00", endTime: "16:00" } } })))
      .toBe("08:00 – 10:00 · 14:00 – 16:00");
  });

  it("sait si l'emploi garde les mêmes heures toute la semaine", () => {
    expect(hasUniformTimes(base())).toBe(true);
    expect(hasUniformTimes(base({ dayTimes: { tuesday: { startTime: "14:00", endTime: "16:00" } } }))).toBe(false);
  });

  it("convertit une heure en minutes", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("")).toBe(0);
  });
});

describe("chevauchement de créneaux", () => {
  it("deux créneaux qui se recouvrent se chevauchent", () => {
    expect(
      timesOverlap({ startTime: "08:00", endTime: "10:00" }, { startTime: "09:00", endTime: "11:00" }),
    ).toBe(true);
  });

  it("deux créneaux qui se touchent ne se chevauchent PAS", () => {
    // La salle se libère à 10:00 : le cours suivant peut commencer à 10:00.
    expect(
      timesOverlap({ startTime: "08:00", endTime: "10:00" }, { startTime: "10:00", endTime: "12:00" }),
    ).toBe(false);
  });

  it("deux créneaux disjoints ne se chevauchent pas", () => {
    expect(
      timesOverlap({ startTime: "08:00", endTime: "10:00" }, { startTime: "14:00", endTime: "16:00" }),
    ).toBe(false);
  });
});

describe("conflit de salle", () => {
  const occupant = base({ id: "ses-a", days: ["saturday", "tuesday"], startTime: "08:00", endTime: "10:00" });

  it("signale le jour partagé où les heures se recouvrent", () => {
    const draft = { days: ["saturday"] as Day[], startTime: "09:00", endTime: "11:00" };
    expect(clashingDays(draft, occupant)).toEqual(["saturday"]);
  });

  it("ne signale rien quand les jours ne se croisent pas", () => {
    const draft = { days: ["monday"] as Day[], startTime: "08:00", endTime: "10:00" };
    expect(clashingDays(draft, occupant)).toEqual([]);
  });

  it("ne signale rien quand le même jour tourne à d'autres heures", () => {
    const draft = { days: ["saturday"] as Day[], startTime: "14:00", endTime: "16:00" };
    expect(clashingDays(draft, occupant)).toEqual([]);
  });

  it("compare jour par jour, pas sur l'horaire par défaut", () => {
    // L'occupant tourne Samedi 08:00 mais Mardi 14:00. Un projet Mardi 14:30
    // entre donc en conflit le Mardi seulement — jamais le Samedi.
    const withOverride = base({
      id: "ses-a",
      days: ["saturday", "tuesday"],
      startTime: "08:00",
      endTime: "10:00",
      dayTimes: { tuesday: { startTime: "14:00", endTime: "16:00" } },
    });
    const draft = { days: ["saturday", "tuesday"] as Day[], startTime: "14:30", endTime: "15:30" };
    expect(clashingDays(draft, withOverride)).toEqual(["tuesday"]);
  });

  it("compare aussi les exceptions du PROJET, pas seulement celles de l'occupant", () => {
    const draft = {
      days: ["saturday", "tuesday"] as Day[],
      startTime: "14:00",
      endTime: "16:00",
      dayTimes: { saturday: { startTime: "08:30", endTime: "09:30" } },
    };
    // Samedi le projet tombe dans le créneau 08:00–10:00 de l'occupant ; Mardi
    // il est à 14:00 alors que l'occupant y est à 08:00.
    expect(clashingDays(draft, occupant)).toEqual(["saturday"]);
  });
});

describe("le badge lit l'horaire du jour", () => {
  beforeEach(() => {
    useData.setState(buildSeed());
  });

  /** Today's weekday, as the store spells it. */
  const todayDow = (): Day => {
    const keys: Day[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return keys[new Date().getDay()];
  };

  /** A Date for today at HH:mm. */
  const at = (hh: number, mm = 0) => {
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  };

  it("accepte le badge à l'heure PROPRE au jour, pas à l'horaire par défaut", async () => {
    const dow = todayDow();
    // ses-1 tourne aujourd'hui 08:00–10:00 par défaut ; on le déplace à 06:00
    // pour aujourd'hui seulement, sur un créneau où stu-1 n'a rien d'autre.
    useData.setState((s) => ({
      attendance: [],
      sessions: s.sessions.map((x) =>
        x.id === "ses-1" ? { ...x, dayTimes: { [dow]: { startTime: "06:00", endTime: "07:00" } } } : x,
      ),
    }));

    const res = await useData.getState().scanCard("RFID-1001", at(6, 30));
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBe("ses-1");
    // Le toast annonce bien l'horaire du jour.
    expect(res.sessionStart).toBe("06:00");
    expect(res.sessionEnd).toBe("07:00");
  });

  it("refuse le badge à l'horaire par défaut quand le jour a été déplacé", async () => {
    const dow = todayDow();
    useData.setState((s) => ({
      attendance: [],
      sessions: s.sessions.map((x) =>
        x.id === "ses-1" ? { ...x, dayTimes: { [dow]: { startTime: "06:00", endTime: "07:00" } } } : x,
      ),
    }));

    // 08:30 : l'ancien créneau. Il ne tourne plus à cette heure aujourd'hui, donc
    // ses-1 ne peut pas être le créneau retenu.
    const res = await useData.getState().scanCard("RFID-1001", at(8, 30));
    expect(res.sessionId).not.toBe("ses-1");
  });
});
