# Current architecture

This maps the current code, including deterministic row skipping and the opt-in bounded grouping experiment.
The workflow views were extracted in PR #9; this guide does not identify the
revision currently deployed on the hosted site. Suhaas owns this normalization component. Its first release is
for client/lead demonstrations; matching integration and background jobs are later
work. See [known limitations](known-limitations.md) for remaining decisions.

## Pipeline and approval authority

| Stage                | Behavior                                                                                                                                                                                                                     | Main implementation                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Upload and parse     | Validate `.xlsx`/`.xlsm`, parse OOXML in a cancelable browser worker, retain raw cells/formula metadata and compute a source digest                                                                                          | `app/page.tsx`, `lib/parse.worker.ts`, `lib/workbook.mjs`, `lib/session/parse-workbook.mjs`                                       |
| Identify and prepare | Recognize the supplied layouts; offer column mapping when needed. Prepare descriptions and deterministic source-backed values, item boundaries and coverage                                                                  | `lib/description-policy.mjs`, `lib/workbook.mjs`, `lib/canonical/pipeline.mjs`, `prepareNormalization`                            |
| Plan AI scopes       | Reproduce closed stock-lane completeness proofs and retain qualifying rows without AI. Group remaining items three at a time by default, targeting unresolved fields; larger groups are opt-in. Discovery still handles unknown layouts. Bind retry plans to source/session/reviewer state | `lib/ai/normalize-proposal.mjs`, `lib/canonical/completeness.mjs`, `lib/ai/client.mjs` |
| Extract and evaluate | Extract requested candidates, then separately evaluate occurrences and facts against original evidence. Authenticate and admit each request, validate structured results and stage them in temporary memory                  | `lib/ai/process-proposal.mjs`, `stages.mjs`, `contracts.mjs`, `evaluation.mjs`, `app/api/extract/route.ts`, `service.mjs`         |
| Commit and review    | After all groups succeed and ownership is current, apply policy synchronously and publish records. Show only exceptions by default; keep every prepared value inspectable                                                    | `finalizeNormalization`, `lib/canonical/bridge.mjs`, `pipeline.mjs`, `app/page.tsx`, `components/workflow/`, `components/review/` |
| Check and export     | Rehash/reparse original bytes, validate canonical final readiness and template headers, write values and read them back before publishing a temporary Save link                                                              | `lib/canonical/export.mjs`, `validator.mjs`, `lib/workbook.mjs`, `lib/session/coordinator.mjs`                                    |

The review controller is the approval authority. UI status flags and model
confidence numbers cannot create approvals. Eligible deterministic facts receive
source-rule proofs; eligible semantic facts require the separate evaluation and
independent source checks. Human decisions bind the current values, evidence,
item boundaries and dependencies. An edit can reopen dependent fields, coverage
and layouts; reverting the text does not resurrect a stale approval.

Known-layout source rules can automatically account for supported item cells,
headers and context. Unrecognized regions, conflicting facts, hidden/formula
content and ambiguous boundaries remain review cases. An AI run must complete
extraction and evaluation before the app workflow can export. Partial or stale
runs do not publish AI records or grant export permission.

## Code ownership

