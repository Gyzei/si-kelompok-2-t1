import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClient,LiveData} from '../assets/live-data.mjs';
import {liveApi,validateRequest} from '../scripts/live-api.mjs';

function fixture({size=20,empty=0}={}) {
  const calls=[];
  const client={requests:0,get:async request=>{
    calls.push(request);client.requests++;
    if(request.action==='pt')return {items:[{id:'pt-a',nama:'PT Aceh',status:'Aktif'}],page:1,totalPages:1,totalItems:1};
    if(request.action==='prodi')return {items:Array.from({length:empty+3},(_,i)=>({id:'p'+i,id_pt:'pt-a',nama:'Prodi '+i,jenjang:'S1',jumlah_dosen_api:i<empty?0:size}))};
    const number=Number(request.id.slice(1));
    return {items:number<empty?[]:Array.from({length:size},(_,i)=>({id_sdm:'d'+number+'-'+i,nama_dosen:'DOSEN '+number+'-'+i,nidn:String(1000000000+number*100+i),nuptk:'',pendidikan:'S2',status_aktif:'Aktif'}))};
  }};
  return {model:new LiveData(client),calls};
}
test('live pagination fetches only enough programs and reuses previous pages',async()=>{
  const {model,calls}=fixture();await model.loadPTPage(1);
  await model.ensure({},25);assert.equal(model.rows.size,40);assert.equal(calls.filter(c=>c.action==='dosen').length,2);
  await model.ensure({},25);assert.equal(calls.filter(c=>c.action==='dosen').length,2);
  await model.ensure({},50);assert.equal(model.rows.size,60);assert.equal(model.complete({}),true);
  assert.equal(calls.filter(c=>c.action==='dosen').length,3);
});
test('a batch stops at its budget for empty programs without claiming complete',async()=>{
  const {model,calls}=fixture({empty:20});await model.loadPTPage(1);
  await model.ensure({},25,{budget:3});assert.equal(model.loaded.size,3);assert.equal(model.complete({}),false);
  assert.equal(calls.filter(c=>c.action==='dosen').length,3);
});
test('program filters request only the selected program',async()=>{
  const {model,calls}=fixture();await model.loadPTPage(1);
  await model.ensure({pt:'pt-a',prodi:'p2'},25);
  assert.deepEqual(calls.filter(c=>c.action==='dosen').map(c=>c.id),['p2']);
  assert.equal(model.complete({pt:'pt-a',prodi:'p2'}),true);assert.equal(model.complete({}),false);
  const metadata=model.snapshot({pt:'pt-a',prodi:'p2'}).metadata;
  assert.equal(metadata.complete,false);assert.equal(metadata.selection_complete,true);
  assert.deepEqual(metadata.selection,{pt:'pt-a',prodi:'p2'});
});
test('cancelled scope stops committing the already requested batch and starts no further programs',async()=>{
  const {model,calls}=fixture();await model.loadPTPage(1);
  let active=true;await model.ensure({},100,{active:()=>active,onUpdate:()=>{active=false;}});
  assert.equal(calls.filter(c=>c.action==='dosen').length,2);
  assert.equal(model.loaded.size,1);
});
test('live identity merge preserves arrivals and deduplicates NIDN across programs',()=>{
  const {model}=fixture();const p={id:'a',id_pt:'pt-a',nama:'A'};
  model.merge([{nama_dosen:'Z',nidn:'1000000001',id_sdm:'one'}],p);
  model.merge([{nama_dosen:'A',nidn:'1000000002',id_sdm:'two'},{nama_dosen:'Z',nidn:'1000000001',id_sdm:'new-id'}],{...p,id:'b'});
  assert.deepEqual(model.rowsFor({}).map(d=>d.nama),['Z','A']);assert.equal(model.rowsFor({})[0].afiliasi.length,2);
});
test('duplicate concurrent API requests are shared and errors are not cached',async()=>{
  let calls=0;
  const client=new ApiClient({delay:0,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {ok:true,json:async()=>({items:[]})};}});
  await Promise.all([client.get({action:'pt'}),client.get({action:'pt'})]);await client.get({action:'pt'});assert.equal(calls,1);
  let failures=0;const failing=new ApiClient({delay:0,fetcher:async()=>{failures++;return {ok:false,status:502,json:async()=>({error:'network'})};}});
  await assert.rejects(failing.get({action:'pt'}));await assert.rejects(failing.get({action:'pt'}));assert.equal(failures,4);
});
test('live proxy rejects arbitrary URLs and unsafe source IDs before fetching',()=>{
  assert.throws(()=>validateRequest({action:'fetch',url:'http://localhost'}));
  assert.throws(()=>validateRequest({action:'prodi',id:'../../private',semester:'20261'}));
  assert.throws(()=>validateRequest({action:'pt',page:-1}));
  assert.throws(()=>validateRequest({action:'pt',page:0}));
});
test('upstream denials propagate instead of being returned as empty data',async()=>{
  await assert.rejects(liveApi({action:'pt',page:1},{fetcher:async()=>({ok:false,status:403,headers:new Headers()})}),{status:403});
});
test('upstream timeouts produce a retryable error instead of empty lecturer results',async()=>{
  await assert.rejects(liveApi({action:'pt',page:1},{fetcher:async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}}),{status:502,message:'PDDIKTI belum merespons dalam 20 detik. Coba lagi beberapa saat.'});
});
