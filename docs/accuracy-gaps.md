# Confirmed accuracy gaps and acceptance status

This ledger distinguishes reproducible source errors from intentionally unresolved
business meaning. Original customer files are unchanged and remain outside Git.
Controlled AI responses establish pipeline behavior, not live provider accuracy.

## Packaging expressions missed by the Tesla conflict check

The earlier check recognized `100/BX` but missed explicit pair contents and compact
packaging shorthand. These six original recurring-sheet rows could therefore gain
a deterministic count approval despite unclear packaging levels:

| Source row | Original description expression | Purchasing unit | Stored piece count | Current result |
| --- | --- | --- | ---: | --- |
| B173 | 40 PR PER BOX | PR | 240 | Focused packaging review |
| B283 | 100 PR/CS | BG | 20 | Focused packaging review |
| B303 | 4PK | PK | 1 | Focused packaging review |
| B333 | 100BX 10B/CS | BX | 1 | Focused packaging review |
| B365 | 100BX 10BX/CA | BX | 1 | Focused packaging review |
| B376 | 100BX 10B/CS | BX | 1 | Focused packaging review |

Counts remain the original strings. The system does not replace 240 with 40, turn
pairs into pieces, or choose between box/case/bag levels. Explanations identify the
exact expression and purchasing-unit/count mismatch. Explicit pair contents remain
an exception even when the numeric count matches a table headed “Pieces”.

Matching expressions such as `50/BOX` with BX and 50 still pass the existing rule.
Words such as “BOX CUTTER”, literal dimensions and embedded catalog tokens such as
`ABC4PK` do not create packaging conflicts. This detection applies to the currently
recognized Tesla layout; it is not a universal parser for every packaging phrase.

The original 476 occurrences are preserved. Deterministic item checks now complete
410 rows, with 66 pending items and 69 pending fields, before AI. Previously the
counts were 415, 61 and 63. Six new field exceptions affect five previously automatic
rows; the sixth row already required another decision. This increase corrects missed
uncertainty rather than adding review to otherwise proven fields.

Regression: `tests/packaging-accuracy.test.mjs` uses the untouched original source,
checks exact values, controller-backed canonical readiness, targeted-AI eligibility,
pair/piece ambiguity, matching counts and negative product-token cases. Existing
Tesla aggregate expectations were updated to the corrected counts.

## Manufacturer namespace inherited across a newer heading

A constructed source-layout variation reproduced a provenance defect: the old rule
searched for the nearest *manufacturer* heading and could skip a newer distributor,
customer or generic part heading in the same column. A later `000123` code could
therefore inherit an obsolete manufacturer namespace. This is a regression case,
not a claim that the original five customer workbooks contain this layout.

The shared identifier policy now selects the nearest recognized identifier heading,
then checks its namespace. A nearer generic/distributor/customer heading blocks
manufacturer auto-acceptance. Hidden or formula-driven headings also block that
source rule. AI receives intervening identifier headings and must cite the current
manufacturer heading from the same source column; borrowing a manufacturer heading
from another column or earlier section fails validation. Leading zeros remain intact.

Regression: `tests/identifier-namespace.test.mjs` checks source automation and AI
contracts, including a valid replacement manufacturer heading and negative namespace,
hidden-header and unrelated-column cases.

## Safeguards preserved and acceptance still outstanding

- Hyundai's `200 PR/BX` cannot silently become 200 pieces. Deliberately declining an
  optional column does not authorize loss of essential packaging meaning. Existing
  focused relationship review and explicit annual blank remain available.
- Formula caches are not accepted as calculated truth. The bounded constant-only
  verifier and period/unit review remain; references and Excel functions are not
  executed. Precision problems are not corrected through inferred rounding.
- Unsupported fields remain blank. Source codes do not establish manufacturer or
  customer namespaces merely because they resemble catalog identifiers.
- Original occurrence counts remain Daikin 338, Hyundai 35, Tesla 476, Grainger 31,
  and Berry 74 clear occurrences plus two ambiguous groups (76 candidates).
- Source-backed descriptions, continuation text, codes and existing export readback
  regressions remain covered. This change does not populate AI BID SETUP.

Live extraction/evaluation reruns on all five proposals and independent inspection
of the user-downloaded workbooks remain acceptance work. Native Excel opening and
provider-output consistency are not established by local tests. See
[AI processing acceptance](ai-processing.md#acceptance-still-required-on-the-live-provider).
