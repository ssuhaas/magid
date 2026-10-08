# AI processing for the client demonstration

Suhaas owns the normalization component. The first release is a demonstration for
clients and leads; subsequent deployment and handoff depend on their feedback.
There is no fixed latency target. Accuracy and source retention within the output
remain more important than processing speed. The audience is currently owner-only;
client-operated access requires a separate decision before changing that audience.

## Current processing policy

- Prepare deterministic descriptions, units, labeled identifiers and annual scalars
  first, using the existing source rules.
- Extraction receives an explicit per-record `requestedColumns` list. Source-proven
  nonempty values and human accepted, edited or deliberately blank fields are
  protected from regeneration. A forged automatic status without valid evidence
  does not protect a value.
- An automatic blank is not proof that the original source contains no useful fact.
  Those fields remain eligible for source-backed semantic extraction. Unsupported
  guesses stay blank under the existing quarantine policy.
- Recognized closed stock-list lanes can skip both AI stages under the reproducible
  `closed-stock-lane-v1` rule. Exactly one literal code, optional plain product family,
  empty adjacent cells and source-only automatic fields are required. General
  descriptions, other codes, unknown categories, formulas, hidden source and
  ambiguous boundaries cannot qualify. A copied description or automatic blank
  alone is insufficient. This currently covers Berry-style lanes, not Tesla,
  Daikin, Hyundai or Grainger narratives. New patterns need tested absence rules.
- Original source cells, headers, current values and extras remain available. The
  separate evaluator checks every remaining occurrence for boundary problems, incorrect
  candidates and source-backed information missed by the output. A discrepancy in
  a protected current value becomes an exception through `missing`.
- Skipped occurrences remain unchanged in the output. Their source proof is
  reproduced before finalization; every non-skipped baseline row needs its actual
  evaluation. All-skipped runs make zero provider calls and invent no evaluation
  verdicts. Source coverage, matching identity, optional column approval and the
  independent final Excel validators remain required.
- Validated semantic units and manufacturer names use the existing independently
  evaluated approval policy. Numerical self-reported confidence does not grant
  approval. Formulas, packaging conflicts, hidden/quote lanes, namespace ambiguity
  and precision problems remain exceptions.
- Each proposal runs at most two groups at once. Extraction then evaluation remain
  sequential within each group. Results apply in source order after all groups
  succeed. One failed, canceled or stale group prevents the entire commit and aborts
  siblings; finished stages remain in temporary memory for explicit retry.
- Timeout/oversized groups split into single-item scopes in the session queue.
  Splits preserve targeting and stable scope IDs on subsequent retries.
- Admission allows two requests per signed-in user and four per Worker isolate,
  with the existing 100 admitted requests/minute/user cap. Busy callers use bounded,
  cancellable retries. Request deadlines actively abort provider calls after 27s.

The browser must stay open. There is no durable worker queue, cross-isolate global
limit, FIFO fairness guarantee, proposal history or automatic resume after closing
or refreshing the tab. Multiple tabs share the per-user capacity where they reach
the same isolate. A durable multi-bid dashboard and background workers remain
separate future work; they require a storage decision.

## Repeatable offline measurement

```sh
node scripts/measure-ai-work.mjs /path/to/private-fixture-root
```

The root contains `attachments/` with the original five files, matching the
verification fixture setup. No workbook contents are printed. The script reproduces
upload description preparation, deterministic automation and three-item scopes.

| Proposal     | Items | Groups | Previous field targets | Targeted field targets | Reduction |
| ------------ | ----: | -----: | ---------------------: | ---------------------: | --------: |
| Daikin       |   338 |    113 |                  4,056 |                  3,049 |     24.8% |
| Hyundai      |    35 |     12 |                    420 |                    296 |     29.5% |
| Tesla        |   476 |    159 |                  5,712 |                  2,449 |     57.1% |
| Grainger     |    31 |     11 |                    372 |                    306 |     17.7% |
| Berry Global |    76 |     10 |                    912 |                    304 |     66.7% |

These counts measure fields eligible for output generation, not actual filled
values, tokens, review exceptions or wall-clock speed. Berry skips 47 source-proven
occurrences; 29 remain in ten groups, reducing planned calls from 52 to 20. Other
samples currently skip zero rows. The script separately reports skipped items and
field protection among remaining AI items. Extraction and evaluation require two
provider calls per remaining group before retries. Input context is retained;
its token count is not claimed to shrink. Two concurrent groups can reduce serial
waiting, but provider limits and retries may offset the gain.

