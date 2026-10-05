import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTrace,notify} from '../lib/debug/trace.mjs';
import {exportWorkbook,readWorkbook,makeRecord,openZip} from '../lib/workbook.mjs';
test('debug collection is disabled completely, bounded, immutable and cleared',()=>{
 const off=createTrace(false);off.add({stage:'parse',detail:{value:'private'}});assert.deepEqual(off.snapshot(),{events:[],dropped:0,latest:{}});
 const trace=createTrace(true,2),detail={value:'first'};trace.add({stage:'parse',detail,generation:2,revision:3});detail.value='changed';assert.equal(trace.snapshot().events[0].detail.value,'first');
 trace.add({stage:'ai',detail:{value:'x'.repeat(20000)}});trace.add({stage:'export'});assert.equal(trace.snapshot().events.length,2);assert.equal(trace.snapshot().dropped,1);assert.equal(trace.snapshot().events[0].detail.truncated,true);assert.equal(trace.snapshot().latest.parse.status,'info');assert.equal(trace.snapshot().latest.parse.generation,2);const snapshot=trace.snapshot();snapshot.latest.parse.status='changed';assert.equal(trace.snapshot().latest.parse.status,'info');trace.clear();assert.deepEqual(trace.snapshot(),{events:[],dropped:0,latest:{}});
});
test('observer errors cannot change real template output or readback verification',()=>{
 const template=new Uint8Array(readFileSync('public/template.xlsx')),book=readWorkbook(template),record=makeRecord(book.sheets[0],[]);record.boundary='include';record.values.E.value='Glove';record.values.I.value='000123';
 const baseline=exportWorkbook(template,[record],{}),events=[];
 assert.deepEqual(openZip(exportWorkbook(template,[record],{},e=>events.push(e))),openZip(baseline));
 assert.deepEqual(openZip(exportWorkbook(template,[record],{},()=>{throw Error('broken diagnostics');})),openZip(baseline));
 assert.ok(events.some(e=>e.message.includes('readback')));assert.doesNotThrow(()=>notify(()=>{throw Error('debug');},{stage:'ai'}));
});
