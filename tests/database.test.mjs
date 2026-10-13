import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,fixtureSource} from './db-helper.mjs';
import {syncStep,retryDelay} from '../server/sync.mjs';
import {randomUUID} from 'node:crypto';
import {DirectoryClient} from '../assets/database-client.mjs';
import {authorized} from '../server/http.mjs';
import {Database,searchParameters} from '../server/database.mjs';

test('real PostgreSQL schema supports durable sync, atomic publish, deduplication, indexed search and RLS',async()=>{
 const {pg,db}=await createDatabase();
 try{
  assert.equal((await db.rpc('da_metadata')).run_id,null);
  assert.equal((await pg.query("select da_normalize('ÁLI ÉKA') normalized")).rows[0].normalized,'ali eka');
  const source=fixtureSource();let result;
  result=await syncStep(db,{source});assert.equal(result.run.phase,'prodi');
  await assert.rejects(syncStep(db,{source:async()=>{throw Object.assign(new Error('PDDIKTI unavailable'),{status:503});}}),/unavailable/);
  assert.equal((await db.rpc('da_sync_status')).status,'paused');
  assert.equal((await db.rpc('da_metadata')).run_id,null);
  for(let i=0;i<10;i++){result=await syncStep(db,{source});if(result.done)break;}
  assert.equal(result.done,true);
  const meta=await db.rpc('da_metadata');assert.equal(Number(meta.total_dosen),36);assert.equal(meta.prodi.length,2);
  const page=await db.rpc('da_search',{p_page:1,p_size:25});assert.equal(page.items.length,25);assert.equal(Number(page.total),36);
  const second=await db.rpc('da_search',{p_page:2,p_size:25});assert.equal(second.items.length,11);assert.equal(new Set([...page.items,...second.items].map(r=>r.id)).size,36);
  const search=await db.rpc('da_search',{p_query:'ali muhammad aceh sipil'});assert.equal(search.items.length,1);assert.equal(search.items[0].afiliasi.length,2);
  assert.equal((await db.rpc('da_search',{p_query:'ali hukum',p_pt:'pt-a'})).items.length,0);
  assert.equal((await db.rpc('da_search',{p_query:'1000 000 000'})).items.length,1);
  assert.equal((await db.rpc('da_search',{p_query:'1000000099'})).items.length,0);
  assert.equal((await db.rpc('da_search',{p_status:'Tutup'})).items.length,1);
  await syncStep(db,{source});assert.equal((await db.rpc('da_metadata')).run_id,meta.run_id);
  await pg.exec('set role anon;');await assert.rejects(db.rpc('da_search'),/permission denied/);
  await assert.rejects(pg.query('select * from public.da_lecturers'),/permission denied/);
  await pg.exec('reset role;set role service_role;');assert.equal((await db.rpc('da_metadata')).run_id,meta.run_id);
 }finally{await pg.close();}
});
test('multi-batch publishing resumes its prepared plan and keeps the previous generation visible',async()=>{
 const {pg,db}=await createDatabase();try{
  const source=fixtureSource({count:550});let result;
  for(let i=0;i<8;i++){result=await syncStep(db,{source});if(result.run.phase==='publish')break;}
  result=await syncStep(db,{source});assert.equal(result.run.publish_offset,500);assert.equal(result.done,false);
  assert.equal((await db.rpc('da_metadata')).run_id,null);
  const counts=(await pg.query('select count(*) as count from da_publish_chunks')).rows[0];assert.equal(Number(counts.count),2);
  const guarded={rpc:(name,params)=>{assert.notEqual(name,'da_sync_records');return db.rpc(name,params);}};
  result=await syncStep(guarded,{source});assert.equal(result.done,true);
  assert.equal(Number((await db.rpc('da_metadata')).total_dosen),550);
  assert.equal(Number((await pg.query('select count(*) as count from da_publish_chunks')).rows[0].count),0);
 }finally{await pg.close();}
});
test('sync leases reject simultaneous workers and stale owners',async()=>{
 const {pg,db}=await createDatabase();try{
  const owner=randomUUID(),first=await db.rpc('da_sync_claim',{p_semester:'20261',p_owner:owner});
  assert.equal((await db.rpc('da_sync_claim',{p_semester:'20261',p_owner:randomUUID()})).busy,true);
  await assert.rejects(db.rpc('da_sync_commit',{p_run:first.run.id,p_owner:randomUUID(),p_task:first.task,p_data:{}}),/lease expired/);
  await db.rpc('da_sync_fail',{p_run:first.run.id,p_owner:owner,p_error:'temporary'});
  assert.equal((await db.rpc('da_sync_claim',{p_semester:'20261',p_owner:randomUUID()})).run.id,first.run.id);
 }finally{await pg.close();}
});
test('directory cache deduplicates pending reads, bounds RAM and never caches failures',async()=>{
 let calls=0;const client=new DirectoryClient({max:2,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,1));return {ok:true,json:async()=>({items:[]})};}});
 await Promise.all([client.list({},1,25),client.list({},1,25)]);assert.equal(calls,1);
 await client.list({},2,25);await client.list({},3,25);assert.equal(client.cache.size,2);
 client.clear();await client.list({},1,25);assert.equal(calls,4);
 const broken=new DirectoryClient({fetcher:async()=>({ok:false,json:async()=>({error:'unavailable'})})});await assert.rejects(broken.meta(),/unavailable/);assert.equal(broken.cache.size,0);
});
test('server-only secrets, admin authorization and search validation',async()=>{
 assert.equal(authorized({headers:{authorization:'Bearer private-sync'}},{SYNC_SECRET:'private-sync'}),true);
 assert.equal(authorized({headers:{authorization:'Bearer incorrect'}},{SYNC_SECRET:'private-sync'}),false);
 assert.equal(authorized({headers:{}},{}),false);
 assert.throws(()=>searchParameters(new URLSearchParams('size=999')),/invalid|valid/i);
 assert.throws(()=>searchParameters(new URLSearchParams('page=0')),/valid/i);
 let headers;const db=new Database({url:'https://example.supabase.co',key:'sb_secret_test',fetcher:async(url,options)=>{headers=options.headers;return {ok:true,text:async()=>'{"items":[]}'};}});
 await db.rpc('da_search');assert.equal(headers.apikey,'sb_secret_test');assert.equal(headers.Authorization,undefined);
});
test('sync retries honor upstream rate limits',()=>{
 assert.equal(retryDelay({status:429,retryAfter:'60'}),60000);
 assert.equal(retryDelay({status:429}),30000);
 assert.equal(retryDelay({status:503}),5000);
});
