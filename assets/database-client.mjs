export class DirectoryClient {
 constructor({fetcher=(...args)=>globalThis.fetch(...args),ttl=60000,max=20}={}){this.fetcher=fetcher;this.ttl=ttl;this.max=max;this.cache=new Map();this.pending=new Map();}
 async request(params){
  const q=new URLSearchParams(params).toString(),key=q,now=Date.now(),cached=this.cache.get(key);
  if(cached&&now-cached.at<this.ttl){this.cache.delete(key);this.cache.set(key,cached);return cached.data;}
  if(this.pending.has(key))return this.pending.get(key);
  const promise=(async()=>{
   const response=await this.fetcher('api/directory?'+q,{cache:'no-store',signal:AbortSignal.timeout(30000)}),data=await response.json();
   if(!response.ok||data.error)throw new Error(data.error||'Database belum dapat diakses.');
   this.cache.set(key,{at:Date.now(),data});while(this.cache.size>this.max)this.cache.delete(this.cache.keys().next().value);
   return data;
  })().finally(()=>this.pending.delete(key));
  this.pending.set(key,promise);return promise;
 }
 meta(){return this.request({action:'meta'});}
 list(filters,page,size,desc=false){return this.request({action:'list',q:filters.query||'',pt:filters.pt||'',prodi:filters.prodi||'',status:filters.status||'',page,size,desc:desc?'1':'0'});}
 async all(filters,{desc=false,onProgress=()=>{}}={}){
  const scope={...filters},rows=[],ids=new Set();let run,total;
  for(let page=1;;page++){
   const result=await this.list(scope,page,500,desc);
   if(page===1){run=result.run_id;total=Number(result.total);}
   if(result.run_id!==run||Number(result.total)!==total)throw new Error('Data berubah selama unduhan. Silakan unduh ulang.');
   for(const row of result.items){if(ids.has(row.id))throw new Error('Data berubah selama unduhan. Silakan unduh ulang.');ids.add(row.id);rows.push(row);}
   onProgress(rows.length,total);
   if(rows.length===total)return rows;
   if(!result.items.length||rows.length>total)throw new Error('Unduhan belum lengkap. Silakan coba lagi.');
  }
 }
 clear(){this.cache.clear();}
}
