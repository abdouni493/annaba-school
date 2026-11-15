# Bounded Students reads and attendance refresh: first implementation slice

This branch does **not** complete the requested school-wide performance project.
It implements a real bounded `/students` entry, shared refresh fixes, scoped retry,
and bootstrap/outbox protections. The ordinary `/dashboard` landing, attendance
mutations, financial workflows and the other role portals still use the full store.
Normal-login measurements below confirm the remaining history-dependent bootstrap.
Do not interpret the directory improvement as an improvement to that path.

## Implemented behavior

- `SessionProvider` recognizes direct staff `/students` entry. It reads branding
  and the receptionist's own permission projection, then the directory reads a
  30-item page plus one continuation row. Other roles retain their existing
  landing and dispatch. No new flags are required.
- `lib/repo/students.ts` is now used by the UI. Searches cover both name orders,
  stored registration numbers with leading zeros, both phone fields and email.
  Cursor values are quoted, and `(last_name, first_name, id)` breaks name ties.
  Database collation and live insertion behavior still need staging validation.
- Pages and personal details live outside `useData`, the write mirror and the
  whole-school snapshot. Searching, clearing search and paging cannot replace a
  mirror array. A personal detail is fetched on intent. The displayed number is
  explicitly the number **on this page**, never an invented school-wide count.
- Existing financial filters, debt/low/free counts, totals, enrollments, family,
  ledger, receipts and editing remain in `/students/complete`, reachable from the
  directory. These still load globally; authoritative bounded summaries and
  student-scoped business workspaces are **not implemented**. Legacy computed
  registration numbers on rows without a stored matricule are also not searchable
  from the directory; the complete workspace retains that fallback.
- Directory focus/reconnect refreshes the current page. An RFID swipe outside
  that page is queued per account until the complete business workspace is ready.
  It is not reported as a missing student. This is a correctness fallback, **not
  a bounded RFID read/write implementation**. Topbar manual scanning uses the
  same fallback. Existing Annaba billing logic and the array mirror still write.
- Attendance queue cleanup compares the actual assigned promise. Same scopes
  coalesce; distinct session reads serialize; an older completion cannot clear
  a newer entry. Account changes invalidate/abort old reads and queued results.
- Mounted Dashboard/Attendance day views and presence sheets register interest.
  The unchanged 45-second timer, focus and reconnect read those day/session scopes,
  not seven days or an unbounded session. Queries use a half-open local-day UTC
  interval. Remote corrections/deletes are adopted only in that scope, with the
  existing unchanged-row checks. Busy/failed write queues are not overwritten.
  Global revalidation no longer holds a focused sheet for up to 90 seconds.
- Tab return no longer requests the whole database. Failed-table retries request
  only their failed collections. Global initial/warm legacy boot remains global.
- Edits between cold bootstrap phases retain a separate server baseline and stay
  pending. Account clearing no longer persists empty arrays over an offline
  outbox; account changes flush the previous account's dirty snapshot first.
- Whole-school absence/dues jobs are gated on a complete successful legacy load
  with no stale collections. They do not run from the directory. Their billing
  formulas are unchanged; due work waits for a complete legacy workspace. A
  server/scope-aware scheduler that also covers directory-only use is outstanding.
  The global scan hook reads store data at
  scan intent instead of subscribing the keyboard listener to the entire store.
- Removed the idle burst importing every staff module. Dynamic screen loading
  remains; role-aware keyboard/touch intent prefetch is not implemented/measured.

## Validation

Baseline: `8263943bce5cd1e4c06787ea15dc9bbe87479bec`. Implementation: `2e96cb1`.
Node 24.22.1, npm 11.9.0, Next 16.2.9, Linux, 5 reported CPUs, ~34 GB RAM.
Installed Next documentation read: App Router `usePathname` and lazy loading.

| Check | Baseline | Implementation |
|---|---|---|
| `npm test` | 593 pass, 3 fail / 596 | 614 pass, same 3 fail / 617 |
| `npm run lint` | 90 errors, 53 warnings | 90 errors, 52 warnings |
| `tsc --noEmit --incremental false` | pass | pass |
| `npm run build` | Google Fonts fetch failure | Google Fonts fetch failure |

The unchanged failures are `teacherMonths` late-enrollment completion,
`teacherPayCases` teacher-child amounts, and `teacherPayroll` teacher-child debt.
They reproduce independently of the new readers. No assertions were disabled.
Lint failures are pre-existing React hook/compiler rules and other source issues.
No production-build performance result is available: the runtime blocks
`fonts.googleapis.com` / `fonts.gstatic.com`. No TLS/signature checks were disabled.

