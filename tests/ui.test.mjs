import test from 'node:test';
import assert from 'node:assert/strict';
import { pageNumbers } from '../assets/pagination.mjs';
import { selectProfile, resolveProfile } from '../scripts/profile.mjs';

test('pagination keeps boundary and nearby pages with gaps',()=>{
  assert.deepEqual(pageNumbers(1,1),[1]);
  assert.deepEqual(pageNumbers(1,409),[1,2,3,4,5,'…',409]);
  assert.deepEqual(pageNumbers(200,409),[1,'…',199,200,201,'…',409]);
  assert.deepEqual(pageNumbers(409,409),[1,'…',405,406,407,408,409]);
});
test('a fuzzy search must match exact stable identity and refuse ambiguity',()=>{
  const lecturer={nidn:'2003047301',nuptk:'2735751652130132',nama:'RASYAD'};
  const exact={id:'correct-profile',nidn:lecturer.nidn,nama:'RASYAD'};
  assert.equal(selectProfile([{id:'wrong-profile',nidn:'2003047001'},exact],lecturer),exact);
  assert.equal(selectProfile([exact,{...exact,id:'another-profile'}],lecturer),null);
  assert.equal(selectProfile([{id:'same-name',nama:'RASYAD'}],lecturer),null);
});
test('profile URLs use verified search IDs instead of homebase IDs',async()=>{
  const calls=[];
  const result=await resolveProfile({nidn:'2003047301',nama:'RASYAD',id_sdm:'homebase-id'}, {fetcher:async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>url.includes('/pencarian/') ? {status:'success',data:[{id:'correct-profile',nidn:'2003047301',nama:'RASYAD'}]} : {status:'success',data:{nama_dosen:'RASYAD'}}};
  }});
  assert.equal(result.direct,true);assert.ok(result.url.endsWith('/detail-dosen/correct-profile'));
  assert.deepEqual(JSON.parse(calls[1].options.body),{id:'correct-profile'});
});
test('source errors and missing IDs use the official search page',async()=>{
  const result=await resolveProfile({nidn:'2003047301',nama:'RASYAD'}, {fetcher:async()=>({ok:false,status:403})});
  assert.equal(result.direct,false);assert.ok(result.url.endsWith('/search/dosen/2003047301'));
  const missing=await resolveProfile({nama:'NAMA SAMA'}, {fetcher:async()=>{throw new Error('Must not fetch');}});
  assert.equal(missing.direct,false);
});
