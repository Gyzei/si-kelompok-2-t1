export class Database {
  constructor({url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY,fetcher=fetch}={}) {
    if(!url||!key)throw Object.assign(new Error('Database belum terhubung. Pengelola perlu menyelesaikan konfigurasi Supabase di server.'),{status:503});
    const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('URL Supabase tidak valid.');
    this.url=parsed.origin;this.key=key;this.fetcher=fetcher;
  }
  async rpc(name,params={}) {
    if(!/^da_[a-z_]+$/.test(name))throw new Error('Database function not allowed');
    return this.request('/rest/v1/rpc/'+name,{method:'POST',body:params});
  }
  async table(name,{method='GET',query={},body}={}){
    if(!['da_runs','da_state','da_programs','da_lecturers','da_affiliations'].includes(name))throw new Error('Table not allowed');
    if(!['GET','POST','PATCH','DELETE'].includes(method))throw new Error('Method not allowed');
    return this.request('/rest/v1/'+name+'?'+new URLSearchParams(query),{method,body});
  }
  async request(path,{method,body}){
    const headers={'Content-Type':'application/json',apikey:this.key};
    // New sb_secret keys belong in apikey. Legacy service_role keys are JWTs.
    if(this.key.startsWith('eyJ'))headers.Authorization='Bearer '+this.key;
    headers.Prefer=method==='POST'?'resolution=merge-duplicates,return=representation':'return=representation';
    let response;
    try {response=await this.fetcher(this.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});}
    catch {throw Object.assign(new Error('Koneksi database terputus. Coba lagi.'),{status:502,retryable:true});}
    if(!response.ok)throw Object.assign(new Error('Permintaan database gagal (HTTP '+response.status+'). Periksa skema SQL dan konfigurasi server.'),{status:502,retryable:response.status>=500||response.status===429});
    const raw=await response.text();return raw?JSON.parse(raw):null;
  }
}
export function searchParameters(query) {
  const integer=(key,fallback)=>{const raw=query.get(key);return raw===null?fallback:Number(raw);};
  const page=integer('page',1),size=integer('size',25),text=query.get('q')||'';
  if(!Number.isSafeInteger(page)||page<1||page>100000||![25,50,100,500].includes(size)||text.length>120)
    throw Object.assign(new Error('Parameter pencarian tidak valid.'),{status:400});
  for(const key of ['pt','prodi','status'])if((query.get(key)||'').length>200)throw Object.assign(new Error('Filter tidak valid.'),{status:400});
  return {p_query:text.trim(),p_pt:query.get('pt')||'',p_prodi:query.get('prodi')||'',p_status:query.get('status')||'',p_page:page,p_size:size,p_desc:query.get('desc')==='1'};
}
