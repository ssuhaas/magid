// Compile-only boundary checks, included by the repository TypeScript command.
import { createSessionCoordinator } from '../lib/session/coordinator.mjs';
import { parseWorkbookInWorker } from '../lib/session/parse-workbook.mjs';
import type { DecisionState } from '../lib/session/types';

declare const session: ReturnType<typeof createSessionCoordinator>;
const decision: DecisionState = session.decisionState(2);
void decision;
// @ts-expect-error Source bytes must be installed through the generation guard.
session.sourceBytes = new Uint8Array();
// @ts-expect-error Operation ownership is not directly writable by UI code.
session.operation = 'unowned';
// @ts-expect-error Publishing a download requires the controller revision and URL factory.
session.publishDownload(decision, () => 'blob:unsafe');
// @ts-expect-error Worker parsing requires an owner, source bytes, transport and progress callback.
parseWorkbookInWorker({ session });
