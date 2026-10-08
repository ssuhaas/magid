# Known limitations and next work

This is the current backlog for the transient, owner-private demonstration
prototype. Implemented source safeguards are not proof of whole-bid live accuracy.
The acceptance checklist in [Verification](verification.md#browser-and-live-ai-acceptance)
is the release gate; [the accuracy ledger](accuracy-gaps.md) records confirmed fixes.

## Before calling this version accepted

| Outstanding item               | Evidence or decision needed                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current browser acceptance     | On the deployed revision, verify upload, automatic versus exception fields, all counters, source/preview views, optional omissions, reset, queued cancellation, retry and download |
| Complete live-provider runs    | Finish extraction and independent evaluation for Daikin, Hyundai, Berry Global, Tesla and Grainger; record timings, group retries, usage where returned and exception reasons      |
| Downloaded workbook inspection | Obtain each actual browser-saved workbook, open it in Excel, compare expected source-backed values and confirm unchanged other template sheets                                     |
| Output consistency             | Repeat a live proposal run and compare normalized values, occurrences and necessary exceptions; elapsed time and ZIP bytes are not the consistency criterion                       |
| Demonstration revision         | Record source hash, code commit, deployed revision and provider/model with the acceptance evidence; a green PR check does not establish deployed behavior                          |

The existing fixture-backed verification result reported with PR #9 was 180
JavaScript cases and 37 Python cases, TypeScript and production build, with no
skipped tests; its GitHub core check also passed. Those are dated baseline results,
not a permanently current acceptance status. Run the registered suites for code
changes and attach that revision's results. The view extraction also had a one-off
render/action comparison; that is not a committed browser test suite.

## Technical debt still present

| Area                     | Remaining debt / useful next change                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page orchestration       | `app/page.tsx` still owns substantial display state, field callbacks, mapping, coverage and extra-column decisions. Extract along those feature boundaries with behavior checks; avoid relocating everything into a generic hook                                       |
| Types                    | Parsing, candidate application and canonical/controller internals still have permissive types. Derive shared contracts where possible and retain parity with runtime validation and the Python reference                                                               |
| Lint                     | The page retains React ref/effect, hook and typing findings. The PR #9 local comparison reduced page errors from 62 to 60 and warnings from 13 to 11; its six new components had none. Repository lint is not currently a passing CI gate, and these counts can change |
| UI regression automation | Domain/session tests and controlled-response regressions exist; repeatable browser interaction coverage of the assembled app remains separate work                                                                                                                     |
| Hosting coupling         | AI route Origin and Sites authentication are deployment-specific. A clean local preview or new integration host cannot be assumed to call the live route unchanged                                                                                                     |
| Capacity                 | Admission maps are isolate-local and processing lives in an open browser tab. They provide bounded concurrency, not global fairness, durable jobs or restart recovery                                                                                                  |

Read [Architecture](architecture.md) and [Maintenance](maintaining-the-prototype.md)
before changing ownership or approval boundaries. Documentation is now split by
responsibility rather than retaining historical implementation claims in the README.
Update these guides in the same PR when behavior or verification scope changes.

## Accuracy and layout coverage

Deterministic layout rules cover the supplied proposal patterns, not every Excel
bid format. Mapping and selected-region AI discovery are available for unfamiliar
layouts; ambiguous boundaries still need source rules or reviewer decisions.
Original counts are Daikin 338, Hyundai 35, Tesla 476, Grainger 31 and Berry Global
76 candidates (74 clear occurrences and two ambiguous groups). Counts alone do not
prove correct fields or complete source coverage.

Packaging, identifier namespaces, formula caches, precision and source-role
conflicts remain conservative where meaning is unsupported. The Tesla packaging
fix deliberately increased exceptions instead of inventing count conversions.
See the source expressions and regression evidence in [Accuracy gaps](accuracy-gaps.md).
Expected-record fixtures include scoped analyst-checked examples; simulated test
approvals/exclusions do not certify an entire bid's final output.

## Intentionally deferred or unresolved

| Item                                            | Scope / prerequisite                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI BID SETUP and search URLs                    | Keep the other template sheets unchanged until Shrikant clarifies fields such as LFA and branded GP percentage                                                                              |
| Matching-agent handoff                          | Define a versioned matching-ready payload and failure/ownership contract with the coworker's matching component. Catalog, distributor and manufacturer searches are not implemented here    |
| Durable multi-bid queue and background workers  | Separate follow-on design; needs a storage/retention decision, job ownership, retries and review delivery. Current concurrency does not provide this                                        |
| Persistent history, audit database and learning | Excluded from v1. No durable approvals, proposal history or automatic learning from past decisions                                                                                           |
| Client-operated or multi-reviewer access        | Requires access-control and attribution decisions beyond the current owner-private demonstration; not part of v1; demonstration ownership remains with Suhaas                               |
| Provider zero retention                         | Account-specific verification remains inconclusive. The user's preference is acknowledged, but it is not a blocking v1 requirement; app memory cleanup does not establish provider deletion |

Accuracy and reliability remain the near-term priority. There is no agreed hard
latency target. Offline field-target reductions and two-group concurrency must not
be presented as measured live performance until acceptance measurements exist.
