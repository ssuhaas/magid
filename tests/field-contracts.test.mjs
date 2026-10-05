import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,strFromU8,strToU8} from 'fflate';
import {fieldContracts,assertTemplateContract} from '../lib/canonical/field-contracts.mjs';
import {fields,readWorkbook,openZip,exportWorkbook} from '../lib/workbook.mjs';
import {fieldMap} from '../lib/canonical/bridge.mjs';
const template=readFileSync('public/template.xlsx');
test('original template, reviewer labels and canonical fields share one complete A:M contract',()=>{
 const sheet=assertTemplateContract(readWorkbook(template));
 assert.equal(Object.keys(fieldContracts).length,13);assert.equal(Object.keys(fields).length,12);assert.equal(Object.keys(fieldMap).length,12);
 for(const [column,contract]of Object.entries(fieldContracts)){
  assert.equal(sheet.cells[column+'1'].raw,contract.header);
  assert.ok(contract.help);
  if(column!=='A'){assert.equal(fields[column],contract.label);assert.equal(fieldMap[column],contract.canonical);}
 }
 assert.equal(fieldContracts.K.canonical,'annual_usage');assert.equal(fieldContracts.M.canonical,'pack_quantity');
});
test('missing, renamed, swapped, formula-driven or extended base headers fail clearly',()=>{
 for(const mutate of [s=>delete s.cells.K1,s=>s.cells.K1.raw='Monthly Usage',s=>{[s.cells.I1,s.cells.J1]=[s.cells.J1,s.cells.I1];},s=>s.cells.E1.formula='A1',s=>s.cells.N1={raw:'Existing addition',formula:null}]){
  const book=readWorkbook(template);mutate(book.sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE'));assert.throws(()=>assertTemplateContract(book),/template/i);
 }
});
test('actual Excel writer refuses a structurally altered template before writing output',()=>{
 const files=openZip(template),book=readWorkbook(template),sheet=book.sheets.find(s=>s.name==='AI BID IDENTIFICATION TEMPLATE');
 // Remove one actual original header cell, retaining a valid OOXML container.
 files[sheet.path]=strToU8(strFromU8(files[sheet.path]).replace(/<c\b[^>]*\br="K1"[^>]*>[\s\S]*?<\/c>/,''));
 assert.throws(()=>exportWorkbook(zipSync(files),[],{}),/K1/);
});
