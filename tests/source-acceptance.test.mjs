import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {readWorkbook,extract,checkReady,openZip} from '../lib/workbook.mjs';
import {exportReviewedWorkbook} from '../lib/canonical/export.mjs';
import {createReviewController,buildCanonical,checkCanonical} from '../lib/canonical/bridge.mjs';
import {coverageIndex,prepareCoverage,applyCoverage,approveLayout} from '../lib/canonical/coverage.mjs';

globalThis.DOMParser=DOMParser;
globalThis.XMLSerializer=XMLSerializer;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const proposal=readFileSync('../attachments/fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx');
const template=readFileSync('public/template.xlsx');
const sourceChecks=JSON.parse(readFileSync('../expected-records/checked-subset.json','utf8'));
// These are test-only simulated decisions for two analyst-checked source occurrences.
// Excluding the remainder is a fixture scope choice, never a real bid approval.
const expectations=[{anchor:'A4',code:'53YK93',size:'L'},{anchor:'A6',code:'53YK95',size:'2L'}];

function setup(){
 const book=readWorkbook(proposal),extraction=extract(book),controller=createReviewController();
 assert.equal(extraction.records.length,31);
 for(const expected of expectations){
  const source=sourceChecks.find(c=>c.case==='grainger'&&c.cell===expected.anchor);
  assert.equal(source.human_approval,false);
  assert.equal(book.sheets.find(s=>s.name===source.sheet).cells[source.cell].raw,source.expected_raw);
 }
 const records=expectations.map(expected=>{
  const r=extraction.records.find(r=>r.sheet==='Sheet1'&&r.anchors[0]===expected.anchor);
  assert.ok(r);
  assert.equal(r.extras['Source Product ID'].value,expected.code);
  const before=structuredClone(r);
  r.boundary='include';
  for(const [column,f]of Object.entries(r.values)){
   const value={E:'CONDOR High-Visibility Vest',G:expected.size,H:'CONDOR'}[column];
   f.value=value||'';
   f.status=value?'edited':'blank';
   f.evidence=value?[expected.anchor]:[];
   f.reason=value?'Test reviewer selected explicit product wording from the original narrative.':'Test reviewer deliberately left unsupported information blank.';
  }
  for(const f of Object.values(r.extras))f.status='accepted';
  controller.record(before,r,'Simulated source-backed acceptance test decision.');
  return r;
 });
 const columns={'Source Product ID':'approved'};
 controller.column('Source Product ID','approved');
 return{book,records,columns,controller};
}

function classify(s){
 const index=coverageIndex(s.book,s.records,s.controller);
 const itemAddresses=new Set(s.records.flatMap(r=>r.anchors));
 for(const sheet of s.book.sheets){
  for(const disposition of ['item','excluded']){
   const addresses=Object.keys(sheet.cells).filter(a=>(sheet.name==='Sheet1'&&itemAddresses.has(a))===(disposition==='item'));
   for(let start=0;start<addresses.length;start+=100){
    const plan=prepareCoverage(index,{sheet:sheet.name,addresses:addresses.slice(start,start+100),disposition,role:disposition==='item'?'customer_specification':'context',reason:disposition==='item'?'Test reviewer checked the selected narrative occurrence.':'Explicitly outside this two-item test fixture; not a real proposal exclusion.'});
    applyCoverage(s.controller,index,plan);
   }
  }
  approveLayout(s.controller,index,sheet.name,'Simulated review of all original cells and explicit two-item fixture exclusions.');
 }
}

function snapshot(s){
 // Reparse the immutable bytes at the export boundary, as the application does.
 return buildCanonical({...s,book:readWorkbook(proposal),name:'grainger-030926.xlsx',digest:hash(proposal),templateDigest:hash(template)});
}
const errors=s=>checkCanonical(snapshot(s),{reviewed:true,coverage:true,final:true});

test('real Grainger subset: reviewed source facts pass final validation and Excel readback',async()=>{
 const s=setup();
 assert.ok(errors(s).some(e=>e.code==='COVERAGE_REVIEW_REQUIRED'));
 classify(s);
 assert.deepEqual(errors(s),[]);
 assert.deepEqual(checkReady(s.records,s.columns,true),[]);
 const out=await exportReviewedWorkbook({...s,proposalBytes:proposal,templateBytes:template,expectedSourceDigest:hash(proposal),name:'grainger-030926.xlsx',coverageConfirmed:true}),book=readWorkbook(out);
 const sheet=book.sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');
 for(const [i,expected]of expectations.entries()){
  const row=i+2;
  assert.equal(sheet.cells['E'+row].raw,'CONDOR High-Visibility Vest');
  assert.equal(sheet.cells['G'+row].raw,expected.size);
  assert.equal(sheet.cells['H'+row].raw,'CONDOR');
  assert.equal(sheet.cells['N'+row].raw,expected.code);
  // Customer stock codes are not silently relabeled manufacturer part numbers.
  for(const column of ['B','C','D','F','I','J','K','L','M'])assert.ok(!sheet.cells[column+row]?.raw);
 }
 assert.ok(!sheet.cells.E4?.raw);
 const before=openZip(template),after=openZip(out);
 for(const name of Object.keys(before))if(name!=='xl/worksheets/sheet2.xml')assert.deepEqual(after[name],before[name],name);
});

test('real Grainger subset: description changes require renewed field and coverage decisions',()=>{
 const s=setup();classify(s);assert.deepEqual(errors(s),[]);
 const r=s.records[0],before=structuredClone(r);
 r.values.E.value='CONDOR High-Visibility Vest; reviewed wording';r.values.E.status='edited';
 s.controller.record(before,r,'Simulated reviewer changes the selected description.');
 assert.equal(r.values.H.status,'pending');
 assert.equal(r.values.G.status,'pending');
 assert.equal(r.values.I.status,'pending');
 assert.ok(errors(s).some(e=>e.code==='REVIEW_UNVERIFIED'));
 assert.ok(errors(s).some(e=>e.code==='COVERAGE_REVIEW_REQUIRED'));
 const restore=structuredClone(r);r.values.E.value=before.values.E.value;
 s.controller.record(restore,r,'Simulated reversion cannot revive dependent approvals.');
 assert.ok(errors(s).some(e=>e.code==='REVIEW_UNVERIFIED'));
});