New tests exercise the actual provider's entry/navigation and permissions path,
dirty-snapshot fallback, scope-only focus/reconnect, account changes, deferred
RFID replay, and inter-phase edits. Queue tests prove **two eligible polls** after
success, read failure and task rejection; two queued sessions; coalescing; a poll
during a read; and old-account completion racing a new queue entry. Existing
progressiveLoad, partialRevalidation, offlinePersist, cacheSyncResume,
syncDeletionSafety, liveRefresh, repoStudents and business suites remain enabled.
The absorber's existing remote add/correct/delete and newer-local-edit tests pass.
These are not a real two-desk database concurrency or exactly-once billing proof.

## Synthetic Chromium evidence

Raw aggregate-only captures are in `results/`. They contain table names, request
counts, row/JSON-byte counts and timings, never record contents or credentials.
`browser.mjs` intercepts every non-local request, fabricates Supabase responses,
and rejects mutation requests. Production Supabase is never contacted. Baseline
maintenance attempts are counted as rejected writes, so its later cache can be
**dirty**, not a clean online snapshot. This also suppresses some current
Dashboard refreshes while the mirror is pending: zero reads there is not a
freshness/convergence result.

Browser: headless Chromium 156.0.8078.79, 1280×900, fr-FR, UTC. Role: reception.
No network/CPU shaping; browser and servers share this machine. Two samples per
variant/dataset, separate cold browser contexts. Eight seed students plus 500
synthetic directory students; the large case adds 5,000 instead. The active seed
roster is identical in both history cases. Each history case appends 1,000 or
10,000 unrelated historical rows **to each** of attendance, payments and payroll,
without changing today's seed data. This is a mock transport fixture, not a
loaded PostgreSQL database: it does not validate FK constraints, RLS, indexes,
PostgREST grammar, query plans or Supabase server execution time.

Warm reload includes browser asset caching. The baseline has a legacy IndexedDB
snapshot (often dirty after rejected synthetic jobs); the direct directory has
no persisted list, just the metadata database opened by the outbox check. This is
not a clean warm-snapshot comparison; that acceptance scenario remains unmeasured.

Development builds use fallback fonts. Cold times include hydration, possible
on-demand compilation and static assets; n=2 and shared-resource contention do
not justify latency claims. Structural transfer bounds are the useful evidence.

| Direct `/students` | Before, 1k | Before, 10k | After, 1k | After, 10k |
|---|---:|---:|---:|---:|
| Read requests | 48 | 75 | 6 | 6 |
| Rows returned | 3,610 | 30,610 | 35 | 35 |
| JSON bytes | 2,163,843 | 18,444,870 | 7,642 | 7,642 |
| Cold click-to-use median, ms | 6,978 | 5,903 | 2,891 | 2,243 |
| Warm reload median, ms | 4,546 | 4,584 | 2,248 | 2,197 |
| Browser TaskDuration median, s | 5.73 | 4.63 | 1.25 | 0.80 |
| Four-minute-return reads | 44 | 71 | 1 | 1 |
| Four-minute-return rows | 3,607 | 30,607 | 31 | 31 |

The 5,000-extra-student directory case also transfers 35 rows / 7,642 JSON bytes
in six reads. This tests the list population, not a 5,000-pupil attendance roster.
Search for the synthetic matching name causes one bounded student query after
the 200ms debounce; baseline search is local over its already downloaded store.
The runner's search duration includes a fixed 500ms observation window; it is
not an accurate click-to-use measurement for search. A scalar personal detail is
implemented and cancellation protected, but not timed in this browser capture.

All queries for a representative current cold directory entry (development auth
callbacks cause repeat profile reads):

1. `schools`: singleton branding, 0 rows in this fixture (blank-school fallback).
2. `profiles`: current auth account, 1 row; repeated three times.
3. `reception_staff`: current worker IDs only, `id,nav_keys,action_keys`, 1 row.
4. `students`: explicit list projection, name ordering, limit 31, 31 rows.

Background after entry: no legacy bootstrap or whole-school maintenance. A search
adds one student-page query. A four-minute focus adds one student-page query.
Scope polling applies when an attendance consumer is mounted. Complete per-call
lists, including the baseline's collections/pagination and observed background
reads, are preserved in the warm/return JSON captures.

Normal login to the unchanged Dashboard remains **49/76 read requests and
3,609/30,609 rows** for the 1k/10k cases, both before and after. Its first transfer
is still 2,163,695 / 18,444,722 JSON bytes. No login speed improvement is claimed.
Normal-login captures separately record local static asset encoded transfer
(~9.8 MB in development), main-thread TaskDuration and long-task time. Current
directory captures record ~7.35 MB of local development assets separately from
the 7,642 Supabase JSON bytes. Vercel hosting/CDN and real Supabase time are
unmeasured; browser cost is not attributed to the database or cache.

## Reproduce

