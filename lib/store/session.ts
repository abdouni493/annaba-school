"use client";

import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import { friendlyError, supabase } from "@/lib/supabase/client";

export type Role = "admin" | "reception" | "student" | "teacher" | "parent";

export interface SessionUser {
  id: string;
  name: string;
  /** The account's login name — the email when no username was recorded. */
  username: string;
  email: string;
  role: Role;
  /** Row this account owns in students / teachers / parents / reception_staff.
   *  Accounts created by the app use the auth id for both, so they match. */
  entityId?: string;
}

const ROLES: Role[] = ["admin", "reception", "student", "teacher", "parent"];

function asRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as string[]).includes(value) ? (value as Role) : null;
}

/**
 * Builds the session user from the auth account and its `profiles` row, which
 * is what carries the role. If the profile is unreadable (a row deleted by
 * hand, say) the role recorded on the account at sign-up is used instead.
 */
async function toSessionUser(user: User): Promise<SessionUser | null> {
  const { data: profile } = await supabase()
    .from("profiles")
    .select("role, full_name, username, email, entity_id")
    .eq("id", user.id)
    .maybeSingle();

  const meta = user.user_metadata ?? {};
  const role = asRole(profile?.role) ?? asRole(meta.role);
  if (!role) return null;

  const email = profile?.email ?? user.email ?? "";
  return {
    id: user.id,
    name: profile?.full_name || (meta.full_name as string) || email,
    username: profile?.username || (meta.username as string) || email,
    email,
    role,
    entityId: profile?.entity_id ?? user.id,
  };
}

interface SessionState {
  user: SessionUser | null;
  hydrated: boolean;
  /** Signs in with email + password. Resolves to the account on success. */
  signIn: (email: string, password: string) => Promise<SessionUser>;
  /** Patches the signed-in account (the portals let people rename themselves)
   *  and writes the change through to the `profiles` row. */
  updateUser: (fields: Partial<SessionUser>) => void;
  logout: () => Promise<void>;
  setHydrated: () => void;
  /** Restores the session saved in the browser, then keeps it in step with
   *  Supabase (token refresh, sign-out from another tab). */
  initSession: () => Promise<void>;
}

let watching = false;

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  hydrated: false,

  signIn: async (email, password) => {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.user) throw new Error(friendlyError(error ?? "Invalid login credentials"));

    const user = await toSessionUser(data.user);
    if (!user) {
      await supabase().auth.signOut();
      throw new Error("Ce compte n'a pas de rôle attribué. Contactez l'administration.");
    }
    set({ user, hydrated: true });
    return user;
  },

  updateUser: (fields) => {
    const current = get().user;
    if (!current) return;
    const next = { ...current, ...fields };
    set({ user: next });
    void supabase()
      .from("profiles")
      .update({ full_name: next.name, username: next.username, email: next.email })
      .eq("id", next.id)
      .then(({ error }) => {
        if (error) console.warn("[supabase] profile update", error.message);
      });
  },

  logout: async () => {
    await supabase().auth.signOut();
    set({ user: null });
  },

  setHydrated: () => set({ hydrated: true }),

  initSession: async () => {
    if (!watching) {
      watching = true;
      supabase().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session?.user) {
          if (get().user) set({ user: null });
          return;
        }
        // Only refresh the profile when the account actually changed; token
        // refreshes fire this listener every hour on the same user.
        if (get().user?.id === session.user.id) return;
        void toSessionUser(session.user).then((user) => set({ user, hydrated: true }));
      });
    }

    try {
      const { data } = await supabase().auth.getSession();
      const user = data.session?.user ? await toSessionUser(data.session.user) : null;
      set({ user, hydrated: true });
    } catch {
      set({ user: null, hydrated: true });
    }
  },
}));
