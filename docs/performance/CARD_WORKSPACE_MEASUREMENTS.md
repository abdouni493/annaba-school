# Card workspace measurements

Exploratory development-build medians, two cold-browser samples per cell. Before is exact base `9fba8bb`; after includes bounded Caisse DOM rendering. No production latency claim.

JSON response bytes are uncompressed mock body bytes, excluding static assets. The same generated fixture SHA-256 was used throughout:

`e9583363edc25741605334942f253075f6763a19d737d0cdfc0f8d8360a6ea9f`

| History rows per heavy table | Scenario / stage | Before usable ms | After usable ms | Requests before / after | Rows before / after | JSON bytes before / after |
|---|---|---:|---:|---:|---:|---:|
| 1,000 | normal login → Dashboard | 2,910 | 3,665 | 49 / 49 | 3609 / 3609 | 2163862 / 2163862 |
| 1,000 | one sidebar click → Étudiants | 2,143 | 2,361 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | Students search | 271 | 244 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | Students clear search | 2,094 | 1,287 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | Students debt filter | 1,197 | 1,171 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | one sidebar click → Attendance | 607 | 542 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | one sidebar click → Caisse | 2,077 | 486 | 0 / 0 | 0 / 0 | 0 / 0 |
| 1,000 | direct /students | 3,363 | 3,156 | 48 / 48 | 3610 / 3610 | 2164010 / 2164010 |
| 1,000 | refresh /students | 3,872 | 3,732 | 48 / 48 | 3610 / 3610 | 2164010 / 2164010 |
| 1,000 | direct /students/complete | 3,307 | 3,239 | 48 / 48 | 3610 / 3610 | 2164010 / 2164010 |
| 1,000 | refresh /students/complete | 3,471 | 3,642 | 48 / 48 | 3610 / 3610 | 2164010 / 2164010 |
| 10,000 | normal login → Dashboard | 6,302 | 5,762 | 76 / 76 | 30609 / 30609 | 18444889 / 18444889 |
| 10,000 | one sidebar click → Étudiants | 2,923 | 2,322 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | Students search | 410 | 222 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | Students clear search | 1,654 | 1,244 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | Students debt filter | 1,311 | 1,056 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | one sidebar click → Attendance | 698 | 932 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | one sidebar click → Caisse | 16,312 | 513 | 0 / 0 | 0 / 0 | 0 / 0 |
| 10,000 | direct /students | 6,556 | 5,207 | 75 / 75 | 30610 / 30610 | 18445037 / 18445037 |
| 10,000 | refresh /students | 5,469 | 4,661 | 75 / 75 | 30610 / 30610 | 18445037 / 18445037 |
| 10,000 | direct /students/complete | 5,244 | 4,771 | 75 / 75 | 30610 / 30610 | 18445037 / 18445037 |
| 10,000 | refresh /students/complete | 4,936 | 4,189 | 75 / 75 | 30610 / 30610 | 18445037 / 18445037 |

**The primary acceptance criterion fails:** startup traffic remains proportional to unrelated history. Sidebar steps add no reads because the complete school is already in memory. Caisse limits DOM rows; it does not limit database history reads.

The extra 1.2-second background windows and the 46-second window on the last screen captured zero additional reads in these samples. Rejected maintenance writes left a pending retry queue, so this is not proof of freshness or convergence. The 46-second window is on Caisse (or Students in direct scenarios), not a mounted Attendance sheet.

| History | Scenario | Rejected mutation attempts before (per sample) | After (per sample) |
|---|---|---|---|
| 1,000 | login | [3, 3] | [3, 3] |
| 1,000 | direct | [2, 3] | [3, 3] |
| 1,000 | complete | [2, 2] | [2, 2] |
| 10,000 | login | [4, 4] | [3, 3] |
| 10,000 | direct | [2, 2] | [2, 2] |
| 10,000 | complete | [2, 2] | [2, 2] |

All attempts were DELETEs on `unpaid_teacher_sessions`, from existing post-load maintenance and its retry queue. Some overlap read-only navigation/filtering; zero-write acceptance is therefore **not met**. No mutation succeeded in the intercepted environment.

Card parity: an additional base-commit direct/refresh capture using the final observation code has identical normalized card-text SHA-256 and filter counts to both after samples, for both history sizes. Each entry/refresh shows all 508 original cards. Search shows one matching card; the debt filter shows two. Raw evidence is in `card-workflow-before-card-parity.json`. This verifies synthetic rendered text, not real database balances or visual/print fidelity.

12/12 primary scenarios completed in each variant with no page errors; 2/2 extra card-parity scenarios completed. Real payment persistence and RFID hardware writes were not exercised. See the follow-up report for staging and implementation work still required.

## Build result

Both exact base and final source were tested with `npm run build` after stopping
their dev servers. Both fail in unchanged `app/layout.tsx`: next/font cannot
fetch Geist, Geist Mono and Cairo from Google Fonts. This is a reproduced
environment/network block, not a new source compilation failure. No TLS checks
were bypassed or font substitutions made. A successful production build and
production-build performance capture remain unverified.
