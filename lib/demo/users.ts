"use client";

import { uid } from "@/lib/store/data";

/**
 * Account creation in demo mode. There is no auth backend any more: creating a
 * "user" only mints the id the caller then stores on the Student / Teacher /
 * Parent / ReceptionStaff row it pushes into the in-memory store, and password
 * operations are accepted no-ops. The signatures are unchanged so the pages
 * that create people keep working untouched.
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

const PREFIX: Record<CreateUserPayload["role"], string> = {
  admin: "adm",
  reception: "rec",
  teacher: "tea",
  student: "stu",
  parent: "par",
};

/** Mints the id of a new person. Throws on the same invalid input the server
 *  route used to reject, so the forms keep their validation feedback. */
export async function createRoleUser(payload: CreateUserPayload): Promise<{ id: string }> {
  if (!payload.role || !payload.email?.trim()) {
    throw new Error("Le rôle et l'email sont obligatoires.");
  }
  if (!payload.password || payload.password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
  return { id: uid(PREFIX[payload.role]) };
}

/** Admin/reception resets someone else's password — nothing to store in demo. */
export async function resetUserPassword(_id: string, password: string): Promise<void> {
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
}

/** Self-service password change for the signed-in demo account. */
export async function changeOwnPassword(password: string): Promise<void> {
  if (!password || password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
  }
}
