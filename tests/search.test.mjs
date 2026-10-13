import test from 'node:test';
import assert from 'node:assert/strict';
import {filterLecturers,matchesText,invalidateSearch} from '../assets/filter.mjs';


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

