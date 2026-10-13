import { filterLecturers,invalidateSearch,institutionKey } from './filter.mjs';

export class ApiClient {
  constructor({fetcher=(...args)=>globalThis.fetch(...args),delay=500}={}) {this.fetcher=fetcher;this.delay=delay;this.cache=new Map();this.pending=new Map();this.gate=Promise.resolve();this.next=0;this.requests=0;this.queue=[];this.running=0;this.background=0;}
  get(request,{priority=0}={}) {
    const key=JSON.stringify(request);
    if(this.cache.has(key))return Promise.resolve(this.cache.get(key));
    if(this.pending.has(key)){const entry=this.pending.get(key);entry.job.priority=Math.min(entry.job.priority,priority);this.dispatch();return entry.promise;}
    let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const job={request,priority,resolve,reject};
    const promise=pending.then(data=>{this.cache.set(key,data);return data;}).finally(()=>this.pending.delete(key));
    this.pending.set(key,{promise,job});this.queue.push(job);this.dispatch();return promise;
  }
  dispatch(){
    this.queue.sort((a,b)=>a.priority-b.priority);
    while(this.running<3){const next=this.queue.findIndex(job=>job.priority===0||this.background<1);if(next<0)break;
      const [job]=this.queue.splice(next,1),background=job.priority>0;this.running++;if(background)this.background++;
      this.run(job.request).then(job.resolve,job.reject).finally(()=>{this.running--;if(background)this.background--;this.dispatch();});
    }
  }
  invalidate(request){this.cache.delete(JSON.stringify(request));}
  async run(request,attempt=0) {
    const gate=this.gate.then(async()=>{const wait=Math.max(0,this.next-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));this.next=Date.now()+this.delay;});
    this.gate=gate.catch(()=>{});await gate;
    this.requests++;
    let response;
    try {response=await this.fetcher('api.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),cache:'no-store',signal:AbortSignal.timeout(30000)});}
    catch(error){if(attempt<1){await new Promise(resolve=>setTimeout(resolve,750));return this.run(request,attempt+1);}throw new Error('Koneksi API terputus. Klik Ambil data terbaru untuk mencoba lagi.');}
    const data=await response.json();
    if(!response.ok||data.error){
      const error=Object.assign(new Error(data.error||'API belum dapat diakses.'),{status:response.status});
      if(response.status===429){const retry=data.retryAfter;const pause=/^\d+$/.test(retry||'')?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now());this.next=Math.max(this.next,Date.now()+(pause||30000));}
      if(response.status>=500&&attempt<1){await new Promise(resolve=>setTimeout(resolve,750));return this.run(request,attempt+1);}
      throw error;
    }
    return data;
  }
}