The Tesla measurement includes the packaging exceptions recorded in [Accuracy gaps](accuracy-gaps.md).

The temporary Pipeline tab records the planned group/field counts and actual
nonnegative provider token usage when returned. It never records credentials or
provider reasoning text. Missing usage is not treated as zero.

## Bounded grouping experiment

The default remains the established three-item plan. `AI_SCOPE_MAX_ITEMS` is an
optional server binding accepting integer values 3–6; invalid or absent values
use 3. To compare the larger plan, set it to 6 and start a fresh temporary session.
This is an experiment awaiting live-provider acceptance, not an enabled speedup
on the deployed site. No reviewer setting or approval policy changes.

With the opt-in bound, adjacent records from the same sheet/section can share a
scope containing at most 36 unresolved field targets and 60,000 serialized source
bytes. Fully unresolved items therefore stay at three per group; low-work items
can share up to six. A single larger item retains all evidence and the existing
hard 350,000-byte/900-cell limit. Context is never trimmed to fit the budget.
Independent evaluation checks every occurrence without a deterministic completeness proof. Existing failure/cancellation,
single-item split, source ordering, cache binding and final export gates remain.
Changing the grouping bound invalidates the retry plan.

The offline command compares both plans after applying the same row-skipping rule:

| Proposal     | Default groups / calls | Bounded groups / calls | Planned call reduction |
| ------------ | ---------------------: | ---------------------: | ---------------------: |
| Daikin       |              113 / 226 |               87 / 174 |                  23.0% |
| Hyundai      |                12 / 24 |                10 / 20 |                  16.7% |
| Tesla        |              159 / 318 |               80 / 160 |                  49.7% |
| Grainger     |                11 / 22 |                11 / 22 |                     0% |
| Berry Global |                10 / 20 |                10 / 20 |                     0% |

These are planned calls before retries and cache reuse, not elapsed-time savings.
The script also reports serialized source payload bytes and local planning time;
these are not provider tokens or total extraction/evaluation wire bytes. Growing
candidate groups costs more local planning CPU: one observed Tesla comparison was
469 ms versus 1,339 ms. Model latency, larger output, rate limits and failed-group
splits can offset request savings. Do not promote the opt-in mode until live runs
show useful time savings without more accuracy failures or excessive retries.

The temporary Pipeline tab now includes stage-request timings and a final run
summary (elapsed processing time, observed extraction/evaluation requests, failed
requests, summed request time and final group count). Request time includes browser
request/response handling; overlapping request times cannot be added to infer wall
time. The run summary excludes upload, deterministic preparation and scope planning.
Cached stages do not emit new request timings. Summaries contain no source values,
credentials or provider reasoning. Diagnostics remain temporary and optional.

## Live-provider acceptance

For Berry, the Pipeline plan must show 76 original items, 47 deterministic skips,
29 AI items and ten default groups. Check that all 76 source occurrences remain in
the result and ambiguous groups still need review. Compare retained codes/category
and unsupported blanks against the source in the downloaded Excel file. Add a
description, second code or packaging detail to a formerly closed lane: it must
return to AI processing. These checks are pending live acceptance.

Use the ordered [browser and live AI checklist](verification.md#browser-and-live-ai-acceptance)
for all five proposals. Record elapsed time, group overlap/retries, token usage
where available, exception reasons and downloaded-workbook comparisons. Repeat a
proposal to assess normalized-value consistency. Compare default 3 against opt-in 6
using the same source, deployed code/provider/model and fresh sessions; record
actual elapsed time, stage counts, splits, rate waits and output differences. Cancellation while queued,
retry-cache reuse, replacement and stale-result rejection are part of that same
checklist; no independent acceptance status is claimed here.

Local verification covers concurrency overlap, ordered application, sibling
cancellation, targeted split retry, field-mask enforcement, per-user admission,
lease expiry, rate reset and real-workbook/export regressions. Controlled provider
responses do not establish live accuracy or performance. See [known limitations](known-limitations.md)
for the remaining release work and queue/background-worker boundaries.