| Location                                                                                                                                                 | Owns                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Page](../app/page.tsx)                                                                                                                                  | React display state, user actions, navigation, field controls, mapping/coverage/extra-column views and publication of completed results                        |
| [Workflow views](../components/workflow/)                                                                                                                | Six typed presentation components: upload, progress overview, AI status, item list, item details and download; explicit callbacks delegate actions to the page |
| [Review components](../components/review/) and [review types](../lib/review-types.ts)                                                                    | Field/quantity controls, source window, output preview and their typed presentation model                                                                      |
| [Review helpers](../lib/ui/review.mjs)                                                                                                                   | Shared pending counts, eligibility, batch scopes and source-window selection                                                                                   |
| [Session coordinator](../lib/session/coordinator.mjs) and [parser transport](../lib/session/parse-workbook.mjs)                                          | Temporary source ownership, generations/reviewer revisions, operation locks, cancellation, retry cache, worker cleanup, download URLs and lifetime clocks      |
| [Normalization runner](../lib/ai/normalize-proposal.mjs) and [scope planner](../lib/ai/scope-planner.mjs)                                                | Deterministic preparation, scope planning, staged processing and guarded synchronous policy application, callable without React                                |
| [AI types](../lib/ai/types.ts), [contracts](../lib/ai/contracts.mjs) and [evaluation](../lib/ai/evaluation.mjs)                                          | Schema-derived payload types, runtime validation, source evidence and candidate/evaluation contracts                                                           |
| [API route](../app/api/extract/route.ts), [service](../lib/ai/service.mjs) and [admission](../lib/ai/request-slots.mjs)                                  | Sites authentication, exact-Origin check, bounded requests, per-isolate admission, deadlines and provider adapters                                             |
| [Canonical policy](../lib/canonical/)                                                                                                                    | Approval proofs, omission decisions, identity/quantity/source rules, coverage, dependency invalidation and final export readiness                              |
| [Canonical reference](../lib/canonical/reference/)                                                                                                       | Supplied v1.1 schema and independent Python validator/reference tests; browser projection and validation are in `bridge.mjs`/`validator.mjs`                   |
| [Field contracts](../lib/canonical/field-contracts.mjs) and [template](../public/template.xlsx)                                                          | Original template headers, canonical slots, reviewer guidance and fixed output workbook                                                                        |
| [Diagnostics](../lib/debug/) and [debug view](../components/debug/)                                                                                      | Optional temporary trace and pipeline display; no approval authority                                                                                           |
| [Verification runner](../scripts/verify.mjs), [suite registry](../tests/verification-suites.json) and [fixture manifest](../tests/fixture-manifest.json) | Explicit core/workbook profiles, reports and pinned private inputs                                                                                             |

Types describe shape, not authorization. Strictly checked runner/session modules
still require runtime ownership guards. Parsing and canonical internals retain
permissive types; their migration is remaining debt. See
[maintenance boundaries](maintaining-the-prototype.md) before changing them.

## Sessions, concurrency and failures

One proposal is active per tab. Source bytes, decisions, caches and debug content
stay in that browser session. The API holds bounded request data and admission
leases in Worker memory; there is no proposal store, durable job queue or audit
database. The hosted fixed template is separate from uploaded proposals.

- Existing-item enrichment defaults to three-item scopes and at most two groups
  in flight. Extraction and evaluation run sequentially within each group.
- Stage deadlines are 24 seconds in the provider adapter, 27 seconds for the
  server lease/deadline and 28 seconds in the browser. Stage adapter attempts are
  set to one; this is distinct from the older combined helper's defaults.
- Timeout, oversize or incomplete multi-item scopes can split into single-item
  scopes. Capacity waits retry up to nine times after the first attempt, honoring
  a bounded Retry-After delay and cancellation. This is not a durable FIFO queue.
- Admission defaults to two active requests per user, four per Worker isolate,
  and 100 admitted requests per minute per user in that isolate. Different
  isolates do not share those maps.
- Successful stages remain cached for explicit retry only while the source,
  scope and review state match. A failed, canceled or stale group aborts siblings
  and prevents the whole AI result commit.
- Source replacement, reviewer edits, reset and expiry invalidate relevant
  owners and prepared downloads. Late worker/AI/export completions cannot publish
  into a replaced session. Page close releases temporary resources.

The idle limit is one hour and the absolute limit is eight hours. Clicking the
Save link starts a fifteen-minute download deadline; it does **not** extend the
idle or absolute limits. Continue reviewing clears that deadline and refreshes
activity without moving the absolute start time. Limits are checked periodically
in the UI; this is a browser session lifecycle, not server-side durable retention.

## Review and output semantics

