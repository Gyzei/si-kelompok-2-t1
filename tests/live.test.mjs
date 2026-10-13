import test from 'node:test';
import assert from 'node:assert/strict';
import {liveApi,validateRequest} from '../scripts/live-api.mjs';

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

