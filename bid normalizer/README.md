# Bid normalizer

Copy this entire folder into your pipeline repository. It is a standalone Node.js
component: bid proposal Excel bytes in, normalized Magid template Excel bytes out.
It does not require the prototype UI, Next.js, Sites, browser storage or an API
call to the old web app.

## Install

Use Node.js 22.13 or newer. In this folder run:

```sh
npm ci
```

The only runtime dependencies are fflate, @xmldom/xmldom and zod. Versions and
integrities are pinned in package-lock.json. No credentials or customer proposals
are bundled. template.xlsx is the supplied Magid template.

## Call from another backend or agent

```js
import { readFile, writeFile } from 'node:fs/promises';
import { createBidNormalizer } from './bid normalizer/index.mjs';

const normalizeBid = createBidNormalizer({
  provider: 'gemini',
  key: process.env.GEMINI_API_KEY,
  // model: 'your-enabled-model',
});

const normalizedExcel = await normalizeBid(await readFile('proposal.xlsx'), {
  filename: 'proposal.xlsx',
  // signal: abortController.signal,
  // onProgress: event => console.log(event),
});

await writeFile('normalized.xlsx', normalizedExcel);
// Pass normalizedExcel bytes or normalized.xlsx to the matching agent.
```

The return value is Uint8Array containing an .xlsx workbook. There is no confidence
report, review session or issue sidecar. Configure OpenAI with provider: 'openai'
and its server-side API key instead. Credentials come from the calling backend;
never call this component in a browser with a model key.

An optional templateBytes configuration replaces the bundled template only if it
has the same identification-sheet field contract. maxItems defaults to three;
values up to six use the existing bounded grouping experiment. The component
processes at most two groups concurrently within each call. Multiple simultaneous
calls share no proposal state; the host must control overall admission/rate limits.

For TypeScript projects you can install this folder as a local file dependency:

```sh
npm install "./bid normalizer"
```

Then import createBidNormalizer from '@magid/bid-normalizer'; its declaration file
describes configuration, request options and return type.

## Call from a shell or a non-JavaScript agent

Set AI_PROVIDER and the corresponding GEMINI_API_KEY or OPENAI_API_KEY in the
server environment, then run:

```sh
node "bid normalizer/cli.mjs" proposal.xlsx normalized.xlsx
```

Optional model environment variables are GEMINI_MODEL and OPENAI_MODEL. The CLI
never accepts credentials as command-line arguments. It refuses to overwrite an
existing output or its input. Ctrl+C cancels pending model requests. Exit code zero
means the workbook was written; failures use a nonzero exit code.

## Processing contract

- Recognize the five tested layouts; preserve repeated source occurrences and
  original descriptions. Source-proven fields are protected from AI regeneration.
- Skip extraction for source-proven closed stock-list rows. Other groups run
  extraction only: this component does **not** call the independent AI evaluator.
- For an unrecognized visible sheet, use bounded source-region AI discovery.
  Discovery can split at region boundaries; complex unfamiliar layouts need
  source/output acceptance testing. An optional request.mapping with sheet, start,
  end and columns (template letter to source column) replaces automatic discovery
  when the calling pipeline already knows a layout.
- Automatically select additional source columns to retain useful identifiers,
  packaging, dated quantities and other extracted details. Column selection is an
  automated writer policy, not a human approval. The normalized A:M columns keep
  their original meanings; additions begin at N.
- Keep unsupported/conflicting fields blank. Never infer annual usage from a
  dated quantity, convert pairs to pieces, relabel unknown codes as manufacturer
  parts, execute Excel formulas or round oversized numeric scalars.
- Validate AI structure, item boundaries and quoted source evidence. Invalid
  field suggestions are omitted. Provider/structure failures reject the call;
  failed multi-item requests can split into single-item requests. No partial
  workbook is returned after a failed/canceled run.
- Preserve ambiguous source groups as separate original occurrences; do not
  invent a split or quietly drop them. The downstream evaluator owns judgments
  about those groups, semantic accuracy and confidence.
- Verify the template and exported values by readback. AI BID SETUP and other
  template worksheet contents remain unchanged.

This workbook is an automatic intermediate pipeline output. It is **not** the
prototype's human-reviewed final export. The existing UI and its strict review
gate are unchanged. Source citations establish grounding, not proof of semantic
accuracy; independent evaluation belongs to the larger pipeline.

Input limits remain 20 MiB compressed, 200 MiB expanded, and 2,000 output items.
The library works in temporary request memory; it does not save bid files, start
durable jobs, expose an HTTP endpoint or implement matching. The CLI writes only
the output path explicitly supplied by its caller. Hosts own authentication,
request limits, timeouts, transport and later queue/background-worker integration.

## Verification and maintenance

```sh
npm test
```

Tests use synthetic workbooks and controlled provider responses. Private workbook
regressions live in the original project and are not shipped here. Live model
accuracy and complete pipeline acceptance remain separate checks.

src/ is a generated snapshot of the prototype's shared runtime. Edit upstream
lib/ when maintaining this original repo and run npm run bundle:normalizer from
its root. Repository verification rejects a stale snapshot. After transferring
this folder, your shared repo owns its runtime and can maintain it independently.
