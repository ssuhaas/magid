# Repeatable verification

This is the canonical setup and acceptance checklist. [Architecture](architecture.md)
describes the running pipeline; [Known limitations](known-limitations.md) separates
remaining release checks, technical debt and deferred features.

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

`tests/verification-suites.json` explicitly assigns every JavaScript test file
to `core` (no private inputs) or `workbook` (requires the pinned fixture set).
Both verification commands reject unclassified, missing or duplicate test files.
When adding a test, register it here; use the shared fixture helper for private
workbook reads instead of guessing a parent-directory path. A core test must not
depend on private data, including through another module.

`npm run verify:core` checks only the registered core files, plus TypeScript,
Python validation and the build. The GitHub workflow
runs this profile on PRs and main pushes and saves its logs/report for seven days.
Its report explicitly lists excluded test files. A green core check does **not**
mean the real-workbook suite or live AI has passed. For code changes before merging, also record
full local verification. For documentation-only changes, inspect described commands
against the source and check local links; runtime suites need not be rerun solely
for prose. GitHub still runs the core workflow. CI does not use provider keys or call a model.

If CI fails, inspect its job steps and saved logs before changing the workflow.
A job that never starts is a runner problem; a test failing after checkout is a
code or verification problem. Neither is a successful check. The 2026-10-06 main
run obtained a runner but failed because the old import-text heuristic selected
the private Tesla packaging test for core; explicit suite registration fixes that
selection error without reducing full-suite coverage.

## Browser and live AI acceptance

Use a new temporary session for each proposal. Test Grainger after review/UI or
export changes; run all five (Daikin, Hyundai, Berry Global, Tesla and Grainger)
before a release or after extraction/readiness changes. Keep this evidence table
with the release review, without publishing bid values:

| Proposal     | Source hash / code commit / deployed revision | AI completed? | Items / exceptions | Reviews required | Export / workbook check | Result / issue |
| ------------ | --------------------------------------------- | ------------- | ------------------ | ---------------- | ----------------------- | -------------- |
| Grainger     |                                               |               |                    |                  |                         |                |
| Daikin       |                                               |               |                    |                  |                         |                |
| Hyundai      |                                               |               |                    |                  |                         |                |
| Berry Global |                                               |               |                    |                  |                         |                |
| Tesla        |                                               |               |                    |                  |                         |                |

Answer these in order:

1. Does upload finish, and is the item count consistent with the source? Known
   original counts: Grainger 31, Daikin 338, Hyundai 35, Berry 76, Tesla 476.
2. Do AI extraction **and** independent source evaluation complete? Record
   elapsed time, planned/completed groups, overlap of concurrent groups, provider/model
   and token usage when returned, plus failed/retried groups. Missing token usage is
   unknown, not zero. A canceled run is not complete.
   For Berry, also check 47 deterministic skips and 29 AI items in the Pipeline
   plan (ten groups at the default setting). Skipped rows must still appear in
   preview/export. Add a description or extra code to a closed row and rerun;
   that occurrence must go to AI. No skip rule currently applies to the other four samples.
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
9. Download the actual Excel file and open it in Excel. Compare source-backed expected
   records, leading-zero identifiers, formulas/annual quantities, packaging,
   edited and blanked fields, excluded items, and approved/declined extras.
   Confirm the other template sheets are unchanged. Save the output for review.
10. Repeat one live proposal run. Compare normalized values, original occurrences,
    necessary review exceptions and source evidence. Do not require identical
    elapsed time, diagnostic timestamps, generated IDs or ZIP bytes. Explain any
    meaningful value difference before claiming repeatability.

Record **passed**, **failed**, or **blocked**, plus reproduction steps. An app
export-readback pass is useful evidence but does not prove the browser saved the
file. A download-tool timeout is blocked downloaded-file verification, not a pass.
Controlled-response tests do not certify live model accuracy; repeat live runs
and compare against source-backed expected values before claiming repeatability.
