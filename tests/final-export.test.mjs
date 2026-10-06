import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from './helpers/fixtures.mjs';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {readWorkbook,extract,openZip} from '../lib/workbook.mjs';
import {createReviewController} from '../lib/canonical/bridge.mjs';
import {coverageIndex,prepareCoverage,applyCoverage,approveLayout} from '../lib/canonical/coverage.mjs';
import {finalReadiness,exportReviewedWorkbook} from '../lib/canonical/export.mjs';

globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const hash=b=>createHash('sha256').update(b).digest('hex');
const templateBytes=readFileSync('public/template.xlsx');
const checked=JSON.parse(readFileSync('../expected-records/checked-subset.json','utf8'));
const cases={
 daikin:{path:'8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx',anchors:['D7'],count:338},
 hyundai:{path:'a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx',anchors:['C19','C33','C52'],count:35},
 tesla:{path:'e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx',anchors:['B60'],sheet:'6| Bundled Bid-Non Recurring ',count:476},
 berry:{path:'5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx',anchors:['B4'],count:76}
};

// Simulated decisions for scoped analyst-checked occurrences, never whole-bid gold labels.
function setup(name){
 const spec=cases[name],proposalBytes=readFileSync('../attachments/'+spec.path),book=readWorkbook(proposalBytes),all=extract(book).records;
 assert.equal(all.length,spec.count);
 for(const c of checked.filter(c=>c.case===name))assert.equal(book.sheets.find(s=>s.name===c.sheet).cells[c.cell]?.raw,c.expected_raw,c.cell);
 const controller=createReviewController(),records=spec.anchors.map(anchor=>all.find(r=>r.anchors[0]===anchor&&(!spec.sheet||r.sheet===spec.sheet)));
 for(const r of records){
  assert.ok(r);const before=structuredClone(r);r.boundary='include';
  // Preserve incompatible packaging evidence in the source description; do not select a count.
  if(name==='tesla')r.values.M.value='';
  // The fixture reviewer explicitly chooses the original heading as a coarse description.
  if(name==='berry'){r.values.E.value=book.sheets[0].cells.A3.raw;r.values.E.evidence=['A3'];r.values.E.reason='Test reviewer uses the original Goggles heading as the description; original stock code is retained separately.';}
  if(name==='hyundai'&&r.anchors[0]==='C52'){
   // 200 PR/BX counts pairs; no pieces-per-pair conversion or guessed annual unit.
   r.extras['Source Packaging']={value:book.sheets[0].cells.G52.raw,evidence:['G52'],reason:'Preserves the original pair-per-box expression without converting pairs into pieces.',status:'pending'};
   r.values.K.value='';r.values.L.value='';r.values.M.value='';
  }
  for(const f of Object.values(r.values)){f.status=f.value?'accepted':'blank';if(!f.value)f.evidence=[];}
  if(name==='berry')r.values.E.status='edited';
  for(const f of Object.values(r.extras))f.status='accepted';
  controller.record(before,r,'Simulated reviewer accepts original facts and deliberately blanks unsupported or conflicting facts.');
 }
 const columns=Object.fromEntries([...new Set(records.flatMap(r=>Object.keys(r.extras)))].map(k=>[k,'approved']));
 for(const k of Object.keys(columns))controller.column(k,'approved');
 return{book,records,columns,controller,proposalBytes,templateBytes,name:name+'.xlsx',digest:hash(proposalBytes),expectedSourceDigest:hash(proposalBytes),templateDigest:hash(templateBytes),coverageConfirmed:true};
}

function coverage(s){
 const index=coverageIndex(s.book,s.records,s.controller);
 for(const sheet of s.book.sheets){
  const selected=new Set(s.records.filter(r=>r.sheet===sheet.name&&r.boundary==='include').flatMap(r=>[...r.anchors,...Object.values(r.values).flatMap(f=>f.evidence),...Object.values(r.extras).flatMap(f=>f.evidence)]));
  for(const disposition of ['item','excluded']){
   const addresses=Object.keys(sheet.cells).filter(a=>selected.has(a)===(disposition==='item'));
   for(let i=0;i<addresses.length;i+=100)applyCoverage(s.controller,index,prepareCoverage(index,{sheet:sheet.name,addresses:addresses.slice(i,i+100),disposition,role:disposition==='item'?'customer_specification':'context',reason:disposition==='item'?'Simulated reviewer checked the selected occurrence and exact field evidence.':'Outside this test fixture only; this is not a real proposal exclusion.'}));
  }
  approveLayout(s.controller,index,sheet.name,'Simulated full-inventory review with explicit fixture-only exclusions.');
 }
}