export class LiveData {
  constructor(client,{semester='20261'}={}) {
    this.client=client;this.semester=semester;this.institutions=new Map();this.pages=new Map();this.total=null;this.totalPages=null;
    this.programs=new Map();this.byPT=new Map();this.loaded=new Set();this.rows=new Map();this.aliases=new Map();this.errors=new Map();this.updated=null;this.sequence=0;this.rowsVersion=0;
  }
  get indexComplete(){return this.totalPages!==null&&this.pages.size===this.totalPages&&this.institutions.size===this.total;}
  async loadPTPage(page,priority=0) {
    if(this.pages.has(page))return;
    const result=await this.client.get({action:'pt',page,semester:this.semester},{priority});
    if(this.total!==null&&(this.total!==result.totalItems||this.totalPages!==result.totalPages))throw new Error('Daftar PT berubah selama pemuatan. Perbarui data untuk mulai kembali.');
    this.total=result.totalItems;this.totalPages=result.totalPages;
    for(const pt of result.items)this.institutions.set(pt.id,pt);
    this.pages.set(page,true);this.updated=result.fetched_at;
    if(this.pages.size===this.totalPages&&this.institutions.size!==this.total)throw new Error('Jumlah PT unik berbeda dari total API. Perbarui data.');
  }
  async loadIndex(onUpdate,active=()=>true,priority=1) {
    if(priority===0){
      await this.loadPTPage(1,priority);if(active())onUpdate?.();
      const missing=Array.from({length:this.totalPages},(_,i)=>i+1).filter(page=>!this.pages.has(page));
      for(let i=0;active()&&i<missing.length;i+=2){
        const outcomes=await Promise.allSettled(missing.slice(i,i+2).map(async page=>{await this.loadPTPage(page,priority);if(active())onUpdate?.();}));
        if(!active())return;const failed=outcomes.find(result=>result.status==='rejected');if(failed)throw failed.reason;
      }
      return;
    }
    for(let page=1;active()&&(this.totalPages===null||page<=this.totalPages);page++){
      await this.loadPTPage(page,priority);if(active())onUpdate?.();
    }
  }
  async loadPrograms(pt) {
    if(this.byPT.has(pt.id))return this.byPT.get(pt.id);
    const result=await this.client.get({action:'prodi',id:pt.id,semester:this.semester});
    const programs=result.items.map(p=>({...p,nama_pt:pt.nama,status_pt:pt.status,kab_kota:pt.kab_kota}));
    for(const p of programs)this.programs.set(p.id,p);
    this.byPT.set(pt.id,programs);this.updated=result.fetched_at;return programs;
  }
  selectedPT(scope){return [...this.institutions.values()].filter(pt=>(!scope.pt||pt.id===scope.pt)&&(!scope.status||pt.status===scope.status));}
  complete(scope) {
    if(!scope.pt&&!this.indexComplete)return false;
    const pts=this.selectedPT(scope);
    return pts.every(pt=>this.byPT.has(pt.id)&&this.byPT.get(pt.id).filter(p=>!scope.prodi||p.id===scope.prodi).every(p=>this.loaded.has(p.id)));
  }
  async nextProgram(scope,active,withinBudget=()=>true) {
    for(const pt of this.selectedPT(scope)) {
      if(!this.byPT.has(pt.id)&&!withinBudget())return null;
      const programs=await this.loadPrograms(pt);if(!active())return null;
      const next=programs.find(p=>(!scope.prodi||p.id===scope.prodi)&&!this.loaded.has(p.id));
      if(next)return next;
    }
    if(!scope.pt&&!this.indexComplete) {
      const page=Array.from({length:this.totalPages||1},(_,i)=>i+1).find(p=>!this.pages.has(p));
      if(page&&withinBudget()){await this.loadPTPage(page);if(active())return this.nextProgram(scope,active,withinBudget);}
    }
    return null;
  }
  merge(items,program) {
    items.forEach((item,index)=>{
      const valid=(value,length)=>new RegExp(`^\\d{${length}}$`).test(value||'')&&!/^0+$/.test(value);
      const keys=[valid(item.nidn,10)?'nidn:'+item.nidn:'',valid(item.nuptk,16)?'nuptk:'+item.nuptk:'',item.id_sdm?'sdm:'+item.id_sdm:''].filter(Boolean);
      const matched=[...new Set(keys.map(key=>this.aliases.get(key)).filter(key=>this.rows.has(key)))];
      const id=matched[0]||keys[0]||`record:${program.id}:${index}`;
      const affiliation={id_pt:program.id_pt,nama_pt:program.nama_pt,status_pt:program.status_pt,kab_kota:program.kab_kota,
        id_prodi:program.id,nama_prodi:program.nama,jenjang:program.jenjang,status_prodi:program.status,semester:this.semester};
      let row=this.rows.get(id);
      if(!row){row={id,nama:item.nama_dosen,nama_lain:[],nidn:valid(item.nidn,10)?item.nidn:'',nuptk:valid(item.nuptk,16)?item.nuptk:'',id_sdm:item.id_sdm,pendidikan:item.pendidikan,status:item.status_aktif,ikatan_kerja:item.ikatan_kerja,afiliasi:[],order:this.sequence++};this.rows.set(id,row);}
      for(const otherId of matched.slice(1)) {
        const other=this.rows.get(otherId);row.afiliasi.push(...other.afiliasi);this.rows.delete(otherId);
        for(const [key,owner] of this.aliases)if(owner===otherId)this.aliases.set(key,id);
      }
      if(item.nama_dosen!==row.nama&&!row.nama_lain.includes(item.nama_dosen))row.nama_lain.push(item.nama_dosen);
      row.nidn ||=valid(item.nidn,10)?item.nidn:'';row.nuptk ||=valid(item.nuptk,16)?item.nuptk:'';
      row.afiliasi.push(affiliation);row.afiliasi=[...new Map(row.afiliasi.map(a=>[a.id_pt+'|'+a.id_prodi,a])).values()];
      for(const key of keys)this.aliases.set(key,id);
      invalidateSearch(row);
    });
    this.rowsVersion++;
  }
  async loadDosen(program,prefetched=null) {
    if(this.loaded.has(program.id))return;
    const key='dosen:'+program.id;
    try {
      const result=prefetched||await this.client.get({action:'dosen',id:program.id,semester:this.semester});
      if(result.empty_response&&program.jumlah_dosen_api!==0)throw new Error('Daftar dosen kosong, tetapi ringkasan prodi masih menyebut dosen. Coba muat ulang.');
      this.merge(result.items,program);program.jumlah_dosen_terambil=result.items.length;this.loaded.add(program.id);this.errors.delete(key);this.updated=result.fetched_at;
    }catch(error){this.client.invalidate?.({action:'dosen',id:program.id,semester:this.semester});this.errors.set(key,{nama_pt:program.nama_pt,nama_prodi:program.nama,message:error.message});throw error;}
  }
  rowsFor(scope){return filterLecturers([...this.rows.values()].sort((a,b)=>a.order-b.order),scope);}
  async ensure(scope,minimum,{active=()=>true,onUpdate=()=>{},budget=8}={}) {
    let taken=0;const started=this.client.requests;
    while(active()&&this.rowsFor(scope).length<minimum&&!this.complete(scope)&&taken<budget) {
      const program=await this.nextProgram(scope,active,()=>this.client.requests-started<budget);if(!program||!active())break;
      const remaining=minimum-this.rowsFor(scope).length;
      const sibling=remaining>Math.max(1,program.jumlah_dosen_api||0)&&taken+1<budget
        ? (this.byPT.get(program.id_pt)||[]).find(p=>p.id!==program.id&&!this.loaded.has(p.id)&&(!scope.prodi||scope.prodi===p.id)):null;
      const plan=sibling?[program,sibling]:[program];
      const requests=plan.map(p=>this.client.get({action:'dosen',id:p.id,semester:this.semester}).then(result=>({result}),error=>({error})));
      for(let i=0;i<plan.length&&active();i++){
        const outcome=await requests[i];if(!active())break;
        if(outcome.error){this.errors.set('dosen:'+plan[i].id,{nama_pt:plan[i].nama_pt,nama_prodi:plan[i].nama,message:outcome.error.message});throw outcome.error;}
        await this.loadDosen(plan[i],outcome.result);taken++;if(active())onUpdate();
      }
    }
    return {complete:this.complete(scope),loaded:this.rowsFor(scope).length,budgetReached:taken===budget};
  }
  prefetch(scope){
    if(scope.query)return;
    const next=this.selectedPT(scope).flatMap(pt=>this.byPT.get(pt.id)||[]).find(p=>!this.loaded.has(p.id)&&(!scope.prodi||p.id===scope.prodi));
    if(next)this.client.get({action:'dosen',id:next.id,semester:this.semester},{priority:2}).catch(()=>{});
  }
  async search(query,{active=()=>true,onUpdate=()=>{}}={}){
    const compact=query.replace(/[\s.-]/g,''),sourceQuery=/^\d{10}$|^\d{16}$/.test(compact)?compact:query.trim();
    const promise=this.client.get({action:'search',query:sourceQuery});promise.catch(()=>{});
    const response=await promise;if(!active())return [];
    const match=()=>{
    const institutions=new Map([...this.institutions.values()].map(pt=>[institutionKey(pt.nama),pt]));
    const found=new Map();
    for(const item of response.items){const pt=institutions.get(institutionKey(item.nama_pt));if(!pt)continue;
      const valid=(value,length)=>new RegExp(`^\\d{${length}}$`).test(value||'')&&!/^0+$/.test(value);
      const id=valid(item.nidn,10)?'nidn:'+item.nidn:valid(item.nuptk,16)?'nuptk:'+item.nuptk:'profile:'+item.id;
      const affiliation={id_pt:pt.id,nama_pt:pt.nama,status_pt:pt.status,kab_kota:pt.kab_kota,id_prodi:'search:'+item.id,nama_prodi:item.nama_prodi,jenjang:'',semester:'Terkini'};
      const existing=found.get(id);if(existing){if(!existing.afiliasi.some(a=>a.id_pt===affiliation.id_pt&&a.nama_prodi===affiliation.nama_prodi))existing.afiliasi.push(affiliation);if(item.nama!==existing.nama)existing.nama_lain.push(item.nama);continue;}
      found.set(id,{id,nama:item.nama,nama_lain:[],nidn:item.nidn,nuptk:item.nuptk,profile_id:item.id,pendidikan:'',status:'',ikatan_kerja:'',afiliasi:[affiliation]});
    }
    return filterLecturers([...found.values()],{query});
    };
    onUpdate(match());
    await this.loadIndex(()=>{if(active())onUpdate(match());},active,0);
    return active()?match():[];
  }
  snapshot(scope={}) {
    return {perguruan_tinggi:[...this.institutions.values()],prodi:[...this.programs.values()],dosen:[...this.rows.values()].sort((a,b)=>a.order-b.order),
      metadata:{source:'https://pddikti.kemdiktisaintek.go.id',semester:this.semester,updated_at:this.updated,complete:this.complete({}),selection_complete:this.complete(scope),selection:{...scope},
        errors:[...this.errors.values()],coverage:{pt_expected:this.total,pt_found:this.institutions.size,pt_pages:this.pages.size,pt_processed:this.byPT.size,
          prodi_found:this.programs.size,prodi_processed:this.loaded.size,unique_lecturers:this.rows.size,errors:this.errors.size},
        scope:'Data API langsung untuk semester terpilih. Angka mencerminkan cakupan yang telah dimuat pada halaman ini.'}};
  }
}
