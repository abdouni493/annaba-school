# Card workspace performance follow-up — incomplete

Base: `fix/students-card-readiness`, `9fba8bbc36a6eee06894d328526c3f198936a336`.
Branch: `perf/active-screen-loading`. No main changes, deployments, SQL execution,
production database access, new write paths, or feature activation.

**This branch does not complete the requested bounded-startup task.** Normal
login still downloads all school history. The scoped ledger reader is tested
in isolation but intentionally not connected to the legacy UI: without
authoritative card summaries, replacing the complete financial snapshot with
ledger pages would give incorrect balances, filters, counts and payroll inputs.
The remaining work below includes implementation, not just staging approval.

## Implemented and active

- The original Students cards, both Students URLs, all actions, filters,
  registration numbers, balance formulas and RFID handlers are retained.
- Card presentation values are computed once per store snapshot and reused for
  cards, filters, counts and alerts. These remain **client calculations over a
  full snapshot**, not authoritative bounded server summaries. No ledger or
  financial formula is replaced by a stored counter.
- Student payment, enrollment, charge and attendance lookups reuse indexes tied
  to immutable source arrays. Returned lists remain copies, so sorting a report
  cannot corrupt a subsequent lookup. Replacing an array invalidates its index.
- Pointer/focus intent warms only the permitted Students, Attendance or Caisse
  module. There is no all-module idle burst. Restricted roles/pages and Save-Data
  are respected. Failed hints do not block navigation. Importing a module does
  not mount it or execute its effects.
- Caisse initially renders 50 rows per history table, with independent
  "Afficher 50 de plus" controls. Filters, counts, all-period totals, running
  balances and print inputs still use the complete selected dataset. This
  bounds DOM work, not database reads. In these exploratory captures, the 10k
  Caisse sidebar median changed from 16,312 ms to 513 ms. A component test proves
  undisplayed older transactions still contribute to the displayed running
  balance, expansion retains totals, and expansion does not mutate the store.

## Implemented, isolated, not activated

`lib/repo/studentLedger.ts` reads payments, attendance or charges for one student:

- mandatory student scope; deterministic descending date/id cursor;
- default 50 rows plus one continuation row; hard maximum 100 plus one;
- quoted cursor literals; cancellation and 20-second timeout;
- errors, including missing financial tables, fail rather than become zeroes;
- pages are tagged with student/kind, never presented as a complete Database;
- no useData hydration, mirror completeness changes, snapshot persistence, writes
  or deletes. It has no runtime UI caller yet.

The reader's mocked 1,000/10,000 unrelated-row tests return the same selected
page in one bounded request. This is **not** evidence that application startup
is bounded. A detail page cannot be summed to compute a student's total debt.

Payment atomic flags retain their default-off behavior. No payment/RFID write
path was enabled or replaced. The legacy write mirror, pending-write snapshots,
account switching and scoped attendance refresh remain in place.

## Measurement protocol and evidence

See [CARD_WORKSPACE_MEASUREMENTS.md](CARD_WORKSPACE_MEASUREMENTS.md) and raw
`results/card-workflow-before.json` / `results/card-workflow-after.json`.

The same fixture file was generated once and reused in both checkouts. The
runner adds 1,000 or 10,000 unrelated historical rows to **each** of attendance,
student payments and teacher payments, retaining the same 508-student roster.
This matches the existing fixture's model; it is not 10,000 total extra rows.
These synthetic historical references are deliberately not a valid database
import. They do not exercise foreign keys, RLS, indexes, query plans or SQL.

Two fresh Chromium contexts per scenario/history/variant, 1280×900, fr-FR, UTC,
no CPU/network shaping. Servers and browser share the machine. Development
builds, warmed server compilation, cold browser cache. Times are exploratory,
not production latency or statistically established improvements.

The workflow covers normal form login → Dashboard → **one sidebar click** on
Students → search/clear/debt filter → Attendance → Caisse. Separate contexts
cover direct `/students`, refresh, `/students/complete` and refresh. Readiness
requires the route heading (where applicable), main input, completion of the
store revalidation indicator and two animation frames. It does not prove
server-confirmed write durability. Each stage observes another 1.2 seconds of
background traffic; the last screen also observes a 46-second clock jump.

Every non-local browser request is intercepted. Supabase responses are synthetic;
other external hosts are blocked. Mutation requests receive 409 and are recorded
with method/table only. No production Supabase request is allowed through.
JSON bytes are exact UTF-8 response-body bytes in this mock, **not compressed
wire bytes or total page assets**. Per-request query, rows and bytes are retained.

Maintenance automatically attempts `unpaid_teacher_sessions` DELETEs after
legacy bootstrap. Rejected writes enter the existing retry queue; those retries
can overlap search/navigation. Thus this experiment does **not** satisfy the
zero-navigation-writes acceptance criterion, nor demonstrate a clean online
cache or live refresh convergence. The runner reports these attempts rather
than hiding or accepting them. No maintenance/financial job was disabled to
produce a cleaner number.

Both versions still load globally on Dashboard, Students (including complete),
Attendance and Caisse. Reports, payroll and other legacy screens remain global
too. Navigating after boot often adds zero reads because the entire school was
already downloaded; that is not evidence of bounded screen data ownership.

## Validation

