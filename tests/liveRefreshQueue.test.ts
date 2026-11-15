import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  read: vi.fn(), absorb: vi.fn(() => 0),
  state: { loaded: true, revalidating: false, attendance: [] },
  idle: true,
}));
vi.mock("@/lib/store/data", () => ({
  useData: { getState: () => mock.state }, absorbServerRows: mock.absorb,
}));
vi.mock("@/lib/supabase/load", () => ({
  loadRowsWhere: mock.read, LoadCancelledError: class extends Error {},
}));
vi.mock("@/lib/supabase/sync", () => ({
  absorbExternal: (f: () => void) => f(), syncIdle: () => mock.idle,
  syncRunning: () => true, syncSettled: async () => {},
}));
import {
  refreshRecentAttendance, refreshSessionAttendance, refreshActiveAttendance,
  resetAttendanceRefresh, watchAttendance,
} from "@/lib/supabase/liveRefresh";
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; }
beforeEach(() => {
  resetAttendanceRefresh(); vi.clearAllMocks();
  mock.state.loaded = true; mock.state.revalidating = false; mock.idle = true;
  mock.absorb.mockImplementation(() => 0); mock.read.mockResolvedValue([]);
});
describe("live reader queue", () => {
  it("two eligible successive polls both reach the reader", async () => {
    await refreshRecentAttendance(); await refreshRecentAttendance();
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it("a failed reader releases the queue for the second eligible poll", async () => {
    mock.read.mockRejectedValueOnce(new Error("offline"));
    expect((await refreshRecentAttendance()).ok).toBe(false);
    expect((await refreshRecentAttendance()).ok).toBe(true);
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it("a rejected task also releases its queue entry", async () => {
    mock.absorb.mockImplementationOnce(() => { throw new Error("adoption failed"); });
    await expect(refreshRecentAttendance()).rejects.toThrow("adoption failed");
    await refreshRecentAttendance(); expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it("queues distinct sessions, coalesces the same scope, and a poll during a read does not clear the newer entry", async () => {
    const first = deferred<never[]>(); const second = deferred<never[]>();
    mock.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = refreshSessionAttendance("s1", true, "2026-11-13");
    const b = refreshSessionAttendance("s2", true, "2026-11-13");
    expect(refreshSessionAttendance("s2", true, "2026-11-13")).toBe(b);
    await tick(); expect(mock.read).toHaveBeenCalledTimes(1);
    await refreshRecentAttendance(); expect(mock.read).toHaveBeenCalledTimes(1);
    first.resolve([]); await a; await tick();
    expect(mock.read).toHaveBeenCalledTimes(2);
    await refreshRecentAttendance(); expect(mock.read).toHaveBeenCalledTimes(2);
    second.resolve([]); await b; await refreshRecentAttendance();
    expect(mock.read).toHaveBeenCalledTimes(3);
  });
  it("reads a half-open day and the chosen session, never unlimited history", async () => {
    await refreshSessionAttendance("s1", true, "2026-11-13");
    const where = mock.read.mock.calls[0][1];
    expect(where).toContainEqual({ column: "session_id", op: "eq", value: "s1" });
    expect(where.map((f: { op: string }) => f.op)).toEqual(["gte", "lt", "eq"]);
  });
  it("focus/reconnect refresh only mounted scopes and coalesce redundant session interests", async () => {
    const stopDay = watchAttendance("2026-11-13");
    const stopSheet = watchAttendance("2026-11-13", "s1");
    await refreshActiveAttendance(); await refreshActiveAttendance();
    expect(mock.read).toHaveBeenCalledTimes(2);
    stopDay(); await refreshActiveAttendance();
    expect(mock.read.mock.calls[2][1]).toContainEqual({ column: "session_id", op: "eq", value: "s1" });
    stopSheet(); await refreshActiveAttendance(); expect(mock.read).toHaveBeenCalledTimes(3);
  });
  it("never overwrites a pending write or waits for global revalidation", async () => {
    mock.idle = false;
    expect((await refreshRecentAttendance()).ok).toBe(false);
    expect(mock.read).not.toHaveBeenCalled();
    mock.idle = true; mock.state.revalidating = true;
    expect((await refreshRecentAttendance()).ok).toBe(false);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("account reset cancels an old completion without clearing a new account queue", async () => {
    const old = deferred<never[]>(); const next = deferred<never[]>();
    mock.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const a = refreshRecentAttendance(); await tick();
    resetAttendanceRefresh(); const b = refreshRecentAttendance(); await tick();
    old.resolve([]); expect((await a).ok).toBe(false);
    await refreshRecentAttendance(); expect(mock.read).toHaveBeenCalledTimes(2);
    next.resolve([]); await b; expect(mock.absorb).toHaveBeenCalledTimes(1);
    await refreshRecentAttendance(); expect(mock.read).toHaveBeenCalledTimes(3);
  });
});
