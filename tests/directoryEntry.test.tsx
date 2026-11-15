// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
const mocks = vi.hoisted(() => ({
  path: "/students", boot: vi.fn(async () => ({ kind: "fresh" })),
  revalidate: vi.fn(async () => ({ kind: "fresh" })), clear: vi.fn(),
  writes: vi.fn(), school: vi.fn(), pending: false,
  query: vi.fn(), refresh: vi.fn(async () => []), jobs: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("@/lib/supabase/snapshotCache", () => ({ hasPendingSnapshot: async () => mocks.pending }));
vi.mock("@/lib/supabase/client", () => ({ supabase: () => ({ from: mocks.query }) }));
vi.mock("@/lib/supabase/liveRefresh", () => ({ refreshActiveAttendance: mocks.refresh, resetAttendanceRefresh: () => {} }));
vi.mock("@/lib/supabase/sync", () => ({
  pauseSync: () => {}, stopSync: () => {}, startSync: () => {},
  resumeSync: mocks.writes, resumeSyncFrom: mocks.writes,
}));
vi.mock("@/lib/store/data", () => ({
  setCurrentActor: () => {},
  useData: create(() => ({
    fetchSchool: mocks.school, boot: mocks.boot, revalidate: mocks.revalidate,
    clear: mocks.clear, processWeeklyAbsences: mocks.jobs, dropVoidTeacherDues: mocks.jobs,
    loaded: true, revalidating: false, offline: false, staleTables: [],
  })),
}));
vi.mock("@/lib/store/session", () => ({ useSession: create(() => ({
  user: { id: "desk-a", role: "reception", entityId: "worker-a" }, hydrated: true, initSession: () => {},
})) }));
import { SessionProvider } from "@/components/providers/SessionProvider";
import { useDirectoryAccess } from "@/lib/repo/studentDirectory";
import { useSession } from "@/lib/store/session";
let root: Root; let host: HTMLDivElement;
const render = async () => act(async () => { root.render(<SessionProvider><p>Screen</p></SessionProvider>); });
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.path = "/students"; mocks.pending = false; vi.clearAllMocks();
  useSession.setState({ user: { id: "desk-a", role: "reception", entityId: "worker-a" } } as never);
  mocks.query.mockImplementation(() => {
    const q = { select: () => q, in: () => q, abortSignal: async () => ({
      data: [{ id: "worker-a", nav_keys: ["students"], action_keys: ["students:view"] }], error: null,
    }) }; return q;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("real SessionProvider entry path", () => {
  it("direct Students entry loads only worker permissions, no full boot, no maintenance, no mirror", async () => {
    await render();
    expect(mocks.boot).not.toHaveBeenCalled(); expect(mocks.jobs).not.toHaveBeenCalled();
    expect(mocks.writes).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map((c) => c[0])).toEqual(["reception_staff"]);
    expect(useDirectoryAccess.getState().rights?.pages).toEqual(["students"]);
  });
  it("preserves the normal landing page and full legacy workflows on navigation", async () => {
    await render(); mocks.path = "/dashboard"; await render();
    expect(mocks.boot).toHaveBeenCalledTimes(1);
    mocks.path = "/students"; await render();
    expect(mocks.boot).toHaveBeenCalledTimes(1);
  });
  it("automatically replays an existing dirty offline snapshot through legacy boot", async () => {
    mocks.pending = true; await render(); expect(mocks.boot).toHaveBeenCalledWith("worker-a");
  });
  it("four-minute return and reconnect refresh scopes, not the database", async () => {
    mocks.path = "/dashboard"; await render(); mocks.revalidate.mockClear();
    await act(async () => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("switches accounts without adopting old worker permissions", async () => {
    await render();
    await act(async () => useSession.setState({ user: { id: "desk-b", role: "admin" } } as never));
    expect(useDirectoryAccess.getState().account).toBe("desk-b");
    expect(useDirectoryAccess.getState().rights?.unrestricted).toBe(true);
  });
});
