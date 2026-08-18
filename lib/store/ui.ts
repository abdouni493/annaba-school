"use client";

import { create } from "zustand";

/**
 * A one-shot "quick action" intent set by the dashboard buttons. The dashboard
 * sets an intent and navigates (client-side) to the target page; that page, on
 * mount, opens the matching create modal and clears the intent. The store is
 * in-memory and survives client navigation (only a hard reload clears it).
 */
export type QuickIntent =
  | null
  | "student-create"
  | "timing-create"
  | "subscription-create"
  | "expense-create"
  | "teacher-pay";

interface UiState {
  intent: QuickIntent;
  setIntent: (intent: QuickIntent) => void;
  /** Reads the intent and clears it if it matches — returns whether it did. */
  consume: (intent: QuickIntent) => boolean;
}

export const useUiIntent = create<UiState>((set, get) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  consume: (intent) => {
    if (get().intent !== intent) return false;
    set({ intent: null });
    return true;
  },
}));
