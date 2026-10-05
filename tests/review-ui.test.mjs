import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from './helpers/fixtures.mjs';
import {reviewGroups,needsReview,spreadsheetWindow,batchFields} from '../lib/ui/review.mjs';
import {readWorkbook,extract,makeRecord} from '../lib/workbook.mjs';
import {createReviewController} from '../lib/canonical/bridge.mjs';
import {coverageIndex,prepareCoverage,applyCoverage} from '../lib/canonical/coverage.mjs';
test('suggested groups cover all five real workbooks without duplicates or implicit approvals',()=>{
 const paths=['../attachments/8e933fef-5f19-4144-b944-9b1961b4ee51/Safety PPE Supplies 2024 FL.xlsx','../attachments/a8b4fa56-bbb4-4d76-8e6a-50a859f829fc/RFQ for PPE.xlsx','../attachments/e6f63120-98ee-4723-92b3-e6959045d7c5/TESLA PPE RFP April 2025.xlsx','../attachments/fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx','../attachments/5c3b8658-ae6e-4236-aa3e-731f507b82fc/PPE List.xlsx'];
 for(const path of paths){const book=readWorkbook(new Uint8Array(readFileSync(path))),records=extract(book).records,controller=createReviewController();for(const r of records)r.boundary='include';const index=coverageIndex(book,records,controller);for(const sheet of book.sheets){const groups=reviewGroups(index,controller,sheet.name),all=groups.flatMap(g=>g.addresses);assert.deepEqual(new Set(all),new Set(Object.keys(sheet.cells)));assert.equal(all.length,new Set(all).size);assert.ok(groups.every(g=>g.addresses.length<=100));}assert.equal(controller.coverage.size,0);assert.equal(controller.layouts.size,0);}
});
test('explicit coverage disappears from suggestions and stale decisions reappear',()=>{
 const book={sheets:[{name:'PPE',hidden:'visible',hiddenRows:[],cells:{A1:{raw:'Glove',type:'s',formula:null},A2:{raw:'Instructions',type:'s',formula:null}}}]},r=makeRecord(book.sheets[0],['A1']),controller=createReviewController();r.boundary='include';let index=coverageIndex(book,[r],controller);const plan=prepareCoverage(index,{sheet:'PPE',addresses:['A1'],disposition:'item',role:'customer_specification',reason:'Customer item.'});applyCoverage(controller,index,plan);assert.deepEqual(reviewGroups(index,controller,'PPE').flatMap(g=>g.addresses),['A2']);const after=structuredClone(r);after.values.E.value='Changed';controller.record(r,after,'edit');index=coverageIndex(book,[after],controller);assert.equal(reviewGroups(index,controller,'PPE').flatMap(g=>g.addresses).length,2);
});
test('included item is not called reviewed while fields or approved extras remain pending',()=>{
 const r=makeRecord({name:'PPE'},['A1']);r.boundary='include';assert.equal(needsReview(r,{}),true);for(const f of Object.values(r.values))f.status='blank';r.values.E={value:'Glove',status:'accepted'};assert.equal(needsReview(r,{}),false);r.extras.Code={value:'ABC',status:'pending'};assert.equal(needsReview(r,{Code:'approved'}),true);assert.equal(needsReview(r,{Code:'declined'}),false);r.boundary='exclude';assert.equal(needsReview(r,{Code:'approved'}),false);
});
test('source preview includes distant highlighted cell and nearby rows without unbounded row rendering',()=>{const w=spreadsheetWindow({cells:{A1:{},ZZ100000:{}}},'ZZ100000');assert.ok(w.rows.includes(100000));assert.ok(w.rows.includes(99999));assert.ok(w.rows.includes(1));assert.ok(w.rows.length<=12);assert.ok(w.endColumn-w.startColumn<10);});
test('batch eligibility omits empty, conflicting, formula, excluded and already reviewed values',()=>{
 const book={sheets:[{name:'PPE',cells:{A1:{formula:null},A2:{formula:'A1'}}}]},r=makeRecord(book.sheets[0],['A1']);r.boundary='include';
 for(const field of Object.values(r.values)){field.value='';field.direct=false;}
 assert.deepEqual(batchFields(r,'direct',book),[]);
 r.values.E={value:'Glove',direct:true,status:'pending',evidence:['A1']};
 r.values.G={value:'L',direct:true,status:'pending',evidence:['A1'],alternatives:[{value:'XL'}]};
 r.values.K={value:'10',direct:true,status:'pending',evidence:['A2']};
 r.values.H={value:'Brand',direct:true,status:'accepted',evidence:['A1']};
 assert.deepEqual(batchFields(r,'direct',book).map(([k])=>k),['E']);
 r.values.E.status='accepted';assert.deepEqual(batchFields(r,'direct',book),[]);
 assert.deepEqual(batchFields(r,'blank:E',book),[]);
 r.extras.Code={value:'000123',status:'pending',alternatives:[{value:'other'}]};assert.deepEqual(batchFields(r,'extra:Code',book),[]);
 r.boundary='pending';r.ambiguous=true;assert.deepEqual(batchFields(r,'boundaries',book),[]);r.ambiguous=false;assert.equal(batchFields(r,'boundaries',book).length,1);
 r.boundary='exclude';assert.deepEqual(batchFields(r,'blank:K',book),[]);assert.deepEqual(batchFields(r,'boundaries',book),[]);
});

