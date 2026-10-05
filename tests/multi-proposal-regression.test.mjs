import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from './helpers/fixtures.mjs';
import {readWorkbook,extract,checkReady,exportWorkbook} from '../lib/workbook.mjs';
import {identifierLoss} from '../lib/identifier-retention.mjs';
import {buildScope,applyExtractionIssues} from '../lib/ai/client.mjs';
import {createReviewController} from '../lib/canonical/bridge.mjs';
import {applyEvaluationFindings,pruneRedundantExtras,automateBoundaries,automateCoverage} from '../lib/canonical/pipeline.mjs';
import {reviewStats,needsReview} from '../lib/ui/review.mjs';
const rfq=()=>readWorkbook(readFileSync('../attachments/a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx'));
const ppe=()=>readWorkbook(readFileSync('../attachments/5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx'));
test('all twelve actual hash-prefixed hair-net codes survive pruning and Excel readback',()=>{
 const b=ppe(),r=extract(b).records.filter(r=>/^H(?:3[2-9]|4[0-3])$/.test(r.anchors[0]));assert.equal(r.length,12);pruneRedundantExtras(r);assert.equal(identifierLoss(r,{}).length,12);assert.equal(identifierLoss(r,{'Source Product ID':'approved'}).length,0);
 for(const x of r)x.boundary='include';const out=readWorkbook(exportWorkbook(readFileSync('public/template.xlsx'),r,{'Source Product ID':'approved'})).sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');
 r.forEach((x,i)=>assert.equal(out.cells['N'+(i+2)].raw,b.sheets[0].cells[x.anchors[0]].raw));
 r[0].values.F.value='#30BB';assert.equal(identifierLoss([r[0]],{}).length,1);r[0].values.F.value='Hair net #30';assert.equal(identifierLoss([r[0]],{}).length,0);
});
test('every RFQ scope supplies both verified header regions and existing source-code evidence without other product rows',()=>{
 const b=rfq(),records=extract(b).records;for(const r of records){const input=buildScope(b,[r],{digest:'a'.repeat(64),scopeId:'scope'});for(const a of ['E17','G17','E26','G26'])assert.equal(input.cells.find(c=>c.cell===a)?.contextRole,'header');assert.deepEqual(input.records[0].currentExtras['Source Product ID'],r.extras['Source Product ID']&&{value:r.extras['Source Product ID'].value,evidence:r.extras['Source Product ID'].evidence});for(const other of records.filter(x=>x.id!==r.id))assert.ok(!input.cells.some(c=>c.cell===other.anchors[0]));}
 const changed=structuredClone(b);changed.sheets[0].cells.D26.raw='Unlabeled';assert.ok(!buildScope(changed,[records[10]],{digest:'a'.repeat(64),scopeId:'changed'}).cells.some(c=>c.cell==='E26'&&c.contextRole==='header'));
});
test('RFQ exact annual scalars and standalone units proceed automatically; formulas and all nine packaging relationships remain exceptions',()=>{
 const b=rfq(),r=extract(b).records,c=createReviewController();automateBoundaries(c,r,b);c.automate(r,b);assert.equal(r.filter(x=>x.values.K.status==='auto_accepted').length,33);assert.deepEqual(r.filter(x=>x.values.K.status==='pending').map(x=>x.anchors[0]),['C28','C32']);assert.equal(r.filter(x=>x.values.L.status==='auto_accepted').length,26);assert.equal(r.filter(x=>x.values.M.value&&x.values.M.status==='pending').length,9);assert.equal(reviewStats(r).pendingItems,10);assert.equal(automateCoverage(c,b,r).index.sheets.size,1);
 const one=r.find(x=>x.anchors[0]==='C33');applyExtractionIssues([one],[{recordId:one.id,sheet:one.sheet,anchors:one.anchors,column:'K',reason:'Rejected AI candidate.'}],b);assert.equal(one.values.K.status,'auto_accepted');
 const changed=structuredClone(b);changed.sheets[0].cells.E26.raw='Monthly volume';c.automate([one],changed);assert.equal(one.values.K.status,'pending');
 const cross=structuredClone(one);cross.values.L.evidence=['G19'];cross.values.L.status='pending';c.automate([cross],b);assert.equal(cross.values.L.status,'pending');
});
test('already retained code does not cause a false missing-field review; different values or source cells still do',()=>{
 const b=rfq(),r=extract(b).records[0],c=createReviewController();c.automate([r],b);const e={recordId:r.id,sheet:r.sheet,anchors:r.anchors,boundary:'supported',fields:[],reason:'Verified.',missing:[{column:'C',reason:'Code missing',evidence:[{sheet:r.sheet,cell:'D19',quote:r.extras['Source Product ID'].value}]}]};applyEvaluationFindings([r],[{items:[e]}],c);assert.equal(r.values.C.status,'auto_blank');
 e.missing[0].evidence[0].cell='D20';applyEvaluationFindings([r],[{items:[e]}],c);assert.equal(r.values.C.status,'pending');r.values.C.status='blank';applyEvaluationFindings([r],[{items:[e]}],c);assert.equal(r.values.C.status,'blank');
});
test('PPE stock identity requires approved column and verified source; descriptions stay blank',()=>{
 const b=ppe(),r=extract(b).records.find(x=>!x.values.E.value&&!x.ambiguous),c=createReviewController();automateBoundaries(c,[r],b);c.automate([r],b);
 assert.equal(needsReview(r,{},b),true);assert.equal(needsReview(r,{'Source Product ID':'approved'},b),false);assert.equal(reviewStats([r],{'Source Product ID':'approved'},c,b).reviewed,1);assert.deepEqual(checkReady([r],{'Source Product ID':'approved'},true,b),[]);assert.equal(r.values.E.value,'');assert.equal(r.values.I.value,'');assert.equal(needsReview(r,{'Source Product ID':'declined'},b),true);
});
test('RFQ section labels are actual source values with matching evidence, rather than column headings',()=>{const b=rfq();for(const r of extract(b).records){const f=r.extras['Source Section'];assert.equal(f.value,b.sheets[0].cells[f.evidence[0]].raw);assert.ok(['C16','C25'].includes(f.evidence[0]));}});
