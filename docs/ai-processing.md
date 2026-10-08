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
- Original source cells, headers, current values and extras remain available. The
  separate evaluator still checks every occurrence for boundary problems, incorrect
  candidates and source-backed information missed by the output. A discrepancy in
  a protected current value becomes an exception through `missing`.
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
| Berry Global |    76 |     26 |                    912 |                    821 |     10.0% |

These counts measure fields eligible for output generation, not actual filled
values, tokens, review exceptions or wall-clock speed. Extraction and evaluation
still require two provider calls per group before retries. Input context is retained;
its token count is not claimed to shrink. Two concurrent groups can reduce serial
waiting, but provider limits and retries may offset the gain.

The Tesla measurement includes the packaging exceptions recorded in [Accuracy gaps](accuracy-gaps.md).

The temporary Pipeline tab records the planned group/field counts and actual
nonnegative provider token usage when returned. It never records credentials or
provider reasoning text. Missing usage is not treated as zero.

## Live-provider acceptance

Use the ordered [browser and live AI checklist](verification.md#browser-and-live-ai-acceptance)
for all five proposals. Record elapsed time, group overlap/retries, token usage
where available, exception reasons and downloaded-workbook comparisons. Repeat a
proposal to assess normalized-value consistency. Cancellation while queued,
retry-cache reuse, replacement and stale-result rejection are part of that same
checklist; no independent acceptance status is claimed here.

Local verification covers concurrency overlap, ordered application, sibling
cancellation, targeted split retry, field-mask enforcement, per-user admission,
lease expiry, rate reset and real-workbook/export regressions. Controlled provider
responses do not establish live accuracy or performance. See [known limitations](known-limitations.md)
for the remaining release work and queue/background-worker boundaries.
