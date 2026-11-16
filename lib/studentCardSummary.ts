import type { Database } from "@/lib/store/data";
import {
  currentCycleIndex, isFreeSub, soldFor, soldStatus, studentChargeDebt,
  studentDebt, studentListPrice,
} from "@/lib/helpers";

/** Presentation values only. Never persisted, mirrored, or used as a ledger.
 * Reuses the business helpers, including departed groups and legacy balances.
 * The caller must supply a complete financial snapshot, not a page of history.
 */
export function studentCardSummaries(db: Database) {
  const subscriptions = new Map(db.subscriptions.map((sub) => [sub.id, sub]));
  return new Map(db.students.map((student) => {
    const sold = new Map<string, number>();
    const months = new Map<string, number>();
    let remaining = 0;
    let seancesLeft = 0;
    let soon = false;
    for (const id of student.subscriptionIds) {
      const balance = soldFor(db, student.id, id);
      const unit = studentListPrice(student, subscriptions.get(id));
      sold.set(id, balance);
      months.set(id, currentCycleIndex(db, student.id, id) + 1);
      remaining += balance;
      seancesLeft += unit > 0 ? Math.max(0, Math.floor(balance / unit)) : 0;
      if (!isFreeSub(student, id) && soldStatus(balance, unit) !== "ok") soon = true;
    }
    return [student.id, {
      debt: studentDebt(db, student.id), chargeDebt: studentChargeDebt(db, student.id),
      remaining, seancesLeft, soon, sold, months,
    }] as const;
  }));
}