for(const name of Object.keys(cases))test(name+' source subset passes the production final export gate and readback',async()=>{
 const s=setup(name);
 await assert.rejects(exportReviewedWorkbook(s),/Finish review/);
 coverage(s);
 assert.deepEqual(finalReadiness(s).messages,[]);
 const output=await exportReviewedWorkbook(s),sheet=readWorkbook(output).sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');
 assert.equal(Object.keys(sheet.cells).filter(a=>/^A[2-9]\d*$/.test(a)).length,s.records.length);
 for(const [i,r]of s.records.entries())for(const [col,f]of Object.entries(r.values))assert.equal(sheet.cells[col+(i+2)]?.raw||'',f.value);
 const extensionCols=Object.keys(s.columns);
 for(const [i,r]of s.records.entries())for(const [j,column]of extensionCols.entries())assert.equal(sheet.cells[String.fromCharCode(78+j)+(i+2)]?.raw||'',r.extras[column]?.value||'');
 if(name==='daikin'){assert.ok(!sheet.cells.K2);assert.equal(s.records[0].extras['Source Quantity'].value,'48');}
 if(name==='hyundai'){assert.notEqual(s.records[0].id,s.records[1].id);assert.equal(s.records[0].extras['Source Product ID'].value,s.records[1].extras['Source Product ID'].value);assert.equal(sheet.cells.K2.raw,'70000');assert.equal(sheet.cells.K3.raw,'70000');assert.ok(!sheet.cells.M4);assert.equal(s.records[2].extras['Source Packaging'].value,'200 PR/BX');}
 if(name==='tesla'){assert.ok(!sheet.cells.M2);assert.ok(sheet.cells.E2.raw.includes('1000/CA'));}
 if(name==='berry'){assert.equal(sheet.cells.E2.raw,'Goggles');assert.equal(sheet.cells.N2.raw,'2CVG3');assert.ok(!sheet.cells.I2);}
 const before=openZip(templateBytes),after=openZip(output);
 for(const path of Object.keys(before))if(path!=='xl/worksheets/sheet2.xml')assert.deepEqual(after[path],before[path],path);
});

test('final gate allows verified stock-code-only identity while unrelated unresolved checks still block export',async()=>{
 const s=setup('berry'),r=s.records[0],before=structuredClone(r);r.values.E.value='';r.values.E.status='blank';
 s.controller.record(before,r,'Simulated reviewer deliberately blanks the description.');
 assert.ok(!finalReadiness(s).issues.some(i=>i.code==='IDENTITY_NOT_PROJECTABLE'));
 await assert.rejects(exportReviewedWorkbook(s),/Finish review/);
});

test('full final gate ignores malformed fields and unapproved extension values of explicitly excluded items',async()=>{
 const s=setup('berry'),r=structuredClone(s.records[0]);r.id='excluded-test-occurrence';r.boundary='pending';r.values.M.value='invalid pack';r.values.M.status='pending';for(const f of Object.values(r.extras))f.status='pending';
 const before=structuredClone(r);r.boundary='exclude';s.controller.record(before,r,'Simulated reviewer explicitly excludes this additional test occurrence.');s.records.push(r);coverage(s);
 const readiness=finalReadiness(s);assert.deepEqual(readiness.messages,[]);
 assert.equal(readiness.snapshot.run.extensions[0].values.length,1);
 const sheet=readWorkbook(await exportReviewedWorkbook(s)).sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');assert.ok(!sheet.cells.E3);
});

test('source digest, stale approvals, unknown annual period and concurrent review changes block production export',async()=>{
 const s=setup('daikin');coverage(s);
 await assert.rejects(exportReviewedWorkbook({...s,expectedSourceDigest:'0'.repeat(64)}),/Source changed/);
 const r=s.records[0];r.values.E.value='Unapproved replacement';
 await assert.rejects(exportReviewedWorkbook(s),/Finish review/);
 const t=setup('daikin'),before=structuredClone(t.records[0]);t.records[0].values.K={value:'48',evidence:['B7'],reason:'Test attempts to put period-unknown quantity into annual usage.',status:'accepted'};t.controller.record(before,t.records[0],'Simulated attempted quantity approval');coverage(t);
 assert.ok(finalReadiness(t).issues.some(i=>i.code==='ANNUAL_BASIS'));
 await assert.rejects(exportReviewedWorkbook(t),/annual/);
 const u=setup('daikin');coverage(u);let checks=0;
 await assert.rejects(exportReviewedWorkbook({...u,assertCurrent:()=>{if(++checks===2)throw Error('Review changed during hashing.');}}),/Review changed/);
});

test('complete original workbooks cannot export by asserting coverage or UI acceptance without controller decisions',async()=>{
 const paths=[...Object.values(cases).map(c=>c.path),'fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx'];
 for(const path of paths){
  const proposalBytes=readFileSync('../attachments/'+path),book=readWorkbook(proposalBytes),records=extract(book).records,columns=Object.fromEntries([...new Set(records.flatMap(r=>Object.keys(r.extras)))].map(k=>[k,'approved']));
  for(const r of records){r.boundary='include';for(const f of Object.values(r.values))f.status=f.value?'accepted':'blank';for(const f of Object.values(r.extras))f.status='accepted';}
  await assert.rejects(exportReviewedWorkbook({proposalBytes,templateBytes,expectedSourceDigest:hash(proposalBytes),records,columns,name:path.split('/').at(-1),controller:createReviewController(),coverageConfirmed:true}),/Finish review/,path);
 }
});
