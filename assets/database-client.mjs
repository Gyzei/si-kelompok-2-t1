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
 clear(){this.cache.clear();}
}
