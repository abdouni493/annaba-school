"use client";

import { friendlyError, supabase } from "@/lib/supabase/client";

/**
 * Account management, backed by Supabase Auth.
 *
 * Creating a teacher, a worker, an élève or a parent writes a real row in the
 * authentication table through the `admin_create_user` SQL function, so the
 * person can sign in immediately with the email and password that were typed.
 * The function runs server-side under the caller's own rights, which is what
 * lets the app do this with nothing but the anon key: the staff member stays
 * signed in — creating someone else never steals their session.
 *
 * The returned id is the auth account's id, and the caller stores the business
 * row (Teacher / Student / Parent / ReceptionStaff) under that very id — that
 * is what links a session to its data.
 */
export interface CreateUserPayload {
  role: "admin" | "reception" | "teacher" | "student" | "parent";
  email: string;
  password: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  birthDate?: string;
  rfid?: string;
  isFree?: boolean;
  parentId?: string;
  subscriptionIds?: string[];
  registrationDue?: number;
  paymentType?: string;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  salary?: number;
  /** worker (reception_staff) job: reception | security | menage */
  workerRole?: string;
  /** worker badge used by the clock-in / clock-out scanner */
  workerRfid?: string;
  /** hourly contracts: price of one worked hour */
  hourlyRate?: number;
}

function displayName(payload: CreateUserPayload): string {
  return (
    payload.fullName?.trim() ||
    [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim() ||
    payload.email
  );
}

/** Creates the login of a new person and returns its id. */
export async function createRoleUser(payload: CreateUserPayload): Promise<{ id: string }> {
  if (!payload.role || !payload.email?.trim()) {
    throw new Error("Le rôle et l'email sont obligatoires.");
  }
  if (!payload.password || payload.password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }

  const { data, error } = await supabase().rpc("admin_create_user", {
    p_email: payload.email.trim().toLowerCase(),
    p_password: payload.password,
    p_role: payload.role,
    p_full_name: displayName(payload),
    p_username: payload.email.trim().toLowerCase(),
  });
  if (error) throw new Error(friendlyError(error));
  if (!data) throw new Error("La création du compte n'a rien renvoyé.");

  return { id: String(data) };
}

/**
 * OUVRIR UN COMPTE À UNE FICHE QUI EXISTE DÉJÀ.
 *
 * Un travailleur créé sans accès porte son propre identifiant. Le jour où
 * l'administration lui ouvre un compte, `createRoleUser` en rendrait un TOUT
 * NEUF : il faudrait déplacer sa fiche, ses pointages, ses acomptes et ses
 * règlements dessous. La fiche reste donc où elle est, et c'est le profil du
 * compte qui pointe vers elle — ce que l'application lit pour retrouver les
 * droits d'un connecté.
 *
 * Renvoie l'identifiant du COMPTE, qui n'est pas celui de la fiche.
 */
export async function createAccountForEntity(
  entityId: string,
  payload: CreateUserPayload & { username?: string },
): Promise<{ id: string }> {
  if (!payload.role || !payload.email?.trim()) {
    throw new Error("Le rôle et l'email sont obligatoires.");
  }
  if (!payload.password || payload.password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }

  const email = payload.email.trim().toLowerCase();
  const { data, error } = await supabase().rpc("admin_create_user_for", {
    p_entity_id: entityId,
    p_email: email,
    p_password: payload.password,
    p_role: payload.role,
    p_full_name: displayName(payload),
    p_username: payload.username?.trim() || email,
  });
  if (error) throw new Error(friendlyError(error));
  if (!data) throw new Error("La création du compte n'a rien renvoyé.");

  return { id: String(data) };
}

/**
 * LE COMPTE QUI PILOTE UNE FICHE, quand il en existe un.
 *
 * C'est lui qu'il faut viser pour changer un mot de passe ou un email :
 * l'identifiant de la fiche n'est pas forcément celui du compte, et ne l'est
 * jamais quand l'accès a été ouvert après coup.
 */
export async function accountIdForEntity(entityId: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("account_for_entity", {
    p_entity_id: entityId,
  });
  if (error) {
    console.warn("[accounts] lookup", error.message);
    return null;
  }
  return data ? String(data) : null;
}

/** Le nom d'utilisateur affiché sur un compte. */
export async function updateUsername(id: string, username: string): Promise<void> {
  const { error } = await supabase().rpc("admin_set_username", {
    p_user_id: id,
    p_username: username.trim(),
  });
  if (error) throw new Error(friendlyError(error));
}

/** Admin/reception resets someone else's password. */
export async function resetUserPassword(id: string, password: string): Promise<void> {
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
  const { error } = await supabase().rpc("admin_set_password", {
    p_user_id: id,
    p_password: password,
  });
  if (error) throw new Error(friendlyError(error));
}

/** Keeps the login email in step when staff edits a fiche. A person created
 *  without credentials simply has no account to update, and that is fine. */
export async function updateUserEmail(id: string, email: string): Promise<void> {
  if (!email?.trim()) return;
  const { error } = await supabase().rpc("admin_set_email", {
    p_user_id: id,
    p_email: email.trim().toLowerCase(),
  });
  if (error) throw new Error(friendlyError(error));
}

/** Removes the login of a deleted fiche. Never throws: the row is going away
 *  either way, and people created without credentials have no account. */
export async function deleteRoleUser(id: string): Promise<void> {
  const { error } = await supabase().rpc("admin_delete_user", { p_user_id: id });
  if (error) console.warn("[accounts] delete", error.message);
}

/** Self-service password change for the signed-in account. */
export async function changeOwnPassword(password: string): Promise<void> {
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
  const { error } = await supabase().auth.updateUser({ password });
  if (error) throw new Error(friendlyError(error));
}

// ---------------------------------------------------------------------------
// Bootstrap — the login screen's "create an administrator" button
// ---------------------------------------------------------------------------

/** Is there already an administrator? Drives whether the button is shown. */
export async function adminExists(): Promise<boolean> {
  const { data, error } = await supabase().rpc("admin_exists");
  if (error) throw new Error(friendlyError(error));
  return data === true;
}

/** Creates the very first administrator. Refused once one exists. */
export async function bootstrapAdmin(args: {
  fullName: string;
  username: string;
  email: string;
  password: string;
}): Promise<{ id: string }> {
  const { data, error } = await supabase().rpc("bootstrap_admin", {
    p_full_name: args.fullName.trim(),
    p_username: args.username.trim(),
    p_email: args.email.trim().toLowerCase(),
    p_password: args.password,
  });
  if (error) throw new Error(friendlyError(error));
  return { id: String(data) };
}
