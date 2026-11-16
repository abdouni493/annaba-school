import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ calls: [] as { method: string; args: unknown[] }[],
  rows: [] as Record<string, unknown>[], error: null as null | { message: string }, signal: undefined as AbortSignal | undefined }));
vi.mock("@/lib/supabase/client", () => ({ supabase: () => ({ from: (table: string) => {
  mock.calls.push({ method: "from", args: [table] });
  let size = 1000;
  let student = "";
  const query = {
    select: (...args: unknown[]) => { mock.calls.push({ method: "select", args }); return query; },
    eq: (column: string, value: string) => { student = value; mock.calls.push({ method: "eq", args: [column, value] }); return query; },
    order: (...args: unknown[]) => { mock.calls.push({ method: "order", args }); return query; },
    limit: (limit: number) => { size = limit; mock.calls.push({ method: "limit", args: [limit] }); return query; },
    abortSignal: (signal: AbortSignal) => { mock.signal = signal; return query; },
    or: (...args: unknown[]) => { mock.calls.push({ method: "or", args }); return query; },
    then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({
      data: mock.rows.filter((r) => r.student_id === student).slice(0, size), error: mock.error,
    })),
  };
  return query;
} }) }));
import { getStudentLedgerPage } from "@/lib/repo/studentLedger";

beforeEach(() => { mock.calls = []; mock.rows = []; mock.error = null; mock.signal = undefined; });
describe("isolated bounded detail reads (not enabled in legacy UI)", () => {
  it.each([1000, 10000])("unrelated %i-row history does not increase returned rows", async (history) => {
    mock.rows = Array.from({ length: history }, (_, i) => ({ id: `old-${i}`, student_id: "other" }));
    mock.rows.push(...Array.from({ length: 60 }, (_, i) => ({ id: `p-${i}`, student_id: "selected", date: "2026-11-01", amount_paid: 100 })));
    const result = await getStudentLedgerPage("payments", "selected");
    expect(result.items).toHaveLength(50);
    expect(result.scope).toEqual({ studentId: "selected", kind: "payments" });
    expect(result.items.every((r) => r.studentId === "selected" && r.amountPaid === 100)).toBe(true);
    expect(result.nextCursor).toEqual({ date: "2026-11-01", id: "p-49" });
    expect(mock.calls.filter((c) => c.method === "from")).toHaveLength(1);
    expect(mock.calls.find((c) => c.method === "limit")?.args).toEqual([51]);
    expect(mock.calls.find((c) => c.method === "eq")?.args).toEqual(["student_id", "selected"]);
  });
  it.each(["payments", "attendance", "studentCharges"] as const)("requires a student scope and bounds %s", async (kind) => {
    await expect(getStudentLedgerPage(kind, " ")).rejects.toThrow("scope");
    expect(mock.calls).toHaveLength(0);
    await getStudentLedgerPage(kind, "selected", { pageSize: 10000, cursor: { date: 'd,"', id: 'x)"' } });
    expect(mock.calls.find((c) => c.method === "limit")?.args).toEqual([101]);
    expect(mock.calls.filter((c) => c.method === "order")).toHaveLength(2);
    expect(mock.calls.find((c) => c.method === "or")?.args[0]).toContain('\\"');
  });
  it("does not treat missing tables, denied reads, or cancellation as an empty ledger", async () => {
    mock.error = { message: "permission denied" };
    await expect(getStudentLedgerPage("payments", "selected")).rejects.toThrow("permission denied");
    mock.error = { message: "table missing" };
    await expect(getStudentLedgerPage("attendance", "selected")).rejects.toThrow("table missing");
    mock.error = null;
    const controller = new AbortController(); controller.abort();
    await expect(getStudentLedgerPage("studentCharges", "selected", { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(mock.signal?.aborted).toBe(true);
  });
});
