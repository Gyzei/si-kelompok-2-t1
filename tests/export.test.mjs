import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectoryClient} from '../assets/database-client.mjs';
import {filteredCsv} from '../assets/export.mjs';

test('CSV collects every filtered page and retains the starting scope and sort',async()=>{
 const requests=[],scope={query:'ali',pt:'aceh',prodi:'sipil',status:'Aktif'};
 const client=new DirectoryClient({fetcher:async url=>{
  const q=new URL(url,'https://test.local').searchParams;requests.push(q);
  return {ok:true,json:async()=>({run_id:'stable',total:503,items:Array.from({length:q.get('page')==='1'?500:3},(_,i)=>({id:String((Number(q.get('page'))-1)*500+i)}))})};
 }});
 const progress=[];const rows=await client.all(scope,{desc:true,onProgress:(count)=>{progress.push(count);scope.pt='changed';}});
 assert.equal(rows.length,503);assert.deepEqual(progress,[500,503]);
 for(const q of requests){assert.equal(q.get('size'),'500');assert.equal(q.get('pt'),'aceh');assert.equal(q.get('q'),'ali');assert.equal(q.get('prodi'),'sipil');assert.equal(q.get('status'),'Aktif');assert.equal(q.get('desc'),'1');}
});
test('export refuses incomplete, failed, duplicate, or changed generations',async()=>{
 for(const kind of ['empty','failure','duplicate','run','total']){
  let calls=0;const client=new DirectoryClient({fetcher:async()=>{calls++;return {ok:kind!=='failure'||calls===1,json:async()=>calls===1?{run_id:'a',total:2,items:[{id:'one'}]}:kind==='failure'?{error:'offline'}:{run_id:kind==='run'?'b':'a',total:kind==='total'?3:2,items:kind==='empty'?[]:[{id:kind==='duplicate'?'one':'two'}]}};}});
  await assert.rejects(client.all({}));
 }
});
test('filtered CSV includes matching affiliations and escapes formulas, quotes and identifiers',()=>{
 const csv=filteredCsv([{nama:'=ALI,"A"',nidn:'0012345678',nuptk:'',afiliasi:[{id_pt:'aceh',id_prodi:'p',status_pt:'Aktif',nama_pt:'PT Aceh',nama_prodi:'Sipil',semester:'20261'},{id_pt:'other',nama_pt:'Excluded'}]}],{pt:'aceh',prodi:'p',status:'Aktif'});
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"0012345678"'));assert.ok(csv.includes('"\'=ALI,""A"""'));assert.ok(!csv.includes('Excluded'));assert.equal(csv.split('\r\n').length,2);
});
