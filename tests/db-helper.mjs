import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
export async function createDatabase(){
 const pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await pg.exec(await fs.readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 const rpc=async(name,params={})=>{
  const entries=Object.entries(params),args=entries.map(([key],i)=>key+' => $'+(i+1)).join(',');
  const values=entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value);
  return (await pg.query('select public.'+name+'('+args+') as result',values)).rows[0].result;
 };
 return {pg,db:{rpc}};
}
export function fixtureSource({count=36}={}){
 return async request=>{
  if(request.action==='pt')return {items:[{id:'pt-a',nama:'Universitas Aceh',status:'Aktif',kab_kota:'Banda Aceh'},{id:'pt-b',nama:'Institut Aceh',status:'Tutup',kab_kota:'Aceh Besar'}],page:1,totalPages:1,totalItems:2};
  if(request.action==='prodi')return {items:[{id:request.id+'-p',id_pt:request.id,nama:request.id==='pt-a'?'Teknik Sipil':'Hukum',jenjang:'S1',status:'Aktif',jumlah_dosen_api:request.id==='pt-a'?count:1}]};
  return {items:request.id==='pt-a-p'?Array.from({length:count},(_,i)=>({nama_dosen:i===0?'MUHAMMAD ÁLI':'DOSEN UJI '+String(i).padStart(3,'0'),nidn:String(1000000000+i),nuptk:i===0?'1234567890123456':'',id_sdm:'sdm-'+i,status_aktif:'Aktif',pendidikan:'S2'})):[{nama_dosen:'MUHAMMAD ALI',nidn:'',nuptk:'1234567890123456',id_sdm:'another-id',status_aktif:'Aktif'}]};
 };
}
