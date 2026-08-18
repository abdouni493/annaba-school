"use client";

import { create } from "zustand";

export type Role = "admin" | "reception" | "student" | "teacher" | "parent";

export interface SessionUser {
  id: string;
  name: string;
  /** Kept for UI compatibility with existing pages; holds the account email. */
  username: string;
  email: string;
  role: Role;
  /** Links to the underlying Student/Teacher/Parent/ReceptionStaff row of the
   *  in-memory database (see `DEMO_ACCOUNTS`). */
  entityId?: string;
}

interface SessionState {
  user: SessionUser | null;
  hydrated: boolean;
  login: (user: SessionUser) => void;
  logout: () => Promise<void>;
  setHydrated: () => void;
  /** No auth backend in demo mode: this only flips `hydrated` so the AppShell
   *  guard stops waiting. Safe to call multiple times. */
  initSession: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  hydrated: false,

  login: (user) => set({ user, hydrated: true }),

  logout: async () => {
    set({ user: null });
  },

  setHydrated: () => set({ hydrated: true }),

  // The app always boots logged out: there is no session to restore.
  initSession: async () => {
    set({ hydrated: true });
  },
}));
