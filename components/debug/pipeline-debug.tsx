'use client';
import { useMemo, useState } from 'react';
import { finalReadiness } from '@/lib/canonical/export.mjs';
import { fields, colName } from '@/lib/workbook.mjs';
import { reviewStats } from '@/lib/ui/review.mjs';
import { stages } from '@/lib/debug/trace.mjs';
type Props = {
  trace: any;
  book: any;
  items: any[];
  initial: any[];
  columns: Record<string, string>;
  revision: number;
  generation: number;
  args: any;
  coverageSummary: any;
  downloaded: boolean;
};
export function PipelineDebug({
  trace,
  book,
  items,
  initial,
  columns,
  revision,
  generation,
  args,
  coverageSummary,
  downloaded,
}: Props) {
  const [id, setId] = useState(''),
    [stage, setStage] = useState('all');
  const record = items.find((r) => r.id === id) || items[0],
    baseline = initial.find((r) => r.id === record?.id);
  const gate = useMemo(() => {
    if (!book) return null;
    try {
      return finalReadiness(args);
    } catch (e) {
      return { issues: [], messages: [(e as Error).message] };
    }
  }, [book, items, columns, revision, generation, args.templateDigest, args.coverageConfirmed]);
  const events = trace.events
    .filter((e: any) => stage === 'all' || e.stage === stage)
    .slice()
    .reverse();
  const stats = reviewStats(items, columns, args.controller, book);
  const included = items.filter((r) => r.boundary === 'include'),
    row = record ? included.findIndex((r) => r.id === record.id) + 2 : 0;
  const outputColumn = (key: string, extra: boolean) =>
    extra
      ? colName(
          14 +
            Object.keys(columns)
              .filter((k) => columns[k] === 'approved')
              .indexOf(key),
        )
      : key;
  return (
    <section className="panel pipeline-debug">
      <div className="panel-head">
        <h2>Pipeline debug</h2>
        <span>
          Session {generation} · review revision {revision}
        </span>
      </div>
      <p>
        Temporary diagnostics. Source content stays in this tab; clearing or leaving the session
        removes this trace. AI explanations describe evidence and decisions.
      </p>
      <div className="debug-stages">
        {stages.map((s) => {
          const last = trace.latest[s];
          return (
            <button
              key={s}
              className={stage === s ? 'selected' : ''}
              onClick={() => setStage(stage === s ? 'all' : s)}
            >
              <strong>{s}</strong>
              <small>
                {s === 'readiness' && gate
                  ? gate.messages.length
                    ? 'blocked'
                    : 'ready'
                  : last?.status || 'not started'}
              </small>
            </button>
          );
        })}
      </div>
      {book && (
        <>
          <details open>
            <summary>Workbook and current readiness</summary>
            <p>
              {stats.total} total candidates · {stats.pendingItems} items pending review ·{' '}
              {stats.pendingFields} fields pending · {included.length} included ·{' '}
              {coverageSummary?.reviewed || 0}/{book.population} source cells reviewed ·{' '}
              {downloaded
                ? 'Workbook verified; download requested (receipt unconfirmed)'
                : 'No current verified workbook export'}
            </p>
            <div className="debug-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sheet</th>
                    <th>Visibility</th>
                    <th>Cells</th>
                    <th>Hidden rows</th>
                    <th>Formulas</th>
                  </tr>
                </thead>
                <tbody>
                  {book.sheets.map((s: any) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{s.hidden}</td>
                      <td>{Object.keys(s.cells).length}</td>
                      <td>{s.hiddenRows.length}</td>
                      <td>{Object.values(s.cells).filter((c: any) => c.formula).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gate?.messages.slice(0, 100).map((m: string, i: number) => (
              <p className="debug-blocker" key={i}>
                {m}
              </p>
            ))}
            {(gate?.messages.length || 0) > 100 && (
              <p>Showing the first 100 of {gate?.messages.length} blockers.</p>
            )}
            <details>
              <summary>Canonical validation issues ({gate?.issues.length || 0})</summary>
              <pre>{JSON.stringify(gate?.issues.slice(0, 100), null, 2)}</pre>
            </details>
          </details>
          <details open>
            <summary>Follow an item from source to Excel</summary>
            <label>
              Item
              <select value={record?.id || ''} onChange={(e) => setId(e.target.value)}>
                {items.map((r: any, i: number) => (
                  <option key={r.id} value={r.id}>
                    {i + 1}. {r.sheet}!{r.anchors.join(',')} ·{' '}
                    {(r.values.E?.value || 'Source occurrence').slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            {record ? (
              <>
                <p>
                  Boundary: {record.boundary} · {record.boundaryReason}
                </p>
                <div className="debug-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Field / Excel destination</th>
                        <th>Source cells and values</th>
                        <th>Initial candidate</th>
                        <th>Current value / decision</th>
                        <th>Method and explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...Object.entries(record.values).map(([k, f]) => [k, f, false]),
                        ...Object.entries(record.extras).map(([k, f]) => [k, f, true]),
                      ].map(([key, field, extra]: any) => {
                        const original = extra ? baseline?.extras[key] : baseline?.values[key];
                        const written =
                          record.boundary === 'include' && (!extra || columns[key] === 'approved');
                        return (
                          <tr key={(extra ? 'extra:' : '') + key}>
                            <td>
                              {extra ? key : fields[key]}
                              <small>
                                {written
                                  ? `${outputColumn(key, extra)}${row} (planned)`
                                  : 'Omitted unless approved and included'}
                              </small>
                            </td>
                            <td>
                              {field.evidence.length
                                ? field.evidence.map((a: string) => (
                                    <div key={a}>
                                      <code>
                                        {record.sheet}!{a}
                                      </code>
                                      <br />
                                      {book.sheets.find((s: any) => s.name === record.sheet)?.cells[
                                        a
                                      ]?.raw ?? '[missing]'}
                                      {book.sheets.find((s: any) => s.name === record.sheet)?.cells[
                                        a
                                      ]?.formula && <small>Formula evidence</small>}
                                    </div>
                                  ))
                                : 'No cited source cell'}
                            </td>
                            <td>
                              {original
                                ? original.value || '[blank]'
                                : 'Added after initial extraction'}
                            </td>
                            <td>
                              {field.value || '[blank]'}
                              <small>
                                {field.status}
                                {extra ? ' · column ' + columns[key] : ''}
                              </small>
                            </td>
                            <td>
                              {field.status === 'edited'
                                ? 'Reviewer edit'
                                : field.status === 'blank'
                                  ? 'Reviewer deliberate blank'
                                  : field.origin === 'ai'
                                    ? 'AI candidate'
                                    : field.direct
                                      ? 'Direct/rule extraction'
                                      : 'Rule or reviewer candidate'}
                              <p>{field.reason}</p>
                              {field.alternatives?.length > 0 && (
                                <details>
                                  <summary>Competing candidates</summary>
                                  <pre>{JSON.stringify(field.alternatives, null, 2)}</pre>
                                </details>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>No item candidates yet.</p>
            )}
          </details>
        </>
      )}
      <details open>
        <summary>Stage events ({events.length})</summary>
        <p>
          Events retain their original revision. Earlier events describe earlier states; current
          readiness is shown above.{' '}
          {trace.dropped > 0 &&
            `${trace.dropped} older events were trimmed. Completed stage summaries remain available.`}
        </p>
        {stage !== 'all' && <button onClick={() => setStage('all')}>Show all stages</button>}
        <div className="debug-events">
          {events.map((e: any) => (
            <article key={e.id}>
              <strong>
                {e.stage} · {e.status}
              </strong>
              <small>
                {new Date(e.time).toLocaleTimeString()} · revision {e.revision}
                {e.generation !== generation || e.revision !== revision ? ' · earlier state' : ''}
              </small>
              <p>{e.message}</p>
              <details>
                <summary>Details</summary>
                <pre>{JSON.stringify(e.detail, null, 2)}</pre>
              </details>
            </article>
          ))}
          {!events.length && (
            <p>
              No retained events for this stage. Stage summaries remain above; older history may
              have been trimmed.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
