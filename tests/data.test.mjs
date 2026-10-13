import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicate, unwrapPage, unwrapList, toCsv } from '../scripts/lib.mjs';
import { filterLecturers } from '../assets/filter.mjs';
import { replaceFile } from '../scripts/files.mjs';
const affiliation = (id = 'prodi-a', pt = 'pt-a', status = 'Aktif') => ({ id_pt: pt, nama_pt: pt,
  id_prodi: id, nama_prodi: id, status_pt: status, semester: '20261', jenjang: 'S1' });
const row = (values = {}) => ({ nama_dosen: 'RASYAD', id_sdm: 'source-a', nidn: '2003047301',
  nuptk: '', pendidikan: 'S2', status_aktif: 'Aktif', afiliasi: affiliation(), ...values });

test('same NIDN with different encrypted IDs retains both affiliations', () => {
  const data = deduplicate([row(), row({ id_sdm: 'source-b', afiliasi: affiliation('prodi-b') })]);
  assert.equal(data.length, 1); assert.equal(data[0].afiliasi.length, 2);
  assert.equal(data[0].nidn, '2003047301'); assert.deepEqual(data[0].id_sdm_lain, ['source-b']);
});
test('same names and distinct identities remain separate', () => {
  assert.equal(deduplicate([row(), row({ nidn:'2003047302',id_sdm:'source-b' })]).length, 2);
});
test('a later NUPTK bridge merges previously separate identity groups', () => {
  const data = deduplicate([
    row(), row({nidn:'',nuptk:'0536743644130082',id_sdm:'source-b'}),
    row({nuptk:'0536743644130082',id_sdm:'source-c'}),
  ]);
  assert.equal(data.length,1); assert.equal(data[0].nuptk,'0536743644130082');
});
test('missing or placeholder identities never merge names', () => {
  const missing = {nidn:'0000000000',nuptk:'0000000000000000',id_sdm:''};
  const data = deduplicate([row(missing),row({...missing,afiliasi:affiliation('other')})]);
  assert.equal(data.length,2);assert.equal(data[0].identitas_terverifikasi,false);
});
test('unexpected API wrappers and repeated page numbers are rejected', () => {
  assert.throws(()=>unwrapList({status:'error',data:[]},'dosen'));
  assert.throws(()=>unwrapList({status:'success',data:{}},'dosen'));
  assert.throws(()=>unwrapPage({status:'success',data:{data:[],page:1,totalItems:212,totalPages:15}},2));
  assert.equal(unwrapPage({status:'success',data:{data:[],page:2,totalItems:212,totalPages:15}},2).totalPages,15);
});
test('the observed success/null homebase response means an empty list only when explicitly allowed', () => {
  assert.deepEqual(unwrapList({status:'success',data:null},'homebase',{allowNull:true}),[]);
  assert.throws(()=>unwrapList({status:'success',data:null},'prodi'));
  assert.throws(()=>unwrapList({status:'error',data:null},'homebase',{allowNull:true}));
});
test('filters match PT and status on the same affiliation', () => {
  const data = deduplicate([row(),row({afiliasi:affiliation('prodi-b','pt-b','Tutup')})]);
  assert.equal(filterLecturers(data,{pt:'pt-a',status:'Tutup'}).length,0);
  assert.equal(filterLecturers(data,{pt:'pt-b',status:'Tutup',query:'rasyad'}).length,1);
  assert.equal(filterLecturers(data,{query:'2003047301'}).length,1);
});
test('CSV escapes quotes, formulas, and retains leading-zero identifier strings', () => {
  const data=deduplicate([row({nama_dosen:'=HYPERLINK("x")',nidn:'0023028301'})]);
  const csv=toCsv(data);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"0023028301"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
});
test('Windows snapshot replacement retries a reader lock and propagates permanent failures', async () => {
  let attempts = 0; const delays = [];
  await replaceFile('temporary','target',{
    rename: async () => { if (++attempts < 3) throw Object.assign(new Error('locked'),{code:'EPERM'}); },
    wait: async delay => delays.push(delay),
  });
  assert.equal(attempts,3); assert.deepEqual(delays,[50,100]);
  await assert.rejects(replaceFile('temporary','target',{
    rename:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}, wait:async()=>{},
  }), {code:'ENOENT'});
});
