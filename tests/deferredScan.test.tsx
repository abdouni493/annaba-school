// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { create } from "zustand";
const mocks = vi.hoisted(() => ({ scan: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/useScanProcessor", () => ({ useScanProcessor: () => mocks.scan }));
vi.mock("@/lib/speech", () => ({ preloadSpeech: () => {} }));
vi.mock("@/lib/store/toast", () => ({ useToast: () => ({ toasts: [], removeToast: () => {} }) }));
vi.mock("@/lib/store/data", () => ({ useData: create(() => ({ loaded: false, revalidating: false })) }));
vi.mock("@/lib/store/session", () => ({ useSession: create(() => ({ user: { id: "desk-a" } })) }));
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { useDeferredScan } from "@/lib/store/deferredScan";
import { GlobalRFIDListener } from "@/components/controls/GlobalRFIDListener";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); useDeferredScan.setState({ account: null, codes: [] });
  useData.setState({ loaded: false, revalidating: false }); useSession.setState({ user: { id: "desk-a" } } as never);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<GlobalRFIDListener />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const swipe = async (code: string) => act(async () => {
  for (const key of [...code, "Enter"]) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
});
it("a card outside the directory page is queued, not reported missing, and processed once after complete boot", async () => {
  await swipe("RFID-outside-page"); await swipe("RFID-second");
  expect(mocks.scan).not.toHaveBeenCalled(); expect(mocks.push).toHaveBeenCalledWith("/students");
  await act(async () => useData.setState({ loaded: true, revalidating: true }));
  expect(mocks.scan).not.toHaveBeenCalled();
  await act(async () => useData.setState({ revalidating: false }));
  expect(mocks.scan.mock.calls.map((c) => c[0])).toEqual(["RFID-outside-page", "RFID-second"]);
  expect(useDeferredScan.getState().codes).toEqual([]);
});
it("never replays another account's card", async () => {
  await swipe("RFID-private");
  await act(async () => useSession.setState({ user: { id: "desk-b" } } as never));
  await act(async () => useData.setState({ loaded: true }));
  expect(mocks.scan).not.toHaveBeenCalled();
});
