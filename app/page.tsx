'use client';
/* eslint-disable react-hooks/purity -- Clock and random IDs are used only by event handlers and session effects, never to compute rendered values. */
import {
  automateBoundaries,
  automateCoverage,
  pruneRedundantExtras,
} from '@/lib/canonical/pipeline.mjs';
import { prepareDescriptions } from '@/lib/description-policy.mjs';
import { identifierLoss } from '@/lib/identifier-retention.mjs';
import {
  declineExtraInformation,
  approveExtraInformation,
  omitProposalInformation,
} from '@/lib/canonical/omissions.mjs';
import { UploadView } from '@/components/workflow/upload-view';
import { AiProcessingPanel } from '@/components/workflow/ai-processing-panel';
import { ReviewOverview } from '@/components/workflow/review-overview';
import { ReviewItemList } from '@/components/workflow/review-item-list';
import { ReviewItemDetails } from '@/components/workflow/review-item-details';
import { DownloadView } from '@/components/workflow/download-view';
import { OutputPreview } from '@/components/review/output-preview';
import { SourcePreview } from '@/components/review/source-preview';
import { QuantityReview } from '@/components/review/quantity-review';
import { precisionProblem } from '@/lib/canonical/source-facts.mjs';
import {
  formulaReview,
  packagingReview,
  confirmPackaging,
} from '@/lib/canonical/quantity-review.mjs';
import { FieldReview } from '@/components/review/field-review';
import {
  hasProjectedIdentity,
  hasMatchingIdentity,
  stockCodeReady,
} from '@/lib/canonical/identity.mjs';
import { labels, needsReview, reviewGroups, batchFields, reviewStats } from '@/lib/ui/review.mjs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PipelineDebug } from '@/components/debug/pipeline-debug';
import { PIPELINE_DEBUG_ENABLED, createTrace } from '@/lib/debug/trace.mjs';
import parserWorkerURL from '../lib/parse.worker.ts?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ShieldCheck, AlertTriangle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  captureDecision,
  assertCurrentDecision,
  capturePipeline,
  assertCurrentPipeline,
} from '@/lib/canonical/decisions.mjs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  coverageIndex,
  coverageStats,
  currentCoverage,
  prepareCoverage,
  applyCoverage,
  approveLayout,
  checkCoverage,
  layoutSignature,
} from '@/lib/canonical/coverage.mjs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  prepareNormalization,
  runNormalization,
  finalizeNormalization,
} from '@/lib/ai/normalize-proposal.mjs';
import { createReviewController } from '@/lib/canonical/bridge.mjs';
import { mapRows, checkReady, makeRecord } from '@/lib/workbook.mjs';
import { fieldContracts } from '@/lib/canonical/field-contracts.mjs';
import { finalReadiness, exportReviewedWorkbook } from '@/lib/canonical/export.mjs';
import type { Book, Field, Item, SourceSelection } from '@/lib/review-types';
import type { ColumnMetadata } from '@/lib/ai/types';
import { createSessionCoordinator } from '@/lib/session/coordinator.mjs';
import { parseWorkbookInWorker } from '@/lib/session/parse-workbook.mjs';
export default function Home() {
  const debugTrace = useRef(createTrace());
  const initialCandidates = useRef<Item[]>([]);
  const [, setDebugTick] = useState(0);
  function debug(stage: string, status: string, message: string, detail: object = {}) {
    if (!PIPELINE_DEBUG_ENABLED) return;
    debugTrace.current.add({
      stage,
      status,
      message,
      detail,
      generation: session.current.generation,
      revision: session.current.reviewRevision,
    });
    setDebugTick((t) => t + 1);
  }

  const [sourceSelection, setSourceSelection] = useState<SourceSelection | null>(null);
  const [reviewOnly, setReviewOnly] = useState(true);
  const [showMapping, setShowMapping] = useState(false);
  const [sessionWarning, setSessionWarning] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [, setProfile] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('items');
  const [coverage, setCoverage] = useState(false);
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState('');
  const [sourcePage, setSourcePage] = useState(0);
  const [group, setGroup] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({ E: 'A' });
  const [start, setStart] = useState('2');
  const [end, setEnd] = useState('100');
  const [mergeId, setMergeId] = useState('');
  const [aiConfig, setAiConfig] = useState<{
    configured: boolean;
    model: string;
    provider: string;
    providerNotice: string;
    concurrency: number;
  } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState('');
  const [columnMeta, setColumnMeta] = useState<ColumnMetadata>({});
  const [omissionNotice, setOmissionNotice] = useState('');
  const [confirmAction, setConfirmAction] = useState<null | {
    title: string;
    message: string;
    run: () => void;
  }>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const automaticGeneration = useRef(-1);
  const session = useRef(createSessionCoordinator());
  const [saveFile, setSaveFile] = useState<{ url: string; name: string } | null>(null);
  function discardDownload() {
    session.current.invalidateDownload();
    setSaveFile(null);
  }

  const controller = useRef(createReviewController());
  const [templateHash, setTemplateHash] = useState('');
  useEffect(() => {
    const stop = new AbortController();
    fetch('/template.xlsx', { signal: stop.signal })
      .then((r) => {
        if (!r.ok) throw Error('Template unavailable.');
        return r.arrayBuffer();
      })
      .then((b) => crypto.subtle.digest('SHA-256', b))
      .then((h) => {
        if (!stop.signal.aborted)
          setTemplateHash(
            Array.from(new Uint8Array(h))
              .map((x) => x.toString(16).padStart(2, '0'))
              .join(''),
          );
      })
      .catch(() => {});
    return () => stop.abort();
  }, []);
  const [coverageTick, setCoverageTick] = useState(0);
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [disposition, setDisposition] = useState('context');
  const [sourceRole, setSourceRole] = useState('context');
  const [coveragePlan, setCoveragePlan] = useState<ReturnType<typeof prepareCoverage> | null>(null);
  useEffect(() => {
    discardDownload();
  }, [items, columns, coverageTick]);
  const groupPlan = useRef<{
    revision: number;
    generation: number;
    token: object;
    records: Item[];
  } | null>(null);
  const sourceIndex = useMemo(
    () => (book ? coverageIndex(book, items, controller.current) : null),
    [book, items],
  );
  const coverageSummary = useMemo(
    () => (sourceIndex ? coverageStats(controller.current, sourceIndex) : null),
    [sourceIndex, coverageTick],
  );
  const coverageErrors = useMemo(
    () => (sourceIndex ? checkCoverage(controller.current, sourceIndex, columns) : []),
    [sourceIndex, coverageTick, columns],
  );
  const input = useRef<HTMLInputElement>(null);
  const events = useRef<object[]>([]);
  const live = useRef({ items, columns, coverage, book, blockers: [] as string[] });
  function decisionState() {
    return session.current.decisionState(controller.current.revision);
  }
  function log(action: string, detail: object) {
    events.current.push({ id: crypto.randomUUID(), time: Date.now(), action, ...detail });
    debug('review', 'info', action, detail);
  }
  function clear(message = '') {
    session.current.reset();
    discardDownload();
    setConfirmAction(null);
    setOmissionNotice('');
    setOutputOpen(false);
    automaticGeneration.current = -1;
    setSelected('');
    setQuery('');
    setPage(0);
    setTab('items');
    setMapping({ E: 'A' });
    setStart('2');
    setEnd('100');
    setSheet('');
    setSourcePage(0);
    setProfile('');
    setWarnings([]);
    setMergeId('');
    if (input.current) input.current.value = '';
    setSourceSelection(null);
    setSessionWarning('');
    setReviewOnly(true);
    setShowMapping(false);
    debugTrace.current.clear();
    initialCandidates.current = [];
    setDebugTick((t) => t + 1);
    setAiBusy(false);
    setAiProgress('');
    setColumnMeta({});
    setBusy(false);
    events.current = [];
    controller.current = createReviewController();
    setSelectedCells([]);
    setCoveragePlan(null);
    groupPlan.current = null;
    setBook(null);
    setItems([]);
    setColumns({});
    setName('');
    setCoverage(false);
    setReason('');
    setDownloaded(false);
    setGroup('');
    setError(message);
  }
  useEffect(() => {
    const touch = () => session.current.touch();
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    const timer = setInterval(() => {
      const lifetime = session.current.lifetime();
      if (lifetime) {
        setSessionWarning(
          lifetime.remaining <= 300000
            ? lifetime.absoluteWarning
              ? 'The 8-hour session limit is approaching. Download your completed file now. This limit cannot be extended.'
              : `This temporary session ends in about ${Math.max(1, Math.ceil(lifetime.remaining / 60000))} minutes. Download your completed file before it ends.`
            : '',
        );
        if (lifetime.expired) clear('Session expired. Upload the proposal again to continue.');
      }
    }, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      session.current.dispose();
      events.current = [];
      debugTrace.current.clear();
      initialCandidates.current = [];
    };
  }, []);
  useEffect(() => {
    const stop = new AbortController();
    fetch('/api/extract', { signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (
          v &&
          typeof v === 'object' &&
          'configured' in v &&
          'model' in v &&
          typeof v.configured === 'boolean' &&
          typeof v.model === 'string'
        )
          setAiConfig({
            concurrency:
              'concurrency' in v && typeof v.concurrency === 'number' &&
              Number.isInteger(v.concurrency) && v.concurrency >= 1 && v.concurrency <= 2
                ? v.concurrency : 2,
            configured: v.configured,
            model: v.model,
            provider: 'provider' in v && typeof v.provider === 'string' ? v.provider : 'openai',
            providerNotice:
              'providerNotice' in v && typeof v.providerNotice === 'string' ? v.providerNotice : '',
          });
      })
      .catch(() => {});
    return () => stop.abort();
  }, []);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (t: object, o: object) => Promise<void> };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'read_normalization_status',
          description:
            'Read current item counts and unresolved review requirements. Does not approve or export.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: (v: unknown) => {
            if (!v || typeof v !== 'object' || Object.keys(v).length)
              throw Error('Expected an empty object.');
            const s = live.current;
            return {
              items: s.items.length,
              review: reviewStats(s.items, s.columns, null, s.book),
              blockers: s.blockers,
            };
          },
        },
        { signal: life.signal },
      ),
    ).catch(() => {});
    return () => life.abort();
  }, []);
  async function upload(file: File, confirmed = false) {
    if (session.current.sourceBytes && !confirmed) {
      setConfirmAction({
        title: 'Replace this proposal?',
        message: 'The current proposal and review decisions will be cleared.',
        run: () => void upload(file, true),
      });
      return;
    }
    clear();
    const generation = session.current.generation;
    setBusy(true);
    debug('upload', 'running', 'Checking uploaded workbook.', { name: file.name, size: file.size });
    try {
      if (!/\.(xlsx|xlsm)$/i.test(file.name))
        throw Error(
          'Upload .xlsx or .xlsm. Legacy .xls, PDFs and encrypted files are unsupported.',
        );
      if (file.size > 20 * 1024 * 1024) throw Error('Maximum upload is 20 MiB.');
      const b = new Uint8Array(await file.arrayBuffer());
      if (generation !== session.current.generation) return;
      debug('upload', 'passed', 'File checks passed.');
      debug('parse', 'running', 'Reading workbook in the parser worker.');
      const parsed = await parseWorkbookInWorker({
        session: session.current, generation, bytes: b, filename: file.name,
        debug: PIPELINE_DEBUG_ENABLED,
        createWorker: () => new Worker(parserWorkerURL, { type: 'module' }),
        progress: event => debug(event.stage, event.status, event.message, event.detail),
      });
      if (generation !== session.current.generation) return;
      const wb = parsed.workbook;
      const result = parsed.result;
      prepareDescriptions(result.records, wb);
      pruneRedundantExtras(result.records);
      controller.current.requireEvaluation();
      automateBoundaries(controller.current, result.records, wb);
      if (PIPELINE_DEBUG_ENABLED) initialCandidates.current = structuredClone(result.records);
      const sourceDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
      if (!session.current.acceptSource(generation, b, sourceDigest)) return;
      setBook(wb);
      setItems(controller.current.automate(result.records, wb));
      setSelected(result.records[0]?.id || '');
      setColumns(
        Object.fromEntries(
          [...new Set(result.records.flatMap((r: Item) => Object.keys(r.extras)))].map((k) => [
            k,
            'pending',
          ]),
        ),
      );
      setName(file.name);
      setProfile(result.profile);
      setWarnings(result.warnings);
      setSheet(wb.sheets[0]?.name || '');
      setShowMapping(!result.records.length);
      setTab((t) => (t === 'debug' ? 'debug' : result.records.length ? 'items' : 'mapping'));
      setPage(0);
      log('upload', { name: file.name, cells: wb.population });
    } catch (e) {
      if (generation === session.current.generation) {
        const message = (e as Error).message;
        setError(message);
        debug('upload', 'failed', message);
      }
    } finally {
      if (generation === session.current.generation) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (session.current.sourceBytes) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function change(id: string, fn: (r: Item) => Item, action: string, verifyFormula = false) {
    const before = items.find((r) => r.id === id);
    if (!before) return;
    const after = fn(structuredClone(before));
    controller.current.record(before, after, action);
    if (verifyFormula && book) controller.current.approveFormula(after, book, action);
    if (book) controller.current.automate([after], book);
    session.current.reviewChanged();
    setItems((prev) => prev.map((r) => (r.id === id ? after : r)));
    setDownloaded(false);
    setCoverage(false);
    log(action, {
      recordId: id,
      changes: [
        ...Object.keys(after.values).map((k) => ({
          field: k,
          before: before.values[k],
          after: after.values[k],
        })),
        ...Object.keys(after.extras).map((k) => ({
          field: k,
          before: before.extras[k],
          after: after.extras[k],
        })),
      ].filter((v) => JSON.stringify(v.before) !== JSON.stringify(v.after)),
      boundary: { before: before.boundary, after: after.boundary },
    });
  }
  function decide(id: string, key: string, status: string, extra = false) {
    change(
      id,
      (r) => {
        const f = (extra ? r.extras : r.values)[key];
        f.status = status;
        if (status === 'blank') f.value = '';
        return r;
      },
      status + ' ' + key,
    );
  }
  const stats = reviewStats(items, columns, controller.current, book);
  const filtered = items.filter(
    (r) =>
      (!reviewOnly || needsReview(r, columns, book)) &&
      JSON.stringify([
        r.sheet,
        r.section,
        ...Object.values(r.values).map((f) => f.value),
        ...Object.values(r.extras).map((f) => f.value),
      ])
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const listPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const visible = filtered.slice(listPage * 10, listPage * 10 + 10);
  const item = filtered.find((r) => r.id === selected) || filtered[0];
  const included = stats.included;
  const basicBlockers = [
    ...checkReady(items, columns, coverage, book),
    ...coverageErrors,
    ...(controller.current.evaluationRequired && !controller.current.evaluationComplete
      ? ['AI extraction and source evaluation must finish. Retry AI processing if it failed.']
      : []),
  ];
  const source = book?.sheets.find((s) => s.name === sheet);
  const cells = Object.entries(source?.cells || {});
  const scoped = filtered.filter((r) => r.boundary !== 'exclude');
  const finalBlockers = useMemo(() => {
    if (!book || basicBlockers.length) return [];
    if (!templateHash)
      return ['The template is unavailable or still loading. Reload the page to retry.'];
    return finalReadiness({
      book,
      records: items,
      columns,
      name,
      digest: session.current.sourceDigest,
      templateDigest: templateHash,
      controller: controller.current,
      columnMeta,
      coverageConfirmed: coverage,
    }).messages;
  }, [
    book,
    items,
    columns,
    name,
    columnMeta,
    coverage,
    coverageTick,
    templateHash,
    basicBlockers.length,
  ]);
  const lostIdentifiers = identifierLoss(items, columns);
  const blockers = [...new Set([...basicBlockers, ...finalBlockers])];
  useEffect(() => {
    live.current = { items, columns, coverage, book, blockers };
  }, [items, columns, coverage, book, blockers]);
  function beginGroup(value: string) {
    groupPlan.current = {
      revision: session.current.reviewRevision,
      generation: session.current.generation,
      records: structuredClone(scoped.filter((r) => batchFields(r, value, book).length)),
      token: captureDecision(decisionState()),
    };
    setGroup(value);
  }
  function batch() {
    const plan = groupPlan.current;
    if (
      !plan ||
      !plan.records.length ||
      plan.revision !== session.current.reviewRevision ||
      plan.generation !== session.current.generation
    ) {
      setError('This batch changed after its preview. Reopen it to review the current values.');
      setGroup('');
      return;
    }
    try {
      assertCurrentDecision(plan.token, decisionState());
    } catch (e) {
      setError((e as Error).message);
      setGroup('');
      return;
    }
    session.current.reviewChanged();
    const ids = new Set(plan.records.map((r) => r.id));
    const next = items.map((r) => {
      if (!ids.has(r.id)) return r;
      const c = structuredClone(r);
      if (group === 'boundaries') {
        if (!r.ambiguous) c.boundary = 'include';
      } else if (group === 'direct') {
        for (const [key] of batchFields(r, group, book)) c.values[key].status = 'accepted';
      } else if (group.startsWith('blank:')) {
        const f = c.values[group.slice(6)];
        if (f.status === 'pending') {
          f.value = '';
          f.status = 'blank';
        }
      } else if (group.startsWith('extra:')) {
        const f = c.extras[group.slice(6)];
        if (f?.status === 'pending' && !f.alternatives?.length) f.status = 'accepted';
      }
      controller.current.record(r, c, 'Scoped reviewer decision: ' + group);
      if (book) controller.current.automate([c], book);
      return c;
    });
    setItems(next);
    setCoverage(false);
    setDownloaded(false);
    log('batch', { action: group, ids: [...ids] });
    setGroup('');
  }
  async function download() {
    const token = captureDecision(decisionState());
    const generation = session.current.generation;
    if (!session.current.beginExport()) return;
    setBusy(true);
    setError('');
    debug('readiness', 'running', 'Checking current review before export.');
    try {
      if (blockers.length) throw Error(blockers.join(' '));
      const res = await fetch('/template.xlsx');
      if (!res.ok) throw Error('Template unavailable.');
      const template = new Uint8Array(await res.arrayBuffer());
      assertCurrentDecision(token, decisionState());
      if (!session.current.sourceBytes) throw Error('The source session has expired.');
      const out = await exportReviewedWorkbook({
        proposalBytes: session.current.sourceBytes,
        templateBytes: template,
        expectedSourceDigest: session.current.sourceDigest,
        records: items,
        columns,
        name,
        controller: controller.current,
        columnMeta,
        coverageConfirmed: coverage,
        observer: (e: any) => debug(e.stage, e.status, e.message, e.detail),
        assertCurrent: () => assertCurrentDecision(token, decisionState()),
      });
      const url = session.current.publishDownload(token, controller.current.revision, () =>
        URL.createObjectURL(new Blob([out], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })),
      );
      setSaveFile(null);
      setSaveFile({ url, name: name.replace(/\.(xlsx|xlsm)$/i, '') + '-normalized.xlsx' });
      setDownloaded(true);
      log('workbook prepared', { rows: included, columns });
      debug(
        'export',
        'passed',
        'Workbook generation and readback verified. Use the Save Excel file link to download.',
        { rows: included, columns },
      );
    } catch (e) {
      if (generation === session.current.generation) {
        setError((e as Error).message);
        debug('export', 'failed', (e as Error).message);
      }
    } finally {
      if (session.current.finishExport(generation)) {
        setBusy(false);
      }
    }
  }
  function splitItem() {
    session.current.reviewChanged();
    if (!item || !book) return;
    const s = book.sheets.find((s) => s.name === item.sheet)!;
    const parts = item.anchors.map((a) => {
      const r = makeRecord(s, [a], item.section) as Item;
      r.extras['Source Product ID'] = {
        value: s.cells[a]?.raw || '',
        evidence: [a],
        reason:
          'Candidate code from a split source group. Confirm the cell is a product identifier rather than context.',
        status: 'pending',
      };
      return r;
    });
    if (items.length - 1 + parts.length > 2000) {
      setError('Splitting exceeds the 2,000-item limit.');
      return;
    }
    setItems((prev) => prev.flatMap((r) => (r.id === item.id ? parts : r)));
    setSelected(parts[0]?.id || '');
    setCoverage(false);
    log('split source group', { original: item, parts });
  }
  function mergeItem() {
    session.current.reviewChanged();
    const other = items.find((r) => r.id === mergeId);
    if (!item || !other || item.id === other.id || item.sheet !== other.sheet) return;
    const merged = structuredClone(item);
    merged.anchors = [...new Set([...item.anchors, ...other.anchors])];
    merged.boundary = 'pending';
    merged.boundaryReason =
      'Merged occurrence. Review both original source regions and resolve conflicting values.';
    for (const [k, f] of Object.entries(merged.values)) {
      const second = other.values[k];
      if (second.value && second.value !== f.value) {
        f.value = [f.value, second.value].filter(Boolean).join(' | ');
        f.evidence = [...new Set([...f.evidence, ...second.evidence])];
        f.direct = false;
        f.reason = 'Merged source values differ. Edit to one justified value or leave blank.';
      }
      f.status = 'pending';
    }
    for (const [k, f] of Object.entries(other.extras)) {
      if (merged.extras[k] && merged.extras[k].value !== f.value) {
        merged.extras[k].value += ' | ' + f.value;
        merged.extras[k].evidence.push(...f.evidence);
      } else merged.extras[k] = f;
      merged.extras[k].status = 'pending';
    }
    setItems((prev) =>
      prev.filter((r) => r.id !== other.id).map((r) => (r.id === item.id ? merged : r)),
    );
    setCoverage(false);
    setMergeId('');
    log('merge items', { originals: [item, other], merged });
  }
  async function runAI(discover = false) {
    if (!book || !session.current.sourceDigest || session.current.operation) return;
    const runId = crypto.randomUUID();
    const abort = session.current.beginAI(runId);
    if (!abort) return;
    controller.current.requireEvaluation();
    setAiBusy(true);
    setAiProgress('Starting AI source checks…');
    setError('');
    discardDownload();
    const generation = session.current.generation;
    const revision = session.current.reviewRevision;
    const sourceDigest = session.current.sourceDigest;
    const pipelineToken = capturePipeline({ ...decisionState(), runId });
    const check = () => {
      if (abort.signal.aborted) throw Error('AI processing canceled.');
      assertCurrentPipeline(pipelineToken, { ...decisionState(), runId: session.current.operation });
    };
    const baseline = prepareNormalization(book, items, controller.current, columns);
    automaticGeneration.current = generation;
    try {
      const result = await runNormalization({
        book,
        baseline,
        sourceDigest,
        sessionCache: session.current.cache,
        generation,
        revision,
        discover,
        selection: { sheet, start, end },
        concurrency: aiConfig?.concurrency || 2,
        check,
        signal: abort.signal,
        observer: (event) =>
          debug(event.stage || 'ai', event.status, event.message, event.detail),
        progress: (message: string) => {
          check();
          setAiProgress(message);
        },
      });
      const { metadata, notices, issues } = result;
      const proposed = finalizeNormalization({
        book, baseline, result, controller: controller.current, columns, check,
      });
      setItems(proposed);
      setSelected(proposed[0]?.id || '');
      setColumns((prev) => ({
        ...Object.fromEntries(
          Object.entries(prev).filter(([k]) => proposed.some((r) => r.extras[k])),
        ),
        ...Object.fromEntries(
          [...new Set(proposed.flatMap((r) => Object.keys(r.extras)))]
            .filter((k) => !Object.hasOwn(prev, k))
            .map((k) => [k, 'pending']),
        ),
      }));
      setColumnMeta((prev) => ({ ...prev, ...metadata }));
      setWarnings((prev) => [
        ...new Set([...prev, ...notices, ...issues.filter((v) => !v.column).map((v) => v.reason)]),
      ]);
      setCoverage(false);
      setDownloaded(false);
      setTab((t) => (t === 'debug' ? 'debug' : 'items'));
      setAiProgress(
        'Extraction and independent source checks complete. Review only flagged exceptions.',
      );
      debug(
        'normalize',
        'applied',
        'All source groups completed; invalid field suggestions routed to exception review.',
        { items: proposed.length, fieldExceptions: issues.length },
      );
    } catch (e) {
      if (generation === session.current.generation) {
        setAiProgress(
          abort.signal.aborted
            ? 'AI processing canceled. Click Retry AI processing to resume completed stages.'
            : 'AI processing stopped. Click Retry AI processing to resume completed stages.',
        );
        setError((e as Error).message);
        debug('ai', 'failed', (e as Error).message, { completedStages: session.current.cache.stages.size });
      }
    } finally {
      if (session.current.finishAI(runId)) {
        setAiBusy(false);
      }
    }
  }

  useEffect(() => {
    if (!book || busy || aiBusy || session.current.operation) return;
    const next = structuredClone(items);
    const startRevision = controller.current.revision;
    automateBoundaries(controller.current, next, book);
    controller.current.automate(next, book);
    const result = automateCoverage(controller.current, book, next, columns);
    if (JSON.stringify(next) !== JSON.stringify(items)) setItems(next);
    if (controller.current.revision !== startRevision) {
      setCoverageTick((t) => t + 1);
      debug(
        'coverage',
        result.complete ? 'passed' : 'exceptions',
        result.complete
          ? 'Every original cell is accounted for. No manual sheet certification is required.'
          : 'Unresolved source regions remain for exception review.',
        { complete: result.complete },
      );
    }
    setCoverage(result.complete);
  }, [book, items, columns, busy, aiBusy, coverageTick]);
  useEffect(() => {
    if (
      !book ||
      busy ||
      aiBusy ||
      session.current.operation ||
      !aiConfig ||
      automaticGeneration.current === session.current.generation
    )
      return;
    automaticGeneration.current = session.current.generation;
    if (!items.length) {
      setAiProgress(
        'Choose the item rows and columns first. AI will run automatically after mapping.',
      );
      return;
    }
    if (aiConfig.configured) void runAI();
    else
      setAiProgress(
        'AI evaluation is unavailable. Deterministic source rules still run; interpretations that need verification remain as exceptions.',
      );
  }, [book, busy, aiConfig, items, aiBusy]);
  function useMapping() {
    if (!book) return;
    try {
      const r = mapRows(
        book,
        sheet,
        Number(start),
        Number(end),
        Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      );
      session.current.reviewChanged();
      if (PIPELINE_DEBUG_ENABLED) initialCandidates.current = structuredClone(r);
      controller.current = createReviewController();
      controller.current.requireEvaluation();
      debug('identify', 'passed', 'Reviewer mapping replaced item candidates.', {
        sheet,
        start,
        end,
        mapping,
        items: r.length,
      });
      automaticGeneration.current = -1;
      setItems(controller.current.automate(r, book));
      setColumns({});
      setColumnMeta({});
      setCoverage(false);
      setDownloaded(false);
      setSelected(r[0]?.id || '');
      setProfile('Reviewer-configured mapping');
      setTab('items');
      setError('');
      setPage(0);
      setReviewOnly(false);
      setQuery('');
      log('mapping', { sheet, start, end, mapping });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function fieldUI(k: string, f: Field, extra = false) {
    return (
      <FieldReview
        key={item!.id + (extra ? 'extra:' : '') + k}
        label={extra ? k : labels[k as keyof typeof labels]}
        field={f}
        acceptBlockedReason={
          !extra && k === 'K' && precisionProblem(f.value)
            ? 'Edit Annual Usage to the intended source precision or leave it blank. The original stored value cannot be accepted unchanged.'
            : !extra &&
                k === 'K' &&
                formulaReview(item, book) &&
                !controller.current.formulaVerified(item, book, f.evidence[0])
              ? 'Use the calculation review above to confirm the result and annual purchasing unit.'
              : !extra &&
                  k === 'M' &&
                  ((packagingReview(item, book) && !f.packReview) ||
                    (f.packReview && !packagingReview(item, book)) ||
                    (f.evidence.some((a) =>
                      /^\d+\s*(PR)?\/(BX|BG|DZ)$/i.test(
                        book?.sheets.find((s) => s.name === item!.sheet)?.cells[a]?.raw || '',
                      ),
                    ) &&
                      !packagingReview(item, book)))
                ? 'Confirm the count and container together using packaging review. If that review is unavailable, the source relationship no longer matches: restore the source unit/count or leave Qty/UOM blank.'
                : undefined
        }
        help={extra ? undefined : fieldContracts[k as keyof typeof fieldContracts].help}
        source={f.evidence.map((a) => ({
          address: item!.sheet + '!' + a,
          raw: book?.sheets.find((s) => s.name === item!.sheet)?.cells[a]?.raw || '',
          formula: book?.sheets.find((s) => s.name === item!.sheet)?.cells[a]?.formula,
        }))}
        onView={() =>
          setSourceSelection({
            sheet: item!.sheet,
            addresses: f.evidence.length ? f.evidence : item!.anchors,
            contextOnly: !f.evidence.length,
            label: extra ? k : labels[k as keyof typeof labels],
          })
        }
        onDecision={(status) => decide(item!.id, k, status, extra)}
        onEdit={(value) =>
          change(
            item!.id,
            (r) => {
              const field = (extra ? r.extras : r.values)[k];
              field.value = value;
              field.status = value ? 'edited' : 'blank';
              return r;
            },
            'save edit ' + k,
          )
        }
        onAlternative={(candidate) =>
          change(
            item!.id,
            (r) => {
              (extra ? r.extras : r.values)[k] = { ...candidate, status: 'pending' };
              return r;
            },
            'select suggestion ' + k,
          )
        }
      />
    );
  }
  const processingComplete = controller.current.evaluationComplete && coverage;
  const pendingColumns = stats.pendingColumns;
  const reviewed = stats.reviewed;
  const excluded = stats.excluded;
  const fieldsPending = stats.pendingFields;
  const boundariesPending = stats.pendingBoundaries;
  const selectedStats = reviewStats(item ? [item] : [], columns, null, book);
  const remaining = items.filter((r) => needsReview(r, columns, book));
  const nextTab = !items.length
    ? 'mapping'
    : remaining.length
      ? 'items'
      : pendingColumns
        ? 'columns'
        : !coverage || coverageErrors.length
          ? 'source'
          : 'export';
  const nextLabel =
    nextTab === 'mapping'
      ? 'Identify the item columns'
      : nextTab === 'items'
        ? 'Continue item review'
        : nextTab === 'columns'
          ? 'Review extra information'
          : nextTab === 'source'
            ? 'Proposal exceptions'
            : 'Preview and download';
  function goNext() {
    setTab(nextTab);
    if (nextTab === 'items' && remaining[0]) {
      setSelected(remaining[0].id);
      setQuery('');
      setPage(0);
      setReviewOnly(true);
    }
  }
  const groups = useMemo(
    () => (sourceIndex ? reviewGroups(sourceIndex, controller.current, sheet) : []),
    [sourceIndex, coverageTick, sheet],
  );
  const unconfirmedSheets = useMemo(
    () =>
      book?.sheets.filter(
        (s) =>
          !sourceIndex ||
          controller.current.layouts.get(s.name)?.signature !==
            layoutSignature(controller.current, sourceIndex, s.name),
      ) || [],
    [book, sourceIndex, coverageTick],
  );
  const pendingFields = item
    ? [
        ...Object.entries(item.values).map(([k, f]) => ({ k, f, extra: false })),
        ...Object.entries(item.extras)
          .filter(([k]) => columns[k] === 'approved')
          .map(([k, f]) => ({ k, f, extra: true })),
      ]
    : [];
  function chooseGroup(g: {
    sheet: string;
    linked: boolean;
    addresses: string[];
    start: number;
    end: number;
  }) {
    setSelectedCells(g.addresses);
    setDisposition(g.linked ? 'item' : 'context');
    setSourceRole(g.linked ? 'customer_specification' : 'context');
    setReason(
      g.linked
        ? 'I checked these source cells and they contain customer details for the included items.'
        : '',
    );
    setCoveragePlan(null);
    setTimeout(
      () =>
        document
          .getElementById('coverage-editor')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    );
  }
  const debugPanel = (
    <PipelineDebug
      trace={debugTrace.current.snapshot()}
      book={book}
      items={items}
      initial={initialCandidates.current}
      columns={columns}
      revision={session.current.reviewRevision}
      generation={session.current.generation}
      args={{
        book,
        records: items,
        columns,
        name,
        digest: session.current.sourceDigest,
        templateDigest: templateHash,
        controller: controller.current,
        columnMeta,
        coverageConfirmed: coverage,
      }}
      coverageSummary={coverageSummary}
      downloaded={downloaded}
    />
  );
  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand">
          <Layers size={24} />
          <strong>MAGID</strong>
          <span>Bid preparation</span>
        </div>
        <div className="header-actions">
          <Badge variant="outline">Prototype</Badge>
          {PIPELINE_DEBUG_ENABLED && (
            <button
              className="text-button"
              onClick={() => setTab(tab === 'debug' ? 'items' : 'debug')}
            >
              {tab === 'debug' ? 'Back to review' : 'Pipeline debug'}
            </button>
          )}
          {book && (
            <Button
              variant="ghost"
              onClick={() =>
                setConfirmAction({
                  title: 'Start over?',
                  message:
                    'This clears the proposal and all review decisions. You can upload a new proposal afterwards.',
                  run: () => clear(),
                })
              }
            >
              Start over
            </Button>
          )}
        </div>
      </header>
      <main className="workspace">
        <div className="heading">
          <h1>
            {!book
              ? 'Prepare your bid spreadsheet'
              : tab === 'debug'
                ? 'Follow the preparation process'
                : tab === 'export'
                  ? 'Your prepared spreadsheet'
                  : 'Review your proposal'}
          </h1>
          <p>
            {!book
              ? 'Upload an Excel proposal, review the information, and download the completed Magid template.'
              : 'Supported information is prepared automatically. Review the exceptions or inspect any value in the spreadsheet preview.'}
          </p>
        </div>
        <nav className="steps" aria-label="Preparation progress">
          <span className={book ? 'done' : 'current'}>
            <i>{book ? '✓' : '1'}</i>Upload
          </span>
          <button
            disabled={!book}
            aria-current={book && tab !== 'export' ? 'step' : undefined}
            className={book && tab !== 'export' ? 'current' : ''}
            onClick={() => setTab('items')}
          >
            <i>2</i>Review
          </button>
          <button
            disabled={!book}
            aria-current={tab === 'export' ? 'step' : undefined}
            className={tab === 'export' ? 'current' : ''}
            onClick={() => setTab('export')}
          >
            <i>{downloaded ? '✓' : '3'}</i>Download
          </button>
        </nav>
        <div className="session-note">
          <ShieldCheck size={18} />
          <div>
            <p>Your work is temporary. Closing or refreshing this page clears it.</p>
            <details>
              <summary>Session and privacy details</summary>
              <p>
                The session ends after 60 minutes without activity, after 8 hours, or 15 minutes
                after a download. Uploaded workbooks are not saved by this app. AI processing sends
                selected information to the configured provider.
              </p>
              {aiConfig?.providerNotice && <p>{aiConfig.providerNotice}</p>}
            </details>
          </div>
        </div>
        {sessionWarning && (
          <div className="notice" role="status">
            <p>{sessionWarning}</p>
            <Button
              variant="outline"
              disabled={sessionWarning.includes('8-hour')}
              onClick={() => {
                session.current.continueReview();
                setSessionWarning('');
              }}
            >
              Keep reviewing
            </Button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>We couldn’t complete that action.</strong>
              <p>{error}</p>
            </div>
            <Button variant="ghost" onClick={() => setError('')}>
              Dismiss
            </Button>
          </div>
        )}
        {!book ? (
          <>
            {tab === 'debug' && PIPELINE_DEBUG_ENABLED && debugPanel}
            <UploadView
              busy={busy}
              onUpload={(file) => void upload(file)}
              onChoose={() => input.current?.click()}
              onCancel={() => clear('Processing canceled. Choose a file to start again.')}
            />
          </>
        ) : (
          <>
            <ReviewOverview
              name={name}
              sheetCount={book.sheets.length}
              stats={stats}
              processingComplete={processingComplete}
              aiBusy={aiBusy}
              evaluationRequired={controller.current.evaluationRequired}
              evaluationComplete={controller.current.evaluationComplete}
              remainingCount={remaining.length}
              itemCount={items.length}
              fieldsPending={fieldsPending}
              boundariesPending={boundariesPending}
              reviewed={reviewed}
              excluded={excluded}
              pendingColumns={pendingColumns}
              coverage={coverage}
              unresolvedCells={coverageSummary?.unresolved || 0}
              blockerCount={blockers.length}
              nextLabel={nextLabel}
              onReplace={() => input.current?.click()}
              onNext={goNext}
            />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="tabs">
                <TabsTrigger value="items">Exceptions ({stats.pendingItems})</TabsTrigger>
                {Object.keys(columns).length > 0 && (
                  <TabsTrigger value="columns">
                    Extra information ({pendingColumns} decisions left)
                  </TabsTrigger>
                )}
                <TabsTrigger value="source">
                  Proposal exceptions ({coverageSummary?.unresolved || 0} cells)
                </TabsTrigger>
                {(showMapping || !items.length) && (
                  <TabsTrigger value="mapping">Identify columns</TabsTrigger>
                )}
                <TabsTrigger value="export">Download Excel</TabsTrigger>
                {PIPELINE_DEBUG_ENABLED && (
                  <TabsTrigger value="debug" className="debug-tab">
                    Pipeline debug
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="items">
                <AiProcessingPanel
                  aiBusy={aiBusy}
                  aiProgress={aiProgress}
                  retryDisabled={busy || !aiConfig?.configured || !items.length}
                  onCancel={() => session.current.cancelAI()}
                  onRetry={() => void runAI()}
                />
                <fieldset className="review-workspace" disabled={aiBusy || busy}>
                  <div className="workbench">
                    <ReviewItemList
                      stats={stats}
                      reviewed={reviewed}
                      query={query}
                      reviewOnly={reviewOnly}
                      visible={visible}
                      selected={selected}
                      columns={columns}
                      book={book}
                      processingComplete={processingComplete}
                      filteredCount={filtered.length}
                      listPage={listPage}
                      onQueryChange={(value) => {
                        setQuery(value);
                        setPage(0);
                      }}
                      onReviewOnlyChange={(value) => {
                        setReviewOnly(value);
                        setPage(0);
                      }}
                      onSelect={setSelected}
                      onPageChange={setPage}
                      onBatch={beginGroup}
                      onIdentifyColumns={() => {
                        setShowMapping(true);
                        setTab('mapping');
                      }}
                    />
                    <ReviewItemDetails
                      item={item || null}
                      items={items}
                      itemPosition={item ? items.indexOf(item) + 1 : 0}
                      totalItems={stats.total}
                      pendingFieldCount={selectedStats.pendingFields}
                      automaticallyIncluded={
                        !!(item && controller.current.boundaries.get(item.id)?.system)
                      }
                      mergeId={mergeId}
                      nextLabel={
                        item && remaining.some((r) => r.id !== item.id)
                          ? 'Next item needing review'
                          : remaining.length
                            ? 'Continue reviewing this item'
                            : nextLabel
                      }
                      onViewSource={() => {
                        if (item)
                          setSourceSelection({ sheet: item.sheet, addresses: item.anchors });
                      }}
                      onInclude={() => {
                        if (item)
                          change(item.id, (r) => ({ ...r, boundary: 'include' }), 'include item');
                      }}
                      onExclude={() => {
                        if (item)
                          change(item.id, (r) => ({ ...r, boundary: 'exclude' }), 'exclude item');
                      }}
                      onSplit={splitItem}
                      onMergeSelection={setMergeId}
                      onMerge={() =>
                        setConfirmAction({
                          title: 'Combine these items?',
                          message: 'Their information will need review again.',
                          run: mergeItem,
                        })
                      }
                      onNext={() => {
                        const next = remaining.find((r) => r.id !== item?.id);
                        if (next) {
                          setSelected(next.id);
                          setQuery('');
                          setReviewOnly(true);
                          setPage(Math.floor(remaining.indexOf(next) / 10));
                        } else goNext();
                      }}
                      onPreview={() => setOutputOpen(true)}
                      onIdentifyColumns={() => {
                        setShowMapping(true);
                        setTab('mapping');
                      }}
                    >
                      {item && item.boundary !== 'exclude' && (
                        <>
                          {stockCodeReady(item, columns, book) &&
                            !hasProjectedIdentity(item.values) && (
                              <div className="boundary">
                                <h3>
                                  {needsReview(item, columns, book)
                                    ? 'Stock code verified'
                                    : 'Ready for matching — stock code only'}
                                </h3>
                                <p>
                                  The original stock code is verified and retained in Source Product
                                  ID. Its catalog or supplier is still unknown. Unsupported
                                  descriptions and manufacturer fields remain blank; a catalog match
                                  is not guaranteed. Any remaining field and proposal checks still
                                  apply.
                                </p>
                              </div>
                            )}
                          {!hasMatchingIdentity(item, columns, book) && (
                            <div className="boundary" role="alert">
                              <h3>This item needs a usable identity</h3>
                              <p>
                                Approve the Source Product ID column to retain a verified stock
                                code. If codes conflict or their relationships are unclear, resolve
                                the item boundary or code evidence first. A supported description or
                                labeled identifier can also provide identity. Leave unsupported
                                values blank.
                              </p>
                              {fieldUI('E', item.values.E, false)}
                            </div>
                          )}
                          {book &&
                            ['K', 'L', 'M'].some((k) => item.values[k].status === 'pending') && (
                              <QuantityReview
                                key={
                                  item.id +
                                  JSON.stringify([item.values.K, item.values.L, item.values.M])
                                }
                                record={item}
                                book={book}
                                onView={(addresses) =>
                                  setSourceSelection({
                                    sheet: item.sheet,
                                    addresses,
                                    label: 'Quantity and packaging',
                                  })
                                }
                                onFormula={() => {
                                  try {
                                    change(
                                      item.id,
                                      (r) => {
                                        r.values.K.status = 'accepted';
                                        r.values.K.reason =
                                          'Reviewer confirmed independently checked arithmetic, annual period and purchasing unit ' +
                                          r.values.L.value +
                                          '.';
                                        return r;
                                      },
                                      'Confirm annual formula, period and purchasing unit',
                                      true,
                                    );
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                                onPackaging={(keepAnnual) => {
                                  try {
                                    change(
                                      item.id,
                                      (r) => confirmPackaging(r, book, keepAnnual),
                                      'Confirm packaging relationship' +
                                        (keepAnnual
                                          ? ' and annual purchasing unit'
                                          : '; annual quantity deliberately blank'),
                                      keepAnnual && !!formulaReview(item, book),
                                    );
                                  } catch (e) {
                                    setError((e as Error).message);
                                  }
                                }}
                              />
                            )}
                          <div className="section-label">
                            <h3>{selectedStats.pendingFields} fields need review</h3>
                            <p>
                              Compare each exception with the source. Unsupported fields stay blank
                              automatically. Verified source copies are already handled; review only
                              uncertain interpretations and conflicts.
                            </p>
                          </div>
                          {pendingFields
                            .filter((x) => x.f.status === 'pending')
                            .map((x) => fieldUI(x.k, x.f, x.extra))}
                          {pendingFields.some((x) => x.f.status !== 'pending') && (
                            <details className="completed-fields">
                              <summary>
                                Handled fields (
                                {pendingFields.filter((x) => x.f.status !== 'pending').length})
                              </summary>
                              {pendingFields
                                .filter((x) => x.f.status !== 'pending')
                                .map((x) => fieldUI(x.k, x.f, x.extra))}
                            </details>
                          )}
                        </>
                      )}
                    </ReviewItemDetails>
                  </div>
                </fieldset>
              </TabsContent>
              <TabsContent value="columns">
                <section className="panel">
                  <h2>Suggested extra information</h2>
                  {omissionNotice && (
                    <div className="decision-notice" role="status">
                      <Check size={20} />
                      <p>{omissionNotice}</p>
                    </div>
                  )}
                  <p>
                    The original template stays intact. Add a column only when this information will
                    help your team identify or match items.
                  </p>
                  {Object.entries(columns).map(([k, status]) => {
                    const affected = items.filter((r) => r.extras[k] && r.boundary !== 'exclude');
                    return (
                      <article className={`proposal column-${status}`} key={k}>
                        <div className="field-head">
                          <h3>{k}</h3>
                          <Badge variant="outline">
                            {status === 'approved'
                              ? 'Column added'
                              : status === 'declined'
                                ? 'Not added — decision saved'
                                : 'Needs a decision'}
                          </Badge>
                        </div>
                        <p>
                          <strong>What it contains:</strong> {columnMeta[k]?.meaning || k}
                        </p>
                        <p>
                          <strong>Why it may help:</strong>{' '}
                          {columnMeta[k]?.benefit ||
                            affected[0]?.extras[k].reason ||
                            'Preserves additional information supplied in the proposal.'}
                        </p>
                        <p>
                          {affected.length} total item values for this column
                          {status === 'approved'
                            ? ` · ${affected.filter((r) => r.extras[k].status === 'pending').length} values pending review`
                            : status === 'declined'
                              ? ' · omitted from output'
                              : ' · column decision pending'}
                          .
                        </p>
                        {k === 'Source Product ID' && (
                          <p>
                            These are supplied stock codes, not verified manufacturer part numbers.
                            You can omit this extra column. Items still need an identifying value in
                            the template; a row containing only a stock code needs that code
                            retained to remain ready for matching.
                          </p>
                        )}
                        <ul className="examples">
                          {affected.slice(0, 3).map((r) => (
                            <li key={r.id}>
                              <strong>{r.extras[k].value}</strong>
                              <small>
                                {r.sheet} · {r.extras[k].evidence.join(', ')}
                              </small>
                              <button
                                className="text-button"
                                onClick={() =>
                                  setSourceSelection({
                                    sheet: r.sheet,
                                    addresses: r.extras[k].evidence,
                                  })
                                }
                              >
                                View in proposal
                              </button>
                            </li>
                          ))}
                        </ul>
                        <details>
                          <summary>See all affected values</summary>
                          <div className="batch-preview">
                            {affected.map((r) => (
                              <p key={r.id}>
                                {r.extras[k].value}{' '}
                                <small>
                                  {r.sheet}!{r.extras[k].evidence.join(', ')}
                                </small>
                              </p>
                            ))}
                          </div>
                        </details>
                        <div className="buttons">
                          <Button
                            variant={status === 'approved' ? 'default' : 'outline'}
                            aria-pressed={status === 'approved'}
                            disabled={busy || aiBusy}
                            onClick={() => {
                              session.current.reviewChanged();
                              setColumns(
                                approveExtraInformation({
                                  columns,
                                  records: items,
                                  controller: controller.current,
                                  name: k,
                                  definition: columnMeta[k] || {},
                                }),
                              );
                              setCoverageTick((t) => t + 1);
                              setOmissionNotice(
                                `“${k}” will be added to your output. Your decision is saved.`,
                              );
                              setDownloaded(false);
                              setCoverage(false);
                              log('approve column', { name: k });
                            }}
                          >
                            {status === 'approved' && <Check size={18} />}
                            {status === 'approved' ? 'Added to output' : 'Add this column'}
                          </Button>
                          <Button
                            variant={status === 'declined' ? 'default' : 'outline'}
                            aria-pressed={status === 'declined'}
                            disabled={busy || aiBusy}
                            onClick={() => {
                              session.current.reviewChanged();
                              try {
                                const next = declineExtraInformation({
                                  book,
                                  records: items,
                                  columns,
                                  controller: controller.current,
                                  name: k,
                                  definition: columnMeta[k] || {},
                                });
                                setColumns(next);
                                setCoverageTick((t) => t + 1);
                                setDownloaded(false);
                                setCoverage(false);
                                setOmissionNotice(
                                  `“${k}” will not be added to your output. Your decision is saved.`,
                                );
                                setError('');
                                log('decline column', { name: k });
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            {status === 'declined' && <Check size={18} />}
                            {status === 'declined' ? 'Not added to output' : 'Don’t add'}
                          </Button>
                          {status === 'approved' && (
                            <Button variant="ghost" onClick={() => beginGroup('extra:' + k)}>
                              Review its values together
                            </Button>
                          )}
                        </div>
                        <small>
                          {status === 'approved'
                            ? affected.some((r) => r.extras[k].status === 'pending')
                              ? 'Review the flagged values before download. Adding the column does not accept uncertain values.'
                              : 'The retained values are already verified. No row-by-row approval is needed.'
                            : status === 'declined'
                              ? 'Decision saved. This column is omitted and its values do not need approval. You can change your choice above.'
                              : 'If you don’t add this column, its values won’t appear in the output.'}
                        </small>
                      </article>
                    );
                  })}
                  <Button onClick={goNext}>{nextLabel}</Button>
                </section>
              </TabsContent>
              <TabsContent value="source">
                <section className="panel coverage-panel">
                  <h2>Proposal exceptions</h2>
                  {omissionNotice && (
                    <div className="decision-notice" role="status">
                      <Check size={20} />
                      <p>{omissionNotice}</p>
                    </div>
                  )}
                  <p>
                    The pipeline accounts for recognized item rows, headings and source context
                    automatically. Only unresolved source regions need your attention below. Check
                    whether each contains a missed item or other information; known regions do not
                    need another approval.
                  </p>
                  {remaining.length > 0 && (
                    <div className="notice">
                      <p>
                        {stats.pendingItems} items still need review: {stats.pendingFields} pending
                        fields and {stats.pendingBoundaries} inclusion decisions. Finish these
                        first; later item changes can reopen the proposal check.
                      </p>
                      <Button variant="outline" onClick={() => setTab('items')}>
                        Return to items
                      </Button>
                    </div>
                  )}
                  {coverage && (
                    <p className="notice">
                      All original source cells are accounted for. You can continue to the prepared
                      spreadsheet.
                    </p>
                  )}
                  <ol className="coverage-steps">
                    <li>
                      <strong>Check the item list.</strong> There are {stats.total} total items:{' '}
                      {included} included, {stats.excluded} excluded and {stats.pendingItems}{' '}
                      pending review. If an item is missing, use “Add or correct missing items”
                      below.
                    </li>
                    <li>
                      <strong>Review unresolved groups only.</strong> Open a group, read its source
                      text and decide whether it is a missed product, a heading, instructions or
                      intentionally unused information.
                    </li>
                    <li>
                      <strong>Continue when exceptions are resolved.</strong> The source check
                      finishes automatically when every original cell is accounted for.
                    </li>
                  </ol>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowMapping(true);
                      setTab('mapping');
                    }}
                  >
                    Add or correct missing items
                  </Button>
                  <div className="coverage-summary">
                    <strong>
                      {coverageSummary?.reviewed} of {coverageSummary?.total} source cells checked
                    </strong>
                    <span>
                      {coverageSummary?.stale
                        ? `${coverageSummary.stale} need another look because related information changed.`
                        : ''}
                    </span>
                  </div>
                  <div className="sheet-picker">
                    {coverageSummary?.sheets.map((s: any) => (
                      <button
                        key={s.sheet}
                        className={s.sheet === sheet ? 'selected' : ''}
                        onClick={() => {
                          setSheet(s.sheet);
                          setSourcePage(0);
                          setSelectedCells([]);
                          setCoveragePlan(null);
                          setReason('');
                        }}
                      >
                        <strong>{s.sheet}</strong>
                        <small>
                          {s.unresolved
                            ? `${s.unresolved} cells to check`
                            : unconfirmedSheets.some((x) => x.name === s.sheet)
                              ? 'Confirm this sheet'
                              : 'Sheet checked'}
                          {s.hidden !== 'visible' ? ' · Hidden sheet' : ''}
                          {s.hiddenRows ? ` · ${s.hiddenRows} hidden rows` : ''}
                        </small>
                      </button>
                    ))}
                  </div>
                  {warnings.length > 0 && (
                    <details>
                      <summary>Notes from reading this proposal ({warnings.length})</summary>
                      {warnings.map((w) => (
                        <p className="notice" key={w}>
                          {w}
                        </p>
                      ))}
                    </details>
                  )}
                  <h3>{sheet}</h3>
                  <p>
                    {groups.length
                      ? `${groups.length} groups need review on this sheet.`
                      : 'All cells on this sheet have a current review decision.'}
                  </p>
                  <div className="coverage-groups">
                    {groups.slice(0, 20).map((g: any, i: number) => (
                      <article key={g.addresses.join(',')}>
                        <div>
                          <h3>
                            {g.linked
                              ? 'Information linked to items'
                              : 'Other proposal information'}
                          </h3>
                          <small>
                            Rows {g.start}
                            {g.end !== g.start ? '–' + g.end : ''} · {g.addresses.length} cells
                          </small>
                          <p>
                            {g.addresses
                              .slice(0, 3)
                              .map((a: string) => source?.cells[a]?.raw.slice(0, 90))
                              .join(' · ')}
                          </p>
                        </div>
                        <div className="buttons">
                          <Button variant="outline" onClick={() => chooseGroup(g)}>
                            Review this group
                          </Button>
                          {!g.linked && (
                            <Button
                              variant="outline"
                              disabled={busy || aiBusy}
                              onClick={() => {
                                const token = captureDecision(decisionState());
                                setConfirmAction({
                                  title: 'Leave this information out?',
                                  message: `Check the original text first. These ${g.addresses.length} cells will be marked as intentionally omitted, so they no longer block download.`,
                                  run: () => {
                                    try {
                                      assertCurrentDecision(token, decisionState());
                                      omitProposalInformation({
                                        book,
                                        records: items,
                                        columns,
                                        controller: controller.current,
                                        sheet: g.sheet,
                                        addresses: g.addresses,
                                      });
                                      session.current.reviewChanged();
                                      setCoverageTick((t) => t + 1);
                                      setCoverage(false);
                                      setDownloaded(false);
                                      setError('');
                                      setOmissionNotice(
                                        `${g.addresses.length} cells on ${g.sheet} were marked as not used. Your decision is saved.`,
                                      );
                                      log('omit proposal information', {
                                        sheet: g.sheet,
                                        addresses: g.addresses,
                                      });
                                    } catch (e) {
                                      setError((e as Error).message);
                                    }
                                  },
                                });
                              }}
                            >
                              Don’t use this information
                            </Button>
                          )}

                          <button
                            className="text-button"
                            onClick={() =>
                              setSourceSelection({ sheet: g.sheet, addresses: g.addresses })
                            }
                          >
                            View in proposal
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {groups.length > 20 && (
                    <p>Showing the first 20 groups. More will appear as you finish these.</p>
                  )}
                  <details className="manual-source">
                    <summary>Select individual cells or change a previous decision</summary>
                    <p>Use this when a suggested group contains different types of information.</p>
                    <div className="source-controls">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedCells(
                            cells.slice(sourcePage * 100, sourcePage * 100 + 100).map(([a]) => a),
                          );
                          setCoveragePlan(null);
                        }}
                      >
                        Select this page
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelectedCells([]);
                          setCoveragePlan(null);
                        }}
                      >
                        Clear selection
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Select</TableHead>
                          <TableHead>Cell</TableHead>
                          <TableHead>Original value</TableHead>
                          <TableHead>Current decision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cells.slice(sourcePage * 100, sourcePage * 100 + 100).map(([a, c]) => {
                          const d = sourceIndex
                            ? currentCoverage(controller.current, sourceIndex, sheet, a)
                            : null;
                          return (
                            <TableRow key={a}>
                              <TableCell>
                                <Checkbox
                                  aria-label={'Select ' + sheet + '!' + a}
                                  checked={selectedCells.includes(a)}
                                  onCheckedChange={(v) => {
                                    setSelectedCells((prev) =>
                                      v ? [...new Set([...prev, a])] : prev.filter((x) => x !== a),
                                    );
                                    setCoveragePlan(null);
                                  }}
                                />
                              </TableCell>
                              <TableCell>
                                {a}
                                {source?.hiddenRows.includes(a.replace(/\D/g, '')) && (
                                  <small>Hidden row</small>
                                )}
                              </TableCell>
                              <TableCell className="source-value">
                                {c.raw}
                                {c.formula && <small>Formula: {c.formula}</small>}
                              </TableCell>
                              <TableCell>
                                {d
                                  ? {
                                      item: 'Item information',
                                      header: 'Heading',
                                      context: 'Instructions or context',
                                      excluded: 'Not used',
                                    }[d.disposition as string] || d.disposition
                                  : 'Needs review'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="pagination">
                      <small>Page {sourcePage + 1}</small>
                      <Button
                        variant="ghost"
                        disabled={!sourcePage}
                        onClick={() => {
                          setSourcePage(sourcePage - 1);
                          setSelectedCells([]);
                          setCoveragePlan(null);
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={(sourcePage + 1) * 100 >= cells.length}
                        onClick={() => {
                          setSourcePage(sourcePage + 1);
                          setSelectedCells([]);
                          setCoveragePlan(null);
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  </details>
                  {selectedCells.length > 0 && (
                    <section id="coverage-editor" className="coverage-editor">
                      <h3>What does this original text represent?</h3>
                      <p>
                        Read the original values below. For linked item details, check they are the
                        customer’s requested products rather than a supplier’s quote or alternative.
                        For other text, choose its purpose. Confirming records your decision for
                        these {selectedCells.length} cells.
                      </p>
                      <div className="batch-preview">
                        {selectedCells.map((a) => (
                          <p key={a}>
                            <code>
                              {sheet}!{a}
                            </code>{' '}
                            {source?.cells[a]?.raw}
                            {source?.cells[a]?.formula && <small>Formula result</small>}
                          </p>
                        ))}
                      </div>
                      <div className="coverage-controls">
                        <label>
                          Choose the purpose of this text
                          <select
                            value={disposition}
                            onChange={(e) => {
                              setDisposition(e.target.value);
                              setSourceRole(
                                e.target.value === 'item' ? 'customer_specification' : 'context',
                              );
                              setReason(
                                e.target.value === 'item'
                                  ? 'I checked these source cells and they contain customer details for the included items.'
                                  : e.target.value === 'header'
                                    ? 'I checked these cells; they are headings or section titles, not product rows.'
                                    : e.target.value === 'context'
                                      ? 'I checked these cells; they contain instructions or context, not additional product rows.'
                                      : '',
                              );
                              setCoveragePlan(null);
                            }}
                          >
                            <option value="item">Information for included items</option>
                            <option value="header">
                              Headings or section titles — not products
                            </option>
                            <option value="context">
                              Instructions or notes — not extra products
                            </option>
                            <option value="excluded">
                              Information intentionally omitted from the output
                            </option>
                          </select>
                        </label>
                        <label>
                          Where does the information come from?
                          <select
                            value={sourceRole}
                            onChange={(e) => {
                              setSourceRole(e.target.value);
                              setReason('');
                              setCoveragePlan(null);
                            }}
                          >
                            <option value="customer_specification">
                              Customer’s requested items
                            </option>
                            <option value="context">General instructions or context</option>
                            <option value="quoted_exact">Supplier’s quoted items</option>
                            <option value="quoted_alternate">Supplier’s alternative items</option>
                            <option value="historical">Previous bid or purchase</option>
                            <option value="catalog">Catalog information</option>
                          </select>
                        </label>
                      </div>
                      <label className="coverage-label">
                        Confirmation note (you can edit this)
                        <textarea
                          value={reason}
                          onChange={(e) => {
                            setReason(e.target.value);
                            setCoveragePlan(null);
                          }}
                          placeholder="For example: These cells are the customer’s product descriptions and requested quantities."
                        />
                      </label>
                      <Button
                        disabled={!reason.trim() || selectedCells.length > 100}
                        onClick={() => {
                          try {
                            if (sourceIndex)
                              setCoveragePlan(
                                prepareCoverage(sourceIndex, {
                                  sheet,
                                  addresses: selectedCells,
                                  disposition,
                                  role: sourceRole,
                                  reason,
                                }),
                              );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Continue to confirmation
                      </Button>
                      {selectedCells.length > 100 && <p>Select up to 100 cells at a time.</p>}
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelectedCells([]);
                          setCoveragePlan(null);
                        }}
                      >
                        Cancel selection
                      </Button>
                    </section>
                  )}
                  {coveragePlan && (
                    <section className="coverage-preview">
                      <h3>Confirm your choices</h3>
                      <p>
                        {coveragePlan.cells.length} cells on {coveragePlan.sheet} will be recorded
                        as{' '}
                        <strong>
                          {
                            {
                              item: 'item information',
                              header: 'headings',
                              context: 'instructions or context',
                              excluded: 'not used in the output',
                            }[coveragePlan.disposition as string]
                          }
                        </strong>
                        .
                      </p>
                      <p>
                        <strong>Information source:</strong>{' '}
                        {
                          {
                            customer_specification: 'Customer’s requested items',
                            context: 'General instructions or context',
                            quoted_exact: 'Supplier’s quoted items',
                            quoted_alternate: 'Supplier’s alternative items',
                            historical: 'Previous bid or purchase',
                            catalog: 'Catalog information',
                          }[coveragePlan.role as string]
                        }
                      </p>
                      <p>{coveragePlan.reason}</p>
                      <small>
                        Applies to exactly:{' '}
                        {coveragePlan.cells.map((c: any) => c.address).join(', ')}
                      </small>
                      <div className="buttons">
                        <Button
                          onClick={() => {
                            try {
                              if (!sourceIndex) return;
                              applyCoverage(controller.current, sourceIndex, coveragePlan);
                              session.current.reviewChanged();
                              setCoverageTick((t) => t + 1);
                              setCoverage(false);
                              setDownloaded(false);
                              debug('review', 'passed', 'Exact source classification approved.', {
                                sheet: coveragePlan.sheet,
                                cells: coveragePlan.cells.length,
                                disposition: coveragePlan.disposition,
                                role: coveragePlan.role,
                                reason: coveragePlan.reason,
                              });
                              setCoveragePlan(null);
                              setSelectedCells([]);
                              setReason('');
                              setError('');
                            } catch (e) {
                              setError((e as Error).message);
                              setCoveragePlan(null);
                            }
                          }}
                        >
                          Confirm this source group
                        </Button>
                        <Button variant="ghost" onClick={() => setCoveragePlan(null)}>
                          Go back
                        </Button>
                      </div>
                    </section>
                  )}
                  {!groups.length && unconfirmedSheets.some((s) => s.name === sheet) && (
                    <section className="sheet-confirm">
                      <h3>Finish checking this sheet</h3>
                      <p>
                        You have classified all original cells on this sheet. Confirm that every
                        requested item is represented and that any omitted information was a
                        deliberate choice.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setReason(
                            'I checked this entire sheet. Every requested item is accounted for, and the headings, instructions and omitted information have been reviewed.',
                          )
                        }
                      >
                        Use this confirmation note
                      </Button>
                      <label>
                        Note about this sheet
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="For example: All product rows were reviewed. The remaining cells contain headings and shipping instructions."
                        />
                      </label>
                      <Button
                        disabled={
                          !reason.trim() ||
                          !!coverageSummary?.sheets.find((s: any) => s.sheet === sheet)?.unresolved
                        }
                        onClick={() => {
                          try {
                            if (!sourceIndex) return;
                            approveLayout(controller.current, sourceIndex, sheet, reason);
                            session.current.reviewChanged();
                            setCoverageTick((t) => t + 1);
                            setCoverage(false);
                            setDownloaded(false);
                            setReason('');
                            log('confirm sheet layout', { sheet, reason });
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Confirm this sheet
                      </Button>
                    </section>
                  )}
                  {coverageErrors.length > 0 && (
                    <details>
                      <summary>
                        What remains to finish this check? ({coverageErrors.length})
                      </summary>
                      {coverageErrors.map((m) => (
                        <p key={m}>{m}</p>
                      ))}
                    </details>
                  )}
                  <div className="buttons">
                    <Button
                      disabled={!!coverageErrors.length}
                      onClick={() => {
                        if (
                          sourceIndex &&
                          checkCoverage(controller.current, sourceIndex, columns).length === 0
                        ) {
                          session.current.reviewChanged();
                          setCoverage(true);
                          log('approve complete source coverage', {
                            reason: 'Reviewer confirmed all sheets and current source decisions.',
                          });
                          setTab('export');
                        }
                      }}
                    >
                      {coverage ? 'Continue to download' : 'Confirm all sheets and continue'}
                    </Button>
                  </div>
                </section>
              </TabsContent>
              <TabsContent value="mapping">
                <section className="panel">
                  <h2>Help identify the columns</h2>
                  <p>
                    Tell us where the item information is in this proposal. Preview the source
                    first, then choose the matching columns.
                  </p>
                  <div className="mapping-controls">
                    <label>
                      Sheet
                      <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                        {book.sheets.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      First item row
                      <Input
                        type="number"
                        min="1"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label>
                      Last item row
                      <Input
                        type="number"
                        min="1"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setSourceSelection({
                          sheet,
                          addresses: ['A' + (Number(start) > 0 ? start : '1')],
                        })
                      }
                    >
                      View the source rows
                    </Button>
                  </div>
                  <div className="mapping-grid">
                    {Object.entries(labels).map(([k, v]) => (
                      <label key={k}>
                        {v}
                        <select
                          value={mapping[k] || ''}
                          onChange={(e) => setMapping((p) => ({ ...p, [k]: e.target.value }))}
                        >
                          <option value="">Not supplied / leave blank</option>
                          {[...new Set(cells.map(([a]) => a.replace(/\d+$/, '')))]
                            .sort((a, b) => a.length - b.length || a.localeCompare(b))
                            .map((col) => (
                              <option key={col} value={col}>
                                {col} —{' '}
                                {(
                                  cells.find(
                                    ([a, c]) => a.replace(/\d+$/, '') === col && c.raw,
                                  )?.[1].raw || 'Column'
                                ).slice(0, 60)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p>
                    Product codes must be labeled as manufacturer part numbers in the source to use
                    those fields. Supported mapped values can proceed automatically after source
                    checks; uncertain values appear as exceptions.
                  </p>
                  <div className="buttons">
                    <Button
                      disabled={aiBusy || busy}
                      onClick={() => {
                        if (items.length)
                          setConfirmAction({
                            title: 'Replace item mapping?',
                            message:
                              'Previous item decisions will be cleared and AI will process the new mapping.',
                            run: useMapping,
                          });
                        else useMapping();
                      }}
                    >
                      Use these columns
                    </Button>
                    {!items.length && (
                      <Button
                        variant="outline"
                        disabled={aiBusy || busy || !aiConfig?.configured}
                        onClick={() => void runAI(true)}
                      >
                        Ask AI to identify items
                      </Button>
                    )}
                  </div>
                  {!items.length && (
                    <p>
                      AI can inspect up to 101 selected rows at a time. {aiConfig?.providerNotice}
                    </p>
                  )}
                </section>
              </TabsContent>
              {PIPELINE_DEBUG_ENABLED && <TabsContent value="debug">{debugPanel}</TabsContent>}
              <TabsContent value="export">
                <DownloadView
                  downloaded={downloaded}
                  blockers={blockers}
                  included={included}
                  pendingItems={stats.pendingItems}
                  addedColumns={Object.values(columns).filter((v) => v === 'approved').length}
                  remainingCount={remaining.length}
                  itemCount={items.length}
                  lostIdentifierCount={lostIdentifiers.length}
                  pendingColumns={pendingColumns}
                  coverage={coverage}
                  coverageErrorCount={coverageErrors.length}
                  unconfirmedSheetCount={unconfirmedSheets.length}
                  unresolvedCells={coverageSummary?.unresolved || 0}
                  finalBlockerCount={finalBlockers.length}
                  busy={busy}
                  aiBusy={aiBusy}
                  saveFile={saveFile}
                  onReviewExceptions={() => {
                    setTab('items');
                    setReviewOnly(true);
                    setSelected(remaining[0].id);
                    setPage(0);
                    setQuery('');
                  }}
                  onIdentifyColumns={() => {
                    setShowMapping(true);
                    setTab('mapping');
                  }}
                  onReviewColumns={() => setTab('columns')}
                  onReviewSource={() => setTab('source')}
                  onReviewAllItems={() => {
                    setReviewOnly(false);
                    setTab('items');
                  }}
                  onPreview={() => setOutputOpen(true)}
                  onDownload={() => void download()}
                  onSave={() => {
                    session.current.downloadRequested();
                    log('download requested', { rows: included });
                  }}
                  onContinueReview={() => {
                    session.current.continueReview();
                    setDownloaded(false);
                    setTab('items');
                  }}
                />
              </TabsContent>
            </Tabs>
            <Dialog
              open={!!group}
              onOpenChange={(open) => {
                if (!open) setGroup('');
              }}
            >
              <DialogContent className="batch-dialog">
                <DialogHeader>
                  <DialogTitle>Review these changes together</DialogTitle>
                  <DialogDescription>
                    {group === 'direct'
                      ? 'Accept the listed copied values. Conflicts, formulas and missing values will still need individual review.'
                      : group === 'boundaries'
                        ? 'Include the listed rows as individual items. Uncertain groups will still need review.'
                        : group.startsWith('extra:')
                          ? 'Accept the listed values for this extra column. Adding the column is a separate decision.'
                          : 'Leave the selected field blank for the listed items that still need review. Any existing pending values will be removed.'}
                  </DialogDescription>
                </DialogHeader>
                {!groupPlan.current?.records.length && (
                  <p role="status">
                    No values or item decisions qualify for this action in the current selection.
                    Close this preview to review individual fields or choose another action.
                  </p>
                )}
                <p>
                  {groupPlan.current?.records.length || 0} affected items in this selection. Close
                  this preview and use the item search to narrow the selection.
                </p>
                <div className="batch-preview">
                  {(groupPlan.current?.records || []).map((r) => (
                    <p key={r.id}>
                      <strong>
                        {r.values.E.value || r.extras['Source Product ID']?.value || 'Item'}
                      </strong>
                      <small>
                        {r.sheet}!{r.anchors.join(', ')}
                      </small>
                      {group.startsWith('blank:')
                        ? `${labels[group.slice(6) as keyof typeof labels]}: ${r.values[group.slice(6)].value || '[blank]'}`
                        : group.startsWith('extra:')
                          ? r.extras[group.slice(6)]?.value || '[not present]'
                          : group === 'boundaries'
                            ? r.ambiguous
                              ? 'Uncertain — not included by this action'
                              : 'Include item'
                            : batchFields(r, 'direct', book)
                                .map(([k, f]) => `${labels[k as keyof typeof labels]}: ${f.value}`)
                                .join(' · ')}
                    </p>
                  ))}
                </div>
                {groupPlan.current?.revision !== session.current.reviewRevision && (
                  <p role="alert">
                    The information changed since this preview opened. Close it and start a new
                    review.
                  </p>
                )}
                <Button
                  disabled={
                    !groupPlan.current?.records.length ||
                    groupPlan.current?.revision !== session.current.reviewRevision
                  }
                  onClick={batch}
                >
                  Confirm these changes
                </Button>
              </DialogContent>
            </Dialog>
          </>
        )}
        <Dialog
          open={!!confirmAction}
          onOpenChange={(v) => {
            if (!v) setConfirmAction(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmAction?.title}</DialogTitle>
              <DialogDescription>{confirmAction?.message}</DialogDescription>
            </DialogHeader>
            <div className="buttons">
              <Button variant="outline" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const run = confirmAction?.run;
                  setConfirmAction(null);
                  run?.();
                }}
              >
                {confirmAction?.title.startsWith('Start') ? 'Clear and start over' : 'Confirm'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <OutputPreview
          open={outputOpen}
          onClose={() => setOutputOpen(false)}
          items={items}
          columns={columns}
          book={book}
          onSource={setSourceSelection}
        />
        <SourcePreview
          book={book}
          selection={sourceSelection}
          onClose={() => setSourceSelection(null)}
        />
        <input
          ref={input}
          className="hidden"
          type="file"
          accept=".xlsx,.xlsm"
          aria-label="Upload bid workbook"
          onChange={(e) => {
            if (e.target.files?.[0]) void upload(e.target.files[0]);
          }}
        />
        <footer>Review source information · Download your Magid template</footer>
      </main>
    </div>
  );
}
