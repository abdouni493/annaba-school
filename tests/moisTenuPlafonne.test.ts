import { it, expect } from "vitest";
import { useData } from "@/lib/store/data";
import { buildSeed } from "@/tests/fixtures/seed";
import { teacherEmplois } from "@/lib/teacherMonths";
import { monthTiles } from "@/lib/teacherPayBoard";

/**
 * « 6/4 » SUR UN MOIS DE 4 SÉANCES.
 *
 * Chaque élève a SON mois : celui qui vit encore son M1 pendant que le groupe
 * est en M2 (inscrit avant que les points d'entrée n'existent, ou qui
 * rattrape) ajoutait ses dates à celles du groupe. Un mois ne tient jamais
 * plus de séances que son pack.
 */
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

it("un mois de 4 séances n'affiche jamais plus de 4 séances tenues", async () => {
  const db = buildSeed();
  db.subscriptions.find((s) => s.id === "sub-1")!.monthlySeances = 4;
  db.attendance = db.attendance.filter((a) => a.sessionId !== "ses-1");
  db.unpaidTeacher = db.unpaidTeacher.filter((u) => u.sessionId !== "ses-1");
  useData.setState(db);
  const session = useData.getState().sessions.find((s) => s.id === "ses-1")!;
  const days: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 90);
  while (days.length < 7) {
    if (session.days.includes(DAY_KEYS[d.getDay()] as never)) days.push(d.toLocaleDateString("fr-CA"));
    d.setDate(d.getDate() + 1);
  }
  const mark = (studentId: string, date: string) =>
    useData.getState().setPresence({ studentId, sessionId: "ses-1", date, status: "present" });
  // stu-1 suit les 7 séances (M1 puis M2) ; stu-4 n'arrive qu'à la 5e, sans
  // point d'entrée : son M1 tombe sur les dates du M2 du groupe.
  for (const day of days) await mark("stu-1", day);
  useData.setState((s) => ({
    students: s.students.map((st) =>
      st.id === "stu-4"
        ? { ...st, subscriptionIds: [...new Set([...st.subscriptionIds, "sub-1"])], subscriptionDates: { ...st.subscriptionDates, "sub-1": { subscribedAt: days[4], startDate: days[4] } } }
        : st,
    ),
  }));
  for (const day of days.slice(4)) await mark("stu-4", day);

  const emploi = teacherEmplois(useData.getState(), "tea-1").find((e) => e.sessionId === "ses-1")!;
  expect(emploi.months[0].held).toBe(4);
  expect(emploi.months[1].held).toBe(3);
  const tiles = monthTiles(useData.getState(), emploi, "tea-1");
  expect(tiles[0].held).toBeLessThanOrEqual(tiles[0].size);
});
