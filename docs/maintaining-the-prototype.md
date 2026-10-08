# Maintaining the Magid prototype

This is a transient-session prototype. A cleanup must preserve source evidence,
review decisions, output values, UI wording, and export gates. Structural changes
do not establish accuracy on a new proposal layout or provider response.

## Current guides

Use [Architecture](architecture.md) for the single current code map, pipeline,
runtime limits and provider configuration. Use [Verification](verification.md)
for setup and acceptance; [Known limitations](known-limitations.md) owns the
remaining-debt and deferred-work list. This guide documents change boundaries.

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

## Normalization runner boundary

The page owns session lifetime, cancellation, the current-run guard and React
state. `prepareNormalization` clones the current records and applies the existing
deterministic policies. `runNormalization` accepts parsed workbook data and a
temporary cache, builds the same targeted three-item groups (or selected discovery
region), and stages extraction plus independent evaluation. It does not change
controller proofs or publish records while waiting for AI.

After the await, `finalizeNormalization` calls the supplied ownership guard before
applying the existing evaluation/reconciliation/automation sequence. The caller
publishes those records synchronously, without another await. A stale or canceled
run cannot change proofs during finalization. Scope splitting and completed stage
responses remain in the supplied cache for retry; the page clears them on reset.

This API can be called without React. It starts from parsed records and does not
add a durable worker, queue, persistence, matching handoff or export permission.
The separate canonical export gate remains authoritative. Interaction cases cover
retry, cache invalidation, discovery and stale/canceled finalization. Five-workbook
parity cases compare records, controller proofs (excluding event timestamps),
review counts and final blockers with the prior page sequence, using controlled
responses. They establish refactor parity, not live AI accuracy.

## Session ownership

The page uses one session coordinator instead of separate refs for source bytes,
digest, generation/review revision, parser resources, AI ownership, retry caches,
download URL and expiry clocks. Its source and operation properties are read-only;
transitions use explicit methods. React still owns user-facing statuses, dialogs
and selections. The review controller and canonical decision guards remain the
approval authority.

Reset invalidates owners before canceling resources, clears the retry cache and
revokes the prepared download. AI cancellation retains completed stage results
for retry, and only the matching run can finish its operation. Parser completion
releases only its own resource; late old-worker events cannot detach a replacement.
Page close also releases source bytes, cache and object URLs. No persistence or
provider changes are introduced.

Source installation now checks the upload generation before changing either bytes
or digest. Previously a late hash could write its digest before the page's stale
check. Download publication repeats the existing decision guard after the final
export await, before creating a URL. These close ownership races without changing
normalization or review policies. Manual edits also revoke prepared downloads
immediately; the existing React effect clears the visible save link.

Expiry retains the one-hour idle, eight-hour absolute and fifteen-minute download
grace limits. Continue-review refreshes activity and removes grace without moving
the absolute start time. Tests cover source replacement, queued cancellation and
retry, old-owner cleanup, stale export returns, worker success/failure/timeout,
URL cleanup and exact expiry boundaries. Browser acceptance is still separate.

## Workflow views

`components/workflow/` separates the upload, review overview, AI status, item list,
item details and download panel from `app/page.tsx`. These views receive typed
props and explicit action callbacks. They do not own source bytes, sessions,
controller approvals, AI requests or export validation. The item list uses the
shared read-only review helpers; it calculates each visible item's eligibility
and pending-field count once per render.

The page retains React state, navigation and event sequencing. Field decisions,
identity warnings and quantity/packaging controls remain in the page and are
passed as children of the item details view. The workspace fieldset still disables
all review controls during processing. Download disabled conditions and current
blocker messages remain supplied by the existing readiness computation; the view
cannot bypass the final canonical export gate. No wrapper elements, CSS, wording,
provider calls or persistence changes are introduced by this extraction.

When extending these views, keep display counters separate from export permission
and use explicit callbacks rather than passing the session or controller into a
presentation component. Mapping, proposal coverage and extra-column decisions
still live in the page and can be extracted along their own feature boundaries.

## Verification commands

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