```sh
npm ci
ANNABA_FIXTURE_PATH=/tmp/annaba-synthetic-base.json npx vitest run tests/performanceFixtures.test.ts
npm run dev -- --hostname localhost
# In another shell; use CHROMIUM_PATH if Chromium is installed elsewhere:
node scripts/performance/browser.mjs /tmp/annaba-synthetic-base.json 3000 current /tmp/current.json
ANNABA_EXTENDED=1 node scripts/performance/browser.mjs /tmp/annaba-synthetic-base.json 3000 current /tmp/extended.json
ANNABA_ENTRY=login ANNABA_EXTENDED=1 node scripts/performance/browser.mjs /tmp/annaba-synthetic-base.json 3000 current /tmp/login.json
```

For baseline, unpack `git archive 8263943bce5cd1e4c06787ea15dc9bbe87479bec` into
an external temporary directory, install its frozen dependencies (or use the same
installed dependency tree), start on port 3001, then run the same runner with
`3001 baseline`. No worktree is needed. The captures used an external source
archive and the same dependency tree. Keep services stopped while building in
their checkout: development and production share `.next`.

## Remaining acceptance work / staging verification

There is no staging binding or usable GitHub API credential configured here.
Existing Git proxy access supports branch push. No production database queries,
SQL changes, feature activation or deployments were made for this implementation.

1. On a disposable staging project, inspect the existing read-only diagnostics,
   phase2 access runbook and November index migrations under the actual role JWT.
   Establish deployed policies/columns/functions/indexes. In particular, old open
   SELECT policies are not corrected by this application change. Record role RLS
   query plans for the student contains-search, keyset page and day/session read.
   Contains search is not served by the existing prefix indexes. Add no index
   before measuring those plans; none was added here.
2. Complete the default Dashboard bounded bootstrap, role/route/query/period
   completeness metadata, all other portals, and retryable bounded read models
   before claiming the main goal. `/students/complete`, Dashboard, Attendance,
   Caisse, Reports, payroll, settings and other legacy modules still load globally.
   Navigating to a legacy module activates the global workspace for that account;
   returning to the directory does not reload it again, but retains its memory.
3. Implement authoritative student summaries and all filters/totals without
   recomputing financial semantics in SQL by guesswork. Load enrollments, family,
   full ledger and print dependencies for a chosen student in an isolated business
   workspace. Compare whole-period totals and exports to the reference store.
4. Implement bounded manual attendance/RFID decision inputs, anti-double-swipe,
   month progression, substitutes/walk-ins/free periods and tariff/share summaries.
   The existing Attendance history's 400-row slice and full-period export behavior
   are not migrated. Test a genuinely large active-session roster, not just a list.
5. Keep all atomic flags off. `record_tuition_payment` currently covers payment
   and cash, not every browser-computed business event. Its idempotency lookup
   occurs before the student lock; no simultaneous-retry proof was obtained.
   Do not activate it as a performance fix. Implement complete authorization,
   actor identity, idempotency, transaction coverage, outbox replay and mirror
   exclusion first, including reversals and configurable weekly absence billing.
6. With identical synthetic fixtures at two desks, record attendance and payment
   concurrently; retry the same operation after a lost response; correct/delete
   remotely; verify two successive scope polls converge without mirror writes.
   Disconnect one desk, edit, reload, reconnect, switch accounts, and verify no
   pending write is lost. This branch's mocked absorber/outbox tests are necessary
   protections, not sufficient evidence for real PostgreSQL concurrency.
7. Measure cold login, direct links, clean warm IndexedDB, four-minute return,
   Dashboard/Students/Attendance/Caisse switches, detail, manual attendance, RFID,
   tuition payment and receipt/reprint in FR/AR and every role/worker permission.
   Capture every foreground/background query, rows, wire bytes, long tasks,
   click-to-use and **click-to-server-confirmed durability**. Save/receipt durable
   confirmation UX is not implemented by this slice; local success must not be
   treated as proof of server confirmation. Manual writes/payment/receipt timings,
   real two-desk convergence and browser offline reload are unmeasured here.

## Cache / rollout / rollback

No SQL migration is introduced and no database rollout is required for this slice.
The directory read model is intentionally memory-only and cannot replace legacy
snapshot collections. Existing schema-v2 snapshots and selective per-collection
IndexedDB writes remain readable. Clean chunked snapshots need only a metadata
outbox check for direct directory entry. A dirty snapshot automatically activates
legacy boot/replay with its existing confirmed baseline. Legacy single-blob v2
metadata reads can still materialize that old blob; a subsequent successful
legacy boot rewrites it using the existing chunked writer. Do not discard old
snapshots to obtain a fast benchmark, since they can contain pending writes.

Review this as an incomplete application slice. After the remaining staging
checks, application rollback is a revert of this branch, with legacy snapshots
retained. Do not clear IndexedDB, change financial flags or execute a database
rollback as part of this change.
