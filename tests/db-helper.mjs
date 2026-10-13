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
 const table=async(name,{method='GET',query={},body}={})=>{
  if(!/^da_[a-z_]+$/.test(name))throw new Error('Invalid table');
  const values=[],conditions=[];const parameter=value=>{values.push(value);return '$'+values.length;};
  for(const [column,filter] of Object.entries(query)){
   if(['select','order','limit','offset','on_conflict'].includes(column))continue;
   if(!/^[a-z_]+$/.test(column))throw new Error('Invalid column');
   if(filter==='is.null')conditions.push(column+' is null');
   else if(filter.startsWith('eq.'))conditions.push(column+'='+parameter(filter.slice(3)));
   else if(filter.startsWith('in.('))conditions.push(column+'=any('+parameter(JSON.parse('['+filter.slice(4,-1)+']'))+'::text[])');
   else throw new Error('Unsupported filter');
  }
  const where=conditions.length?' where '+conditions.join(' and '):'';
  if(method==='GET')return (await pg.query('select '+(query.select||'*')+' from public.'+name+where+(query.order?' order by '+query.order:'')+' limit '+Number(query.limit||1000)+' offset '+Number(query.offset||0),values)).rows;
  if(method==='DELETE')return (await pg.query('delete from public.'+name+where+' returning *',values)).rows;
  if(method==='PATCH'){
   const assignments=Object.entries(body).map(([column,value])=>column+'='+parameter(typeof value==='object'?JSON.stringify(value):value));
   return (await pg.query('update public.'+name+' set '+assignments.join(',')+where+' returning *',values)).rows;
  }
  if(method==='POST'){
   const rows=Array.isArray(body)?body:[body],columns=Object.keys(rows[0]),keys=(query.on_conflict||'').split(',');
   const updates=columns.filter(column=>!keys.includes(column)).map(column=>column+'=excluded.'+column).join(',');
   return (await pg.query('insert into public.'+name+'('+columns.join(',')+') select '+columns.join(',')+' from jsonb_populate_recordset(null::public.'+name+',$1::jsonb) on conflict('+query.on_conflict+') do update set '+updates+' returning *',[JSON.stringify(rows)])).rows;
  }
  throw new Error('Unsupported method');
 };
 return {pg,db:{rpc,table}};
}
export function fixtureSource({count=36}={}){
 return async request=>{
  if(request.action==='pt')return {items:[{id:'pt-a',nama:'Universitas Aceh',status:'Aktif',kab_kota:'Banda Aceh'},{id:'pt-b',nama:'Institut Aceh',status:'Tutup',kab_kota:'Aceh Besar'}],page:1,totalPages:1,totalItems:2};
  if(request.action==='prodi')return {items:[{id:request.id+'-p',id_pt:request.id,nama:request.id==='pt-a'?'Teknik Sipil':'Hukum',jenjang:'S1',status:'Aktif',jumlah_dosen_api:request.id==='pt-a'?count:1}]};
  return {items:request.id==='pt-a-p'?Array.from({length:count},(_,i)=>({nama_dosen:i===0?'MUHAMMAD ÁLI':'DOSEN UJI '+String(i).padStart(3,'0'),nidn:String(1000000000+i),nuptk:i===0?'1234567890123456':'',id_sdm:'sdm-'+i,status_aktif:'Aktif',pendidikan:'S2'})):[{nama_dosen:'MUHAMMAD ALI',nidn:'',nuptk:'1234567890123456',id_sdm:'another-id',status_aktif:'Aktif'}]};
 };
}
