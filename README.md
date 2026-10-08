# Magid Bid Normalizer

A temporary-session web prototype for uploading an Excel bid proposal, normalizing
source-backed product information, reviewing exceptions and downloading the filled
Magid identification template. The output is prepared for inventory matching;
matching is a separate component.

Deterministic rules handle proven source facts first. AI starts after upload when
a provider is configured, proposes unresolved fields and independently evaluates
all item occurrences against source evidence. Unsupported information stays blank.
Reviewers handle conflicts and uncertain interpretations, with Accept, Edit, Leave
blank or item exclusion. Optional extra columns require a separate decision.

## Start here

| Guide                                            | Purpose                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)             | Current pipeline, code ownership, provider configuration and runtime limits  |
| [Verification](docs/verification.md)             | Fixture setup, automated checks and ordered browser/live-AI acceptance       |
| [Maintenance](docs/maintaining-the-prototype.md) | Approval, session, UI and export boundaries to preserve when changing code   |
| [Known limitations](docs/known-limitations.md)   | Remaining technical debt, release checks and deferred features               |
| [AI processing](docs/ai-processing.md)           | Field targeting, concurrency and reproducible offline measurements           |
| [Accuracy ledger](docs/accuracy-gaps.md)         | Confirmed packaging/identifier fixes and source-specific regression evidence |

## Development and verification

Use Node 22.13 or newer and Python 3.12. From the repository root:

```sh
npm ci
npm run verify:core
npm run dev
```

`verify:core` is the public-data check used by GitHub; it does not include the
private-workbook regressions. For full local verification, obtain the owner's
pinned fixtures and follow [the setup guide](docs/verification.md#first-setup):

```sh
npm run fixtures:setup -- --from /path/to/source-folder
npm run verify
```

`npm run build` builds the app. `npm run dev` starts a local preview; it does not
establish working live AI access. The extraction route currently requires the
hosted prototype's exact Origin and authenticated Sites request headers. See
[hosting and configuration](docs/architecture.md#hosting-and-provider-configuration)
before assuming a clean local preview can call a provider.

## What this version does and does not establish

The application keeps uploaded workbook bytes, review decisions, retry caches and
prepared downloads in temporary browser memory. The API receives bounded source
cell scopes and uses server-side credentials. App session cleanup is separate
from the configured provider's data-retention policy; zero retention is not
verified. Reloading or closing the tab loses the proposal session.

The exporter independently checks current approvals, source coverage and original
source bytes, then writes and reads back the generated workbook. It fills the
identification sheet and appends approved extra columns; the other template sheets,
including AI BID SETUP, remain unchanged.

Automated checks use controlled provider responses. Green CI is not a certification
of whole-bid accuracy, live-provider performance or a browser-saved workbook. Use
the [acceptance checklist](docs/verification.md#browser-and-live-ai-acceptance) for
Daikin, Hyundai, Berry Global, Tesla and Grainger before declaring this version
accepted. PR merges and Sites deployment are separate steps.
