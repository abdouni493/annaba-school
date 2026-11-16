import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ students: vi.fn(), attendance: vi.fn(), cash: vi.fn() }));
vi.mock("@/components/pages/StudentsPage", () => { mocks.students(); return { StudentsPage: () => null }; });
vi.mock("@/components/pages/AttendancePage", () => { mocks.attendance(); return { AttendancePage: () => null }; });
vi.mock("@/components/pages/CashPage", () => { mocks.cash(); return { CashPage: () => null }; });
import { accessRightsOf } from "@/lib/permissions";

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
it("loads only the allowed screen on intent and coalesces repeated hints", async () => {
  const { prefetchStaffModule } = await import("@/lib/staffModuleIntent");
  const rights = accessRightsOf({ id: "admin", role: "admin" } as never, []);
  const first = prefetchStaffModule("/students", "admin", rights);
  expect(prefetchStaffModule("/students", "admin", rights)).toBe(first);
  await first;
  await prefetchStaffModule("/students", "admin", rights);
  expect(mocks.students).toHaveBeenCalledTimes(1);
  expect(mocks.attendance).not.toHaveBeenCalled();
  expect(mocks.cash).not.toHaveBeenCalled();
});
it("does not load staff modules for portals, denied pages, or unknown routes", async () => {
  const { prefetchStaffModule } = await import("@/lib/staffModuleIntent");
  const rights = accessRightsOf({ id: "desk", role: "reception" } as never, [{ id: "desk", navKeys: ["cash"], actionKeys: [] }] as never);
  expect(prefetchStaffModule("/students", "reception", rights)).toBeUndefined();
  expect(prefetchStaffModule("/cash", "student", rights)).toBeUndefined();
  expect(prefetchStaffModule("/other", "reception", rights)).toBeUndefined();
  expect(prefetchStaffModule("/constructor", "admin", accessRightsOf({ role: "admin" } as never, []))).toBeUndefined();
  expect(mocks.students).not.toHaveBeenCalled();
  expect(mocks.attendance).not.toHaveBeenCalled();
  expect(mocks.cash).not.toHaveBeenCalled();
});