Description 1 contains prepared product wording; Description 2 preserves the full
narrative or additional source text. These can be populated deterministically or
semantically when evidence supports them. Neither requires inventing missing facts.
Literal sizes and leading-zero identifiers remain text. Manufacturer, customer and
unknown stock-code namespaces are kept distinct.

A verified stock-code-only item can be matching-ready if the Source Product ID
column is approved and the code is unambiguous, source-backed and currently
approved. That preserves an unknown namespace; it does not imply a catalog match.
Conflicting codes or uncertain relationships still need review. Declining that
column is allowed when another template identity remains; a code-only item still
needs a retained identity or exclusion.

Formula caches are not calculated truth. Bounded numeric-constant arithmetic can
be checked independently, but annual period and purchasing unit still need
confirmation. Cell references and Excel functions are not executed. Packaging
review preserves pairs versus pieces and box/case/bag levels; declining an optional
column cannot authorize distortion of required quantity meaning.

The exporter verifies A:M header meanings and preserves supplied headers/styles.
Approved extras append at N. Text is literal inline-string data, never an inserted
formula. Only the identification worksheet XML is populated; other template
worksheet member contents remain unchanged. ZIP container timestamps/bytes need
not be identical. AI BID SETUP and the search-URL sheets are not populated.

## Hosting and provider configuration

The app uses React/Vinext and the Sites Cloudflare runtime. The extraction route
reads `cloudflare:workers` environment bindings and authenticated Sites user
headers, then requires Origin
`https://magid-bid-normalizer.vieaura-4783.chatgpt.site`. Access is intended to remain
owner-private for the demonstration. A different domain, shared audience or
standalone matching-service deployment requires a deliberate auth/origin design.
The loopback development sign-in shim is not a production authentication service.

| Binding                           | Code behavior                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_SCOPE_MAX_ITEMS`              | Optional grouping experiment, integer 3–6; defaults to 3. See [AI processing](ai-processing.md#bounded-grouping-experiment) before live comparison |
| `AI_PROVIDER`                     | Defaults to `openai`; `gemini` selects the Gemini adapter                                                                                          |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Server credential and model; code default is `gpt-5.4-mini-2026-03-17`                                                                             |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Server credential and model; code default is `gemini-3.8-flash`                                                                                    |

These are implementation defaults, not verification of account quota, model
availability, installed secrets or deployed settings. Credentials must be runtime
secrets, never committed files or client values. There is no automatic provider
fallback. Both adapters use tool-free structured tasks and the same source checks.
OpenAI requests set `store: false`; the code's provider notice still acknowledges
possible provider retention. Gemini has a different notice and no zero-retention
claim. Account-specific zero retention is unverified and is a preference, not a
hard v1 requirement.

A PR merge updates GitHub, not the hosted site. Sites publication is a separate
operation; verify the deployed revision when collecting browser acceptance evidence.

## Bounds and diagnostics

| Bound                          | Current limit                                                        |
| ------------------------------ | -------------------------------------------------------------------- |
| Uploaded OOXML file            | 20 MiB; `.xlsx` or `.xlsm` only                                      |
| Expanded ZIP / members         | 200 MiB / 10,000 members; ZIP64 and encrypted containers unsupported |
| Worksheets / populated cells   | 50 / 1,000,000                                                       |
| Candidate/output items         | 2,000                                                                |
| Worker parse timeout           | 60 seconds                                                           |
| API JSON source request        | 350,000 bytes                                                        |
| Debug history / detail preview | 400 events / 12,000 characters; truncation is marked                 |

Macros and external links do not run. DTD/entities are rejected. Source preview is
a bounded cell window with hidden/formula indicators, not an Excel rendering engine.

`PIPELINE_DEBUG_ENABLED` in `lib/debug/trace.mjs` controls collection and the tab;
set it false and rebuild to disable it. Diagnostics are session-only and contain
source content; do not publish private traces as GitHub evidence. They show source,
staged candidates, explanations, usage when returned and readiness/readback events,
not provider reasoning. Server diagnostics arrive with stage responses rather than
as a provider live stream. Optional observers do not feed approval decisions.
