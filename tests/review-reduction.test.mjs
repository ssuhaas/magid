import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from './helpers/fixtures.mjs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readWorkbook,extract,checkReady,exportWorkbook} from '../lib/workbook.mjs';
import {createReviewController,buildCanonical} from '../lib/canonical/bridge.mjs';
import {automateBoundaries,automateCoverage,applyEvaluationFindings} from '../lib/canonical/pipeline.mjs';
import {coverageIndex,coverageStats} from '../lib/canonical/coverage.mjs';
import {prepareCoverage,applyCoverage,approveLayout} from '../lib/canonical/coverage.mjs';
import {exportReviewedWorkbook,finalReadiness} from '../lib/canonical/export.mjs';
import {validate} from '../lib/canonical/validator.mjs';
import {sourceDecision} from '../lib/canonical/source-policy.mjs';
import {reviewStats} from '../lib/ui/review.mjs';
import {applyExtractionIssues,applyProposal,buildScope} from '../lib/ai/client.mjs';
import {confirmPackaging} from '../lib/canonical/quantity-review.mjs';
import {sourceDate} from '../lib/date-policy.mjs';
import {processStages,requestStage,waitForSlot} from '../lib/ai/stages.mjs';
const files={tesla:'e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx',berry:'5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx',hyundai:'a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx',daikin:'8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx'};
function setup(name){const book=readWorkbook(readFileSync('../attachments/'+files[name])),records=extract(book).records,controller=createReviewController();automateBoundaries(controller,records,book);controller.automate(records,book);return {book,records,controller,columns:{},digest:'a'.repeat(64),templateDigest:'b'.repeat(64),name:name+'.xlsx'};}
test('original Tesla completes 410 item checks without per-row approvals; genuine pack conflicts, routing text and precision remain exceptions',()=>{
 const s=setup('tesla'),stats=reviewStats(s.records,{},s.controller,s.book);assert.equal(stats.total,476);assert.equal(stats.reviewed,410);assert.equal(stats.pendingItems,66);assert.equal(s.controller.fields.size,0);assert.equal(stats.automaticItems,410);
 const first=s.records[0];assert.equal(first.values.I.status,'auto_accepted');assert.equal(first.values.M.status,'auto_accepted');assert.equal(first.values.M.value,s.book.sheets.find(x=>x.name===first.sheet).cells.G5.raw);
 const conflict=s.records.find(r=>r.sheet.includes('Non Recurring')&&r.anchors[0]==='B60');assert.equal(conflict.values.M.status,'pending');assert.match(conflict.values.M.reason,/1000\/CA/);assert.equal(conflict.values.L.value,'CA');assert.equal(conflict.values.L.status,'auto_accepted');
 const precision=s.records.find(r=>r.sheet.includes('Non Recurring')&&r.anchors[0]==='B80');assert.equal(precision.values.K.status,'pending');assert.match(precision.values.K.reason,/2237\.6999999999998.*15 significant-digit/);assert.ok(checkReady(s.records,{},false,s.book).some(x=>x.includes('!I80')&&x.includes('2237.6999999999998')));
 const trimmed=s.records.find(r=>r.anchors[0]==='B33'&&r.sheet.includes('Recurring'));assert.equal(trimmed.values.I.value,'B7500-TM');assert.equal(trimmed.values.I.status,'auto_accepted');
 const result=automateCoverage(s.controller,s.book,s.records);assert.equal(result.complete,false);assert.equal(reviewStats(s.records,{},s.controller,s.book).reviewed,410,'unfinished global coverage does not erase completed item checks');assert.equal(coverageStats(s.controller,result.index).unresolved,634);
 assert.equal(sourceDecision(result.index,first.sheet,'M5').role,'quoted_exact');assert.equal(sourceDecision(result.index,first.sheet,'M6').disposition,'context');assert.equal(buildCanonical(s).run.evidence.find(e=>e.range==='M5'&&e.sheet_id==='sheet-4').formula_verified,false);
});
test('explicit count/identifier source rules reject changed headers, hidden evidence, quoted lanes, invented counts and default one',()=>{
 const s=setup('tesla'),r=s.records[0],sheet=s.book.sheets.find(x=>x.name===r.sheet),snap=buildCanonical(s);assert.equal(snap.run.items[0].fields.pack_quantity.resolution,'auto_accepted');
 for(const mutate of [b=>b.sheets.find(x=>x.name===r.sheet).cells.G4.raw='Unlabeled',b=>b.sheets.find(x=>x.name===r.sheet).hiddenRows.push('4'),b=>b.sheets.find(x=>x.name===r.sheet).cells.G5.raw='2',b=>b.sheets.find(x=>x.name===r.sheet).cells.F5.raw='BX']){const book=structuredClone(s.book);mutate(book);assert.equal(buildCanonical({...s,book}).run.items[0].fields.pack_quantity.resolution,'unresolved');}
 const changed=structuredClone(s.book);changed.sheets.find(x=>x.name===r.sheet).cells.E4.raw='Part #';assert.equal(buildCanonical({...s,book:changed}).run.items[0].fields.manufacturer_part_primary.resolution,'unresolved');
 const noCount=structuredClone(r);delete sheet.cells.G5;noCount.values.M={...noCount.values.M,value:'1',status:'pending'};s.controller.automate([noCount],s.book);assert.equal(noCount.values.M.status,'pending');
});
test('source-backed Tesla subset exports labeled identifiers and count without field approvals; both canonical validators agree',async()=>{
 const s=setup('tesla');s.records=s.records.slice(0,1);const proposalBytes=readFileSync('../attachments/'+files.tesla),templateBytes=readFileSync('public/template.xlsx'),hash=b=>createHash('sha256').update(b).digest('hex');s.digest=hash(proposalBytes);s.templateDigest=hash(templateBytes);
 const index=coverageIndex(s.book,s.records,s.controller),selected=new Set([...s.records[0].anchors,...Object.values(s.records[0].values).flatMap(f=>f.evidence)]);
 for(const sheet of s.book.sheets){for(const disposition of ['item','header','excluded']){const addresses=Object.keys(sheet.cells).filter(a=>disposition==='item'?sheet.name===s.records[0].sheet&&selected.has(a):disposition==='header'?sheet.name===s.records[0].sheet&&['E4','F4','G4','I4'].includes(a):!(sheet.name===s.records[0].sheet&&(selected.has(a)||['E4','F4','G4','I4'].includes(a))));for(let i=0;i<addresses.length;i+=100)applyCoverage(s.controller,index,prepareCoverage(index,{sheet:sheet.name,addresses:addresses.slice(i,i+100),disposition,role:disposition==='excluded'?'context':'customer_specification',reason:'Test-only one-row subset: all other cells are explicitly outside this fixture, not approved exclusions for the actual bid.'}));}approveLayout(s.controller,index,sheet.name,'Test-only one-row fixture coverage.');}
 s.coverageConfirmed=true;assert.deepEqual(finalReadiness(s).messages,[]);const snapshot=buildCanonical(s);assert.equal(s.controller.fields.size,0);assert.deepEqual(validate(snapshot.run,{final:true,trusted:snapshot.trusted}),[]);
 const trusted=Object.fromEntries(Object.entries(snapshot.trusted).map(([k,v])=>[k,[...v]])),py=`import sys,json\nsys.path.insert(0,'lib/canonical/reference')\nfrom validator import validate\nd=json.load(sys.stdin);t={}\nfor k,v in d['trusted'].items():\n if k in ('layout_approvals','review_event_ids'):t[k]=set(v)\n else:t[k]={tuple(json.loads(a)) if a.startswith('[') else a:b for a,b in v}\nprint(json.dumps(validate(d['run'],final=True,trusted=t)))\n`;
 const result=spawnSync(process.env.PYTHON || 'python3',['-c',py],{input:JSON.stringify({run:snapshot.run,trusted}),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[]);
 const output=readWorkbook(await exportReviewedWorkbook({...s,proposalBytes,templateBytes,expectedSourceDigest:s.digest})).sheets.find(x=>x.name==='AI BID IDENTIFICATION TEMPLATE');for(const column of ['I','K','L','M'])assert.equal(output.cells[column+'2'].raw,s.records[0].values[column].value);
});
test('PR versus pair from AI is equivalent for a verified mapped source unit and does not create alternatives',()=>{
 const s=setup('daikin'),r=s.records.find(r=>r.values.L.value==='PR');s.book.sheets[0].cells[r.values.L.evidence[0]].raw='PR';const scope=buildScope(s.book,[r],{digest:s.digest,scopeId:'alias'}),proposal={items:[{recordId:r.id,sheet:r.sheet,anchors:r.anchors,section:r.section,ambiguous:false,boundaryReason:'One explicit table item',fields:[{column:'L',value:'pair',kind:'normalization',identifierType:'not_identifier',reason:'Equivalent purchasing unit',evidence:[{sheet:r.sheet,cell:r.values.L.evidence[0],quote:s.book.sheets[0].cells[r.values.L.evidence[0]].raw}]}],extras:[]}],warnings:[]};
 const next=applyProposal([r],s.book,scope,{digest:s.digest,scopeId:'alias',proposal}).records[0];assert.equal(next.values.L.value,'PR');assert.equal(next.values.L.status,'auto_accepted');assert.equal(next.values.L.alternatives,undefined);
});
test('rejected unsupported AI guesses stay blank; explicit evaluator missing-source findings still require review',()=>{
 const s=setup('berry'),r=s.records.find(r=>r.anchors[0]==='B23');assert.equal(r.values.E.value,'');assert.equal(r.values.E.status,'auto_blank');applyExtractionIssues([r],[{recordId:r.id,sheet:r.sheet,anchors:r.anchors,column:'E',reason:'Unsupported guessed description rejected.'}],s.book);s.controller.automate([r],s.book);assert.equal(r.values.E.status,'auto_blank');assert.equal(r.values.E.evidence.length,0);
 applyEvaluationFindings([r],[{items:[{recordId:r.id,sheet:r.sheet,anchors:r.anchors,boundary:'supported',fields:[{column:'E',value:'',verdict:'unsupported',reason:'No description supplied.'}],missing:[]}]}],s.controller);assert.equal(r.values.E.status,'auto_blank');
 s.book.sheets[0].cells.A23={raw:'Safety eyewear',formula:null,type:'inlineStr'};applyEvaluationFindings([r],[{items:[{recordId:r.id,sheet:r.sheet,anchors:r.anchors,boundary:'supported',fields:[],missing:[{column:'E',reason:'Explicit product text needs mapping',evidence:[{cell:'A23',quote:'Safety eyewear'}]}]}]}],s.controller);assert.equal(r.values.E.status,'pending');
});
test('a fourth labeled Berry lane is extracted as a new occurrence; unlabeled new stock columns remain unresolved',()=>{
 const s=setup('berry'),sheet=s.book.sheets[0];sheet.cells.K1={raw:'Part #',type:'inlineStr',formula:null};sheet.cells.K4={raw:'TEST-NEW-LANE-001',type:'inlineStr',formula:null};sheet.cells.J4={raw:'Unlabeled neighboring information',type:'inlineStr',formula:null};const records=extract(s.book).records;assert.equal(records.length,77);const added=records.find(r=>r.anchors[0]==='K4');assert.equal(added.extras['Source Product ID'].value,'TEST-NEW-LANE-001');assert.equal(added.values.E.value,'');assert.equal(sourceDecision(coverageIndex(s.book,records,s.controller),sheet.name,'J4'),null);automateBoundaries(s.controller,records,s.book);assert.equal(added.boundary,'include');assert.equal(sourceDecision(coverageIndex(s.book,records,s.controller),sheet.name,'K4').disposition,'item');
 delete sheet.cells.K1;const original=extract(s.book).records;assert.equal(original.length,76);assert.equal(sourceDecision(coverageIndex(s.book,original,s.controller),sheet.name,'K4'),null);sheet.cells.K1={raw:'Part #',formula:'A1',type:'str'};assert.equal(extract(s.book).records.length,76);
});
test('pair packaging survives Excel as an approved source-expression column and cannot silently become pieces',()=>{
 const s=setup('hyundai'),r=s.records.find(r=>r.anchors[0]==='C52'),reviewed=confirmPackaging(r,s.book,false);assert.equal(reviewed.extras['Source Packaging'].value,'200 PR/BX');assert.equal(reviewed.extras['Source Packaging'].status,'auto_accepted');assert.ok(checkReady([reviewed],{'Source Packaging':'declined'},true,s.book).some(m=>m.includes('distinguish pairs from pieces')));
 const output=readWorkbook(exportWorkbook(readFileSync('public/template.xlsx'),[reviewed],{'Source Packaging':'approved'})).sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');assert.equal(output.cells.L2.raw,'BX');assert.equal(output.cells.M2.raw,'200');assert.equal(output.cells.N1.raw,'Source Packaging');assert.equal(output.cells.N2.raw,'200 PR/BX');reviewed.values.M.value='';assert.ok(!checkReady([reviewed],{'Source Packaging':'declined'},true,s.book).some(m=>m.includes('distinguish pairs')));
});
test('Excel date system and explicit formatting yield readable dates while ambiguous text and serial leap-day remain untouched',()=>{
 const s=setup('daikin');assert.equal(s.book.sheets[0].cells.J7.raw,'45659');assert.equal(s.records[0].extras['Source Date'].value,'2025-01-02');assert.equal(s.records[0].extras['Source Date'].status,'auto_accepted');const cell={raw:'0',numberFormat:'yyyy-mm-dd',formula:null};assert.equal(sourceDate(cell,true),'1904-01-01');assert.equal(sourceDate({...cell,raw:'60'}),null);assert.equal(sourceDate({...cell,raw:'45659',numberFormat:null}),null);assert.equal(sourceDate({...cell,raw:'27-Agu'}),null);assert.equal(sourceDate({...cell,raw:'45659',formula:'TODAY()'}),null);
});
test('busy uploads resume the same stage, distinguish quota errors, and can cancel a slot wait',async()=>{
 const scope={scopeId:'busy-scope',digest:'a'.repeat(64)},cache=new Map(),progress=[],signal=new AbortController();let calls=0;
 const result=await processStages(scope,{cache,check:()=>{},progress:(stage,message)=>progress.push([stage,message]),send:async()=>{if(++calls===1){const e=Error('Waiting for another proposal');e.code='SESSION_BUSY';e.retryAfter=1;throw e;}return {...scope,proposal:{items:[]},evaluation:{items:[]}};}});assert.equal(calls,3);assert.ok(progress.some(([stage])=>stage==='waiting'));assert.ok(result.evaluation);assert.equal(cache.size,1);
 await assert.rejects(requestStage('extract',scope,{fetchImpl:async()=>Response.json({error:'Quota exhausted'}, {status:429})}),e=>e.status===429&&!e.code);
 await assert.rejects(requestStage('extract',scope,{fetchImpl:async()=>Response.json({error:'Slot busy',code:'SESSION_BUSY'},{status:429,headers:{'Retry-After':'7'}})}),e=>e.code==='SESSION_BUSY'&&e.retryAfter===7);
 const waiting=waitForSlot(10000,signal.signal);signal.abort();await assert.rejects(waiting,/canceled/);
});