| Check | Base 9fba8bb | This branch |
|---|---|---|
| Vitest | 614 pass, 3 fail / 617 | 626 pass, same 3 fail / 629 |
| Typecheck | Pass | Pass |
| ESLint | 90 errors, 52 warnings | Same 90 errors, 52 warnings |
| New repository/summary/intent files lint | n/a | Pass |
| Production build | Google Fonts fetch failure | Same Google Fonts fetch failure |

The same three failures are `teacherMonths` late-enrollment completion,
`teacherPayCases` teacher-child tuition (800 versus 2000), and `teacherPayroll`
teacher-child debt (750 versus 1500). No failing assertion was disabled or
rewritten. Existing tests for payment edits/receipts, RFID, permissions, offline
pending writes, account changes, bootstrap inter-phase edits, partial refresh
and deletion protection remain enabled. Passing mocks do not prove real payment
persistence, printing fidelity, RFID hardware behavior or concurrent retries.

## Safe local preview and reproduction

Do not open the app in an ordinary browser against its built-in Supabase URL.
Use the intercepted disposable preview below. All mutations are rejected; any
local optimistic edit is not durable and disappears when this browser closes.

```sh
npm ci --cache /tmp/annaba-npm-cache
ANNABA_FIXTURE_PATH=/tmp/annaba-synthetic-base.json npx vitest run tests/performanceFixtures.test.ts
npm run dev -- --hostname localhost
# Another terminal: use your installed Chromium path, or install Playwright's Chromium.
CHROMIUM_PATH=/usr/bin/chromium node scripts/performance/preview.mjs /tmp/annaba-synthetic-base.json 3000 10000
```

The preview requires a graphical desktop. To measure without one:

```sh
ANNABA_SAMPLES=2 node scripts/performance/workflow.mjs /tmp/annaba-synthetic-base.json 3000 after /tmp/after.json
```

For before/after, archive the exact base to another directory, use the same
dependencies and fixture, and run its dev server on 3001. Run the **same current
workflow runner** against 3001 with variant `before`. Do not run build and dev
against the same checkout's `.next` concurrently. No hosted preview was deployed.

## Remaining implementation before bounded reads can be enabled

1. Implement authoritative student card summaries and server-side whole-roster
   counts/filters with bounded displayed-card pages. Prove parity with the
   existing helpers for day deduplication, waived/no-charge/pre-start attendance,
   legacy tariffs, discounts, school-only/teacher-child cases, archived/departed
   groups, old payment rests, registration fees and diverse charges. Client
   memoization in this branch is not that server implementation.
2. Connect isolated student detail/print/edit/payment workspaces to scoped reads.
   Carry explicit account/query/period/completeness metadata and cancellation.
   Ensure receipts and whole-period reports deliberately request complete input.
   A paged list must never replace a mirror array or a dirty offline snapshot.
3. Replace Dashboard all-time collection calculations, Attendance group-month
   history and Caisse all-time/period totals with authoritative summaries and
   bounded detail reads. Migrate maintenance to an independently authorized,
   idempotent process so read-only navigation does not delete or bill anything.
4. Only then replace legacy startup. Preserve outbox recovery and prevent mirror
   delete inference from any partial data. Do not mark a scope globally complete.

## Exact staging setup and checks before database-dependent activation

1. Create a separate disposable Supabase project; set its URL/anon key in a
   separate checkout's `.env.local`. Never reuse production sessions, service
   keys or data. Apply the schema and applicable application upgrades described
   in README. Inspect the existing SQL runbooks first; do not blindly apply
   phase-2 RLS to legacy portals. This branch introduces no SQL to execute.
2. Seed synthetic records with valid UUIDs and foreign keys (including a real
   archived unrelated group), then separate 1k and 10k history datasets with an
   identical active roster. The mock fixture requires UUID/FK adaptation before
   database import. Create admin, permitted/restricted reception, teacher,
   student and parent test accounts with valid entity relationships.
3. Under each actual JWT, verify allowed/denied scoped reads and absence of
   cross-account results. Capture policies and EXPLAIN ANALYZE/BUFFERS for
   student search/keyset pages, ledger student/date/id pages, attendance day and
   session reads, and future summary queries. Measure before adding indexes.
4. Compare every card, filter count, ledger, whole-period total, report and
   printed receipt to the complete reference store. Include duplicate dates,
   legacy rows without matricules, departed groups, partial fees, advances,
   free/reduced/school-only cases and teacher-child balances.
5. Test two desks: create/edit/delete remotely; prove two consecutive polls
   converge without mirror writes. Disconnect, edit, reload, reconnect, switch
   accounts and recover the pending outbox without loss or accidental deletes.
6. Exercise real RFID hardware and manual scanning: out-of-page student,
   duplicate swipe, month boundary, free/reduced/teacher-child cases, substituted
   groups and failed writes. Confirm durable attendance exactly once.
7. Keep atomic payment/reversal flags off until the complete transaction covers
   every business event, has actor/role authorization, excludes duplicate mirror
   writes and survives concurrent identical retries plus a lost response.
   Verify payment → fresh-browser reload → receipt/reprint against PostgreSQL,
   reversals, offline replay and user-visible server confirmation.
8. Repeat the full normal-login/sidebar/direct/refresh/old-URL workflow with
   foreground and background request/row/wire-byte/usable-time capture. Require
   unrelated history to leave startup transfer bounded and read navigation to
   produce zero mutations. Obtain a production build and measure that build
   before making production performance claims. No deployment is part of this work.