test('one review summary follows all 31 real items through approval, extra-column decisions and reopened dependencies',async()=>{
 const {reviewStats}=await import('../lib/ui/review.mjs'),{prepareDescriptions}=await import('../lib/description-policy.mjs');
 const book=readWorkbook(readFileSync('../attachments/fac704a8-4ebc-4e40-9bab-2a32a330cd7a/grainger-030926.xlsx')),records=prepareDescriptions(extract(book).records,book),controller=createReviewController(),columns={'Source Product ID':'declined'};
 // This counter test deliberately models interpreted exceptions; literal source fields now approve automatically.
 for(const r of records){r.values.E.origin='ai';r.extras['Source Product ID'].origin='ai';}
 controller.automate(records,book);let stats=reviewStats(records,columns);assert.equal(stats.total,31);assert.equal(stats.pendingItems,31);assert.equal(stats.pendingFields,31);assert.equal(stats.pendingBoundaries,31);
 for(const [i,r]of records.entries()){const before=structuredClone(r);r.boundary='include';r.values.E.status='accepted';controller.record(before,r,'Test reviewer confirms product wording and inclusion.');controller.automate([r],book);stats=reviewStats(records,columns);assert.equal(stats.pendingItems,30-i);assert.equal(stats.pendingFields,30-i);assert.equal(stats.pendingBoundaries,30-i);assert.equal(stats.total,31);}
 assert.equal(stats.reviewed,31);assert.equal(stats.handledFields,stats.totalFields);
 columns['Source Product ID']='approved';stats=reviewStats(records,columns);assert.equal(stats.pendingItems,31);assert.equal(stats.pendingFields,31);assert.equal(stats.pendingBoundaries,0);
 for(const r of records){const before=structuredClone(r);r.extras['Source Product ID'].status='accepted';controller.record(before,r,'Test reviewer accepts supplied code.');}assert.equal(reviewStats(records,columns).pendingItems,0);
 const r=records[2],before=structuredClone(r);r.values.G={value:'L',evidence:['A4'],reason:'Explicit source size.',status:'accepted',origin:'ai'};controller.record(before,r,'Test reviewer confirms size.');const old=structuredClone(r);r.values.E.value='Reviewed product wording';r.values.E.status='edited';controller.record(old,r,'Test reviewer changes upstream product wording.');controller.automate([r],book);stats=reviewStats(records,columns);assert.equal(stats.pendingItems,1);assert.equal(stats.pendingFields,1);
 const prior=structuredClone(r);r.values.G.value='';r.values.G.status='blank';controller.record(prior,r,'Test reviewer leaves reopened size blank.');assert.equal(reviewStats(records,columns).pendingItems,0);
 const excluded=structuredClone(r);r.boundary='exclude';controller.record(excluded,r,'Test reviewer excludes occurrence.');stats=reviewStats(records,columns);assert.equal(stats.excluded,1);assert.equal(stats.reviewed,30);assert.equal(stats.pendingItems,0);assert.equal(stats.pendingFields,0);assert.equal(stats.total,31);
});
