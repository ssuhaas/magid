# Repeatable verification

## First setup

Use Node 22.13 or newer and Python 3.12. From the repository root:

```sh
npm ci
npm run fixtures:setup -- --from /path/to/source-folder
npm run verify
```

The source folder must contain `attachments/` and `expected-records/` with the
paths listed in `tests/fixture-manifest.json`. Ask the project owner for this
private fixture set. The setup command checks all 11 files against pinned SHA-256
hashes before copying them into ignored `tests/fixtures/`. It does not download
files or upload them to GitHub. To use the source folder directly instead:

```sh
MAGID_FIXTURE_ROOT=/path/to/source-folder npm run verify
```

Set `PYTHON` to the Python executable if it is not named `python3`. No additional
Python packages or model API key are needed for these checks.

## After each change

Run `npm run verify`. It fails on missing or changed fixtures, then checks all
JavaScript tests, TypeScript, the independent Python validator and the production
build. It stops on the first failed stage and returns a nonzero exit code.

The generated `.verification/full-*/report.json` records the source commit,
whether there were uncommitted changes, runtime version, fixture hashes, selected
test files, stage results and timing. Logs sit beside it. These files are ignored
by Git; reference the results in the PR, keeping private bid data out of public
attachments. A dirty-source result describes local edits, not just its commit.

Do not regenerate expected records simply to make a failing test pass. Inspect
the original source, explain any intended expectation change, and review changed
expected records and manifest hashes together.

## GitHub checks

`npm run verify:core` checks only the test files that do not require private
fixtures, plus TypeScript, Python validation and the build. The GitHub workflow
runs this profile on PRs and main pushes and saves its logs/report for seven days.
Its report explicitly lists excluded test files. A green core check does **not**
mean the real-workbook suite or live AI has passed. Before merging, also record
the full local verification result. CI does not use provider keys or call a model.

## Browser and live AI acceptance

Use a new temporary session for each proposal. Test Grainger after review/UI or
export changes; run all five (Daikin, Hyundai, Berry Global, Tesla and Grainger)
before a release or after extraction/readiness changes. Keep this evidence table
with the release review, without publishing bid values:

| Proposal | Source hash / code commit | AI completed? | Items / exceptions | Reviews required | Export / workbook check | Result / issue |
| --- | --- | --- | --- | --- | --- | --- |
| Grainger | | | | | | |
| Daikin | | | | | | |
| Hyundai | | | | | | |
| Berry Global | | | | | | |
| Tesla | | | | | | |

Answer these in order:

1. Does upload finish, and is the item count consistent with the source? Known
   original counts: Grainger 31, Daikin 338, Hyundai 35, Berry 76, Tesla 476.
2. Do AI extraction **and** independent source evaluation complete? Record
   elapsed time and any failed/retried groups. A canceled run is not complete.
3. Are direct supported values automatic and unsupported fields blank? Inspect
   known source-backed examples, not only the absence of warnings.
4. For a real exception, does View in proposal show the original cell? Does
   Accept/Edit/Leave blank update every relevant pending count? Check an edited
   or blanked dependent quantity again; it must not retain stale approval.
5. Are optional columns explained? Does declining show a selected button and
   saved notice, remove that approval task, and omit the column from output?
   Re-adding must restore any needed source checks. Pair/piece meaning and
   code-only item identity must still be preserved or deliberately blanked.
6. Does omitting an unlinked instruction require confirmation? Cancel must keep
   it unresolved; confirm must show saved feedback and clear its source count.
7. Start a second proposal while one processes. Cancel the queued AI run: the
   message must say canceled, with no “will resume” promise. Retry must show
   current progress and resume cached completed stages. Start over must clear
   values, counters and old notices. Use separate test tabs, not someone’s work.
8. Is download blocked before required checks finish and enabled afterwards?
   Does the spreadsheet preview show each value’s evidence and explanation?
9. Download the actual Excel file and open it. Compare source-backed expected
   records, leading-zero identifiers, formulas/annual quantities, packaging,
   edited and blanked fields, excluded items, and approved/declined extras.
   Confirm the other template sheets are unchanged. Save the output for review.

Record **passed**, **failed**, or **blocked**, plus reproduction steps. An app
export-readback pass is useful evidence but does not prove the browser saved the
file. A download-tool timeout is blocked downloaded-file verification, not a pass.
Controlled-response tests do not certify live model accuracy; repeat live runs
and compare against source-backed expected values before claiming repeatability.
