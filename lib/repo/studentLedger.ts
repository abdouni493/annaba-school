"use client";

import { supabase } from "@/lib/supabase/client";
import { fromRow, TABLES } from "@/lib/supabase/tables";
import type { Database } from "@/lib/store/data";

export type StudentLedgerKind = "payments" | "attendance" | "studentCharges";
const dateColumns = { payments: "date", attendance: "occurred_at", studentCharges: "date" } as const;
export interface LedgerCursor { date: string; id: string }
export interface StudentLedgerPage<K extends StudentLedgerKind> {
  /** A page is deliberately not a Database or an authoritative balance input. */
  scope: { studentId: string; kind: K };
  items: Database[K];
  nextCursor: LedgerCursor | null;
}

/** Read-only, isolated ledger pages for detail/history consumers. This never
 * hydrates useData, changes mirror completeness, or persists a partial snapshot.
 * Not activated in the legacy UI until authoritative card summaries are ready.
 */
export async function getStudentLedgerPage<K extends StudentLedgerKind>(
  kind: K,
  studentId: string,
  options: { pageSize?: number; cursor?: LedgerCursor | null; signal?: AbortSignal } = {},
): Promise<StudentLedgerPage<K>> {
  if (!studentId.trim()) throw new Error("A student scope is required");
  const requested = options.pageSize ?? 50;
  const size = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 50;
  const spec = TABLES[kind];
  const column = dateColumns[kind];
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20_000);
  try {
    let query = supabase().from(spec.table).select("*").eq("student_id", studentId)
      .order(column, { ascending: false }).order("id", { ascending: false }).limit(size + 1)
      .abortSignal(controller.signal);
    if (options.cursor) {
      // Quoted PostgREST literals cannot introduce a new branch in the filter.
      const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const date = quote(options.cursor.date);
      const id = quote(options.cursor.id);
      query = query.or(`${column}.lt.${date},and(${column}.eq.${date},id.lt.${id})`);
    }
    const { data, error } = await query;
    if (controller.signal.aborted) throw new Error("Student ledger read cancelled or timed out");
    // Missing financial tables and permission failures must never look empty.
    if (error) throw new Error(`${spec.table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      scope: { studentId, kind },
      items: page.map((row) => fromRow(spec, row)) as unknown as Database[K],
      nextCursor: rows.length > size && last ? { date: String(last[column]), id: String(last.id) } : null,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
