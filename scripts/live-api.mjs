import { SOURCE, unwrapPage, unwrapList } from './lib.mjs';
import { resolveProfile } from './profile.mjs';
import { pathToFileURL } from 'node:url';

export function validateRequest(input) {
  const fail = message => { throw Object.assign(new Error(message),{status:400}); };
  if (!input || typeof input !== 'object' || !['pt','prodi','dosen','search','profile'].includes(input.action)) fail('Permintaan API tidak valid.');
  if(input.action==='search') {
    const query=String(input.query||'').trim();
    if(query.length<3||query.length>120)fail('Ketik minimal 3 karakter untuk pencarian API.');
    return {action:'search',query};
  }
  if (input.action === 'profile') {
    const nidn=String(input.nidn||''),nuptk=String(input.nuptk||''),nama=String(input.nama||'');
    if ((nidn&&!/^\d{10}$/.test(nidn))||(nuptk&&!/^\d{16}$/.test(nuptk))||nama.length>200||(!nidn&&!nuptk&&!nama)) fail('Identitas profil tidak valid.');
    return {action:'profile',nidn,nuptk,nama};
  }
  const semester=String(input.semester||'20261');
  if (!/^\d{4}[12]$/.test(semester)) fail('Semester tidak valid.');
  if (input.action==='pt') {
    const page=Number(input.page??1);
    if (!Number.isInteger(page)||page<1||page>1000) fail('Halaman tidak valid.');
    return {action:'pt',page,semester};
  }
  const id=String(input.id||'');
  if (!/^[A-Za-z0-9_-]{20,180}={0,2}$/.test(id)) fail('ID sumber tidak valid.');
  return {action:input.action,id,semester};
}
export async function liveApi(rawInput,{fetcher=fetch,timeoutMs=20000}={}) {
  const input=validateRequest(rawInput);
  if (input.action==='profile') return resolveProfile(input,{fetcher});
  let endpoint,body;
  if (input.action==='pt') endpoint=`/v2/pt/search/filter?limit=15&page=${input.page}&provinsi=Prov.%20Aceh`;
  if (input.action==='prodi') endpoint=`/pt/prodi/${input.id}/${input.semester}`;
  if (input.action==='dosen') {endpoint=`/dosen/homebase?semester=${input.semester}`;body={id:input.id};}
  if (input.action==='search') endpoint='/pencarian/dosen/'+encodeURIComponent(input.query);
  let response;
  try {response=await fetcher(SOURCE+'/api'+endpoint,{
    method:body?'POST':'GET',headers:{Accept:'application/json','Content-Type':'application/json',Referer:SOURCE+'/perguruan-tinggi',Origin:SOURCE,'User-Agent':'Mozilla/5.0'},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs),
  });}catch(error){throw Object.assign(new Error(error.name==='TimeoutError'?`PDDIKTI belum merespons dalam ${Math.ceil(timeoutMs/1000)} detik. Coba lagi beberapa saat.`:'Koneksi ke PDDIKTI terputus. Coba lagi beberapa saat.'),{status:502});}
  if (!response.ok) throw Object.assign(new Error(`PDDIKTI merespons HTTP ${response.status}. Coba lagi beberapa saat.`),{status:response.status,retryAfter:response.headers.get('retry-after')});
  const data=await response.json(),fetched_at=new Date().toISOString();
  if (input.action==='pt') {
    const page=unwrapPage(data,input.page);
    const items=page.data.map(pt=>{
      if (!pt.id_sp||pt.provinsi_pt!=='Prov. Aceh') throw new Error('Daftar PT tidak sesuai filter Aceh.');
      return {id:pt.id_sp,nama:String(pt.nama_pt||'').trim(),status:String(pt.status_pt||'').trim(),kab_kota:String(pt.kab_kota_pt||'').trim(),jenis:String(pt.jenis_pt||'').trim(),jumlah_prodi_api:pt.jumlah_prodi};
    });
    return {items,page:page.page,totalPages:page.totalPages,totalItems:page.totalItems,fetched_at};
  }
  const items=unwrapList(data,input.action,{allowNull:['dosen','search'].includes(input.action)});
  if(input.action==='search')return {items:items.map(d=>Object.fromEntries(['id','nama','nidn','nuptk','nama_pt','nama_prodi'].map(key=>[key,String(d[key]||'').trim()]))),fetched_at};
  if (input.action==='prodi') return {items:items.map(p=>{
    if (!p.id_sms||!p.nama_prodi) throw new Error('Identitas prodi tidak tersedia.');
    return {id:p.id_sms,id_pt:input.id,nama:String(p.nama_prodi).trim(),kode:String(p.kode_prodi||''),jenjang:String(p.jenjang_prodi||''),status:String(p.status_prodi||''),jumlah_dosen_api:p.jumlah_dosen};
  }),fetched_at};
  return {items:items.map(d=>{
    if (!d.nama_dosen) throw new Error('Nama dosen tidak tersedia dari sumber.');
    return Object.fromEntries(['id_sdm','nama_dosen','nidn','nuptk','pendidikan','status_aktif','ikatan_kerja'].map(key=>[key,String(d[key]||'').trim()]));
  }),empty_response:data.data===null,fetched_at};
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let input='';for await (const chunk of process.stdin) input+=chunk;
  try {console.log(JSON.stringify(await liveApi(JSON.parse(input))));}
  catch(error) {console.log(JSON.stringify({error:error.message,status:error.status||502,retryAfter:error.retryAfter||null}));}
}
