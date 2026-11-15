"use client";
import { create } from "zustand";

/** A scan made in the directory waits for the legacy business workspace rather
 * than treating a student outside the current page as "not found". Memory only,
 * account scoped, and consumed once; never placed in the school snapshot. */
export const useDeferredScan = create<{ account: string | null; codes: string[] }>(() => ({ account: null, codes: [] }));
