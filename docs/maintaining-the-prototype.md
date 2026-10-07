# Maintaining the Magid prototype

This is a transient-session prototype. A cleanup must preserve source evidence,
review decisions, output values, UI wording, and export gates. Structural changes
do not establish accuracy on a new proposal layout or provider response.

## Code map

| Location                                               | Responsibility                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `app/page.tsx`                                         | Session lifetime, React state, user actions, and committing completed pipeline results                    |
| `components/review/`                                   | Field review and source/output previews; typed props live in `lib/review-types.ts`                        |
| `lib/workbook.mjs`, `lib/parse.worker.ts`              | Bounded OOXML parsing, known-layout extraction, and workbook writing                                      |
| `lib/ai/process-proposal.mjs`                          | Stage source groups, validate responses, split oversized/timed-out groups, collect results                |
| `lib/ai/stages.mjs`                                    | Request deadlines, temporary stage cache, busy-service waits, and retry                                   |
| `lib/ai/types.ts`                                     | Schema-derived AI payload types, temporary cache state and processing boundary contracts                 |
| `lib/ai/client.mjs`, `contracts.mjs`, `evaluation.mjs` | Evidence scopes, response contracts, and source-grounded candidate application                            |
| `app/api/extract/route.ts`, `lib/ai/service.mjs`       | Authenticated requests, leases, rate limits, and provider adapters                                        |
| `lib/canonical/`                                       | Independent approval authority, source rules, dependent-field invalidation, coverage, and final readiness |
| `lib/ui/review.mjs`                                    | Shared review eligibility, counter totals, batch eligibility, and source-window selection                 |
| `lib/debug/`, `components/debug/`                      | Temporary diagnostic trace and pipeline view                                                              |

## Boundaries to preserve

- The review model's status labels do not create controller approvals.
- AI work is staged before results are committed to React state. Completed request
  stages can be cached for retry, but a failed run must not return partial records.
- Scope splitting mutates the session's queue intentionally so retry uses the same
  reduced scopes. Do not replace this with an untracked local queue.
- Session generation, source digest, run ownership, and reviewer revisions reject
  stale AI results. Export and batch decisions also check controller revisions.
- An extra column's approval and an individual value's approval are distinct.
- The final export independently reparses source bytes and reads back the generated
  workbook. A preview or a successful download click is not that validation.
- Do not memoize controller-derived results without accounting for its mutable
  revision. React object identity alone does not describe controller changes.
- No proposal history, durable review state, or new provider calls belong in a
  readability-only refactor.

## Verification

Use [Repeatable verification](verification.md) for setup, one-command checks,
reports, CI scope and the browser/live-AI acceptance checklist. After fixture
setup, run from the repository root:

```sh
npm run verify
```

The real-workbook tests require the original attachments and expected-record
fixtures listed in the hash manifest. Full verification fails when they are
missing or changed. Do not replace them with empty or silently skipped tests. Provider tests
use controlled responses; they do not certify live AI accuracy.

Use Prettier 3.6.2 with the repository configuration for app-owned files. Keep
formatting-only edits separate from functional changes when practical. Preserve
the dependency lockfile and avoid reformatting vendored UI components or the
authoritative reference schema as part of application cleanup.

## Remaining technical debt

- `app/page.tsx` still coordinates many coupled concerns. Further extraction should
  follow feature boundaries and include interaction tests for session replacement,
  cancellation, stale decisions, and export invalidation. Moving all state into a
  generic hook would mostly relocate the coupling.
- `lib/ai/types.ts` derives source scopes, proposals and evaluations from the
  existing Zod schemas. It defines the session cache, progress observer, service
  error metadata and staged processing result. `process-proposal.mjs` and
  `stages.mjs` enable strict checking with `@ts-check`; the page uses these types
  instead of arbitrary scopes and cache entries. Compile-only negative cases in
  `tests/ai-contracts.types.ts` run as part of the normal TypeScript check.
  Sequential stage completion and queue ownership still require runtime guards;
  the local type assertions document those existing invariants, not validation
  of untrusted responses. Model candidates and display statuses remain separate
  from controller authority. Parsing, candidate application and canonical/controller
  internals still use permissive types; migrating those requires parity checks.
- Browser and complete AI acceptance are separate from unit/regression checks.
  Complete AI runs and downloaded-output inspection for all five proposals remain
  necessary before declaring this version accepted.
- The older README contains historical implementation notes and pending-test
  statements. Use observed acceptance results, not those historical statements,
  when deciding release readiness.

The later cancellation feedback fix is implemented; its queued-run browser
recheck is covered by the acceptance checklist.

## Declining optional information

`lib/canonical/omissions.mjs` records explicit decisions to omit extra columns or
reviewed proposal context. A declined column's values do not need acceptance.
Source cells used only by omitted extras can be classified as intentionally
unused; cells supplying item anchors, base fields, or approved extras remain
protected. Re-adding a column reopens any column-omission classifications for its
source cells. The final export still requires current identity, quantity, AI,
and source decisions.

An explicitly declined Source Product ID column permits deliberate code omission
when the row has another template identity. Code-only rows still require a
retained identity. Pair/container distinctions still require meaningful output
or a deliberately blank quantity; declining context must not distort item facts.
