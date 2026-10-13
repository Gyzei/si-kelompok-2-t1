import test from 'node:test';
import assert from 'node:assert/strict';
import {filterLecturers,matchesText,invalidateSearch} from '../assets/filter.mjs';
import {ApiClient,LiveData} from '../assets/live-data.mjs';

const affiliation={id_pt:'aceh',nama_pt:'Universitas Aceh',id_prodi:'p',nama_prodi:'Teknik Sipil',status_pt:'Aktif'};
const row=(nama,nidn='1000000001')=>({nama,nidn,nuptk:'1234567890123456',afiliasi:[{...affiliation}]});
test('search supports reordered words, accents, punctuation and affiliation terms',()=>{
 assert.equal(filterLecturers([row('MUHAMMAD ÁLI')],{query:'ali, muhammad ACEH sipil'}).length,1);
 assert.equal(matchesText('Universitas Islam Negeri Ar-Raniry','raniry negeri'),true);
 assert.equal(filterLecturers([row('MUHAMMAD ALI')],{query:'ali biologi'}).length,0);
});
test('complete numeric identifiers match exactly and preserve leading zeros',()=>{
 const rows=[row('ALI','0100000001'),row('BUDI','0100000002')];
 assert.deepEqual(filterLecturers(rows,{query:'0100 000 001'}).map(r=>r.nama),['ALI']);
 assert.equal(filterLecturers(rows,{query:'0100000099'}).length,0);
 assert.equal(filterLecturers(rows,{query:'1234567890123456'}).length,2);
});
test('ranking places exact names before prefixes and affiliation-only matches',()=>{
 const rows=[row('BUDI'),row('ALI AKBAR'),row('ALI')];rows[0].afiliasi[0].nama_prodi='Ali';
 assert.deepEqual(filterLecturers(rows,{query:'ali'}).map(r=>r.nama),['ALI','ALI AKBAR','BUDI']);
});
test('indexed search can see newly merged affiliations and respects selected affiliation',()=>{
 const item=row('ALI');assert.equal(filterLecturers([item],{query:'hukum'}).length,0);
 item.afiliasi.push({...affiliation,id_pt:'other',id_prodi:'law',nama_prodi:'Hukum'});invalidateSearch(item);
 assert.equal(filterLecturers([item],{query:'hukum'}).length,1);
 assert.equal(filterLecturers([item],{query:'hukum',pt:'aceh'}).length,0);
});
test('API search matches the entire Aceh PT index and excludes outside provinces',async()=>{
 const calls=[];const model=new LiveData({get:async q=>{
  calls.push(q);
  if(q.action==='pt')return {items:[{id:'aceh',nama:'Universitas Aceh',status:'Aktif'}],totalPages:1,totalItems:1};
  return {items:[{id:'profile-a',nama:'ALI',nidn:'0100000001',nama_pt:'UNIVERSITAS ACEH',nama_prodi:'Teknik'},
   {id:'profile-b',nama:'ALI',nidn:'0100000002',nama_pt:'Universitas Jakarta',nama_prodi:'Teknik'}]};
 }});
 const result=await model.search('ALI');assert.equal(result.length,1);assert.equal(result[0].profile_id,'profile-a');
 assert.equal(result[0].afiliasi[0].semester,'Terkini');assert.equal(model.rows.size,0);
 assert.equal(calls.filter(c=>c.action==='dosen').length,0);
});
test('homebase requests overlap while results commit in stable program order',async()=>{
 const model=new LiveData({requests:0,get:async q=>{
  if(q.action==='pt')return {items:[{id:'pt',nama:'PT Aceh'}],totalPages:1,totalItems:1};
  if(q.action==='prodi')return {items:['a','b'].map(id=>({id,id_pt:'pt',nama:id,jumlah_dosen_api:1}))};
  await new Promise(r=>setTimeout(r,q.id==='a'?25:1));
  return {items:[{nama_dosen:q.id,nidn:q.id==='a'?'1000000001':'1000000002'}]};
 }});
 await model.loadPTPage(1);const commits=[];
 await model.ensure({},2,{onUpdate:()=>commits.push([...model.rows.values()].map(r=>r.nama))});
 assert.deepEqual(commits,[['a'],['a','b']]);
});
test('API search normalizes formatted identifiers and separates missing identities',async()=>{
 let sent;const model=new LiveData({get:async q=>{
  if(q.action==='pt')return {items:[{id:'pt',nama:'PT Aceh'}],totalPages:1,totalItems:1};
  sent=q.query;return {items:['a','b'].map(id=>({id,nama:'ALI',nidn:'0000000000',nuptk:'',nama_pt:'PT Aceh',nama_prodi:'Teknik'}))};
 }});
 assert.equal((await model.search('ALI')).length,2);
 await model.search('0100 000 001');assert.equal(sent,'0100000001');
});
test('search shows known Aceh matches before the remaining PT pages and retains partial results on failure',async()=>{
 const model=new LiveData({get:async q=>{
  if(q.action==='search')return {items:[{id:'profile',nama:'ALI',nama_pt:'PT Aceh',nidn:'1000000001',nama_prodi:'Teknik'}]};
  if(q.page===2)throw new Error('source unavailable');
  return {items:[{id:'pt',nama:'PT Aceh'}],totalPages:2,totalItems:2};
 }});
 let partial=[];await assert.rejects(model.search('ALI',{onUpdate:rows=>partial=rows}),/source unavailable/);
 assert.equal(partial.length,1);assert.equal(model.indexComplete,false);
});
test('foreground requests pass queued background work with bounded concurrency',async()=>{
 const starts=[],release=new Map();let concurrent=0,max=0;
 const client=new ApiClient({delay:0,fetcher:async(url,options)=>{
  const id=JSON.parse(options.body).id;starts.push(id);concurrent++;max=Math.max(max,concurrent);
  await new Promise(resolve=>release.set(id,resolve));concurrent--;
  return {ok:true,json:async()=>({items:[]})};
 }});
 const first=client.get({id:'background-1'},{priority:1}),second=client.get({id:'background-2'},{priority:1});
 const foreground=client.get({id:'foreground'});
 await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(starts,['background-1','foreground']);assert.ok(max<=3);
 release.get('foreground')();await foreground;
 release.get('background-1')();await first;
 await new Promise(r=>setTimeout(r,5));release.get('background-2')();await second;
});
