import { filterLecturers, normalize,tokens,searchScore,compileQuery,matchesText } from './filter.mjs';
import { enhanceSelects, syncSelect } from './search-select.js';
import { pageNumbers } from './pagination.mjs';
import { ApiClient, LiveData } from './live-data.mjs';
const $ = id => document.getElementById(id);
const format = value => Number(value || 0).toLocaleString('id-ID');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { data: null, engine:null, filtered:[], page:1, descending:false, sorting:false, loading:false, epoch:0, error:'', all:false, remote:null, searchQuery:'', searchEpoch:0 }; 
function filters() { return { query: $('search').value, pt: $('pt-filter').value, prodi: $('prodi-filter').value, status: $('status-filter').value }; }
const optionSignatures=new Map();
function options(id, rows, first) {
  const signature=first+'|'+rows.map(row=>row.id+'|'+row.label).join('\n');
  if(optionSignatures.get(id)===signature)return;optionSignatures.set(id,signature);
  const current = $(id).value;
  $(id).innerHTML = `<option value="">${first}</option>` + rows.map(row => `<option value="${escape(row.id)}">${escape(row.label)}</option>`).join('');
  $(id).value = rows.some(row => row.id === current) ? current : '';
  syncSelect(id);
}
function programOptions() {
  const pt = $('pt-filter').value;
  options('prodi-filter', state.data.prodi.filter(program => !pt || program.id_pt === pt)
    .sort((a,b) => a.nama.localeCompare(b.nama, 'id'))
    .map(program => ({ id: program.id, label: `${program.nama} (${program.jenjang})${pt ? '' : ' · ' + program.nama_pt}` })), 'Semua program studi');
}
function highlight(value){
  const raw=String(value??''),terms=tokens($('search').value).sort((a,b)=>b.length-a.length);
  if(!terms.length)return escape(raw);
  const expression=new RegExp(terms.join('|'),'giu');let output='',last=0;
  for(const match of raw.matchAll(expression)){output+=escape(raw.slice(last,match.index))+'<mark>'+escape(match[0])+'</mark>';last=match.index+match[0].length;}
  return output+escape(raw.slice(last));
}
function badge(status) { return `<span class="badge ${status === 'Aktif' ? '' : 'inactive'}">${escape(status || 'Tidak tersedia')}</span>`; }
function renderLecturers(resetPage = true) {
  if (!state.data) return;
  if (resetPage) state.page = 1;
  state.filtered = filterLecturers(state.remote||state.data.dosen, state.remote?{query:$('search').value}:filters());
  if(state.sorting)state.filtered.sort((a,b)=>(state.descending?-1:1)*a.nama.localeCompare(b.nama,'id'));
  const size = Number($('page-size').value), pages = Math.max(1, Math.ceil(state.filtered.length / size));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * size, rows = state.filtered.slice(start, start + size);
  $('result-count').textContent=state.remote?format(state.filtered.length)+' hasil pencarian API · '+(state.loading?'memeriksa PT Aceh…':state.error?'hasil parsial':'seluruh Aceh'):`${format(state.filtered.length)} dosen dimuat${(state.remote!==null||state.data.metadata.selection_complete)?'':' · cakupan belum selesai'}`;
  $('search-hint').textContent=state.remote?'Hasil API terkini untuk '+state.searchQuery+'. Filter PT/prodi akan kembali ke direktori semester.':'Ketik untuk menyaring hasil yang dimuat. Enter atau Cari seluruh Aceh untuk mencari langsung di PDDIKTI.';
  $('search-clear').hidden=!$('search').value;
  $('search-api').disabled=state.loading||tokens($('search').value).join(' ').length<3;
  $('search-back').hidden=state.remote===null;
  $('dosen-rows').innerHTML = rows.length ? rows.map((lecturer, index) => {
    const activeFilters = filters();
    const affiliations = lecturer.afiliasi.filter(a => (!activeFilters.pt || a.id_pt === activeFilters.pt)
      && (!activeFilters.prodi || a.id_prodi === activeFilters.prodi) && (!activeFilters.status || a.status_pt === activeFilters.status));
    const first = affiliations.find(a=>searchScore(lecturer,compileQuery($('search').value),[a])>=0)||affiliations[0]||lecturer.afiliasi[0];
    return `<tr><td class="row-number">${format(start + index + 1)}</td><td class="name-cell">${highlight(lecturer.nama)}<small>${escape(lecturer.pendidikan || (state.remote?'Hasil pencarian PDDIKTI':'Pendidikan tidak tersedia'))}</small></td><td class="nidn">${highlight(lecturer.nidn || '—')}</td><td class="affiliation"><strong>${highlight(first.nama_pt)}</strong><small>${highlight(first.nama_prodi)}${first.jenjang?' · '+escape(first.jenjang):''}</small>${affiliations.length > 1 ? `<span class="more">+${affiliations.length - 1} homebase lainnya</span>` : ''}</td><td>${badge(lecturer.status)}</td><td><button type="button" class="detail-button" data-id="${escape(lecturer.id)}" aria-label="Detail ${escape(lecturer.nama)}">↗</button></td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">${state.remote!==null ? (state.loading?'Mencari dosen di PDDIKTI…':state.error?'Hasil belum dapat dimuat. Klik Cari seluruh Aceh untuk mencoba lagi.':'Tidak ada hasil yang cocok dari pencarian PDDIKTI untuk PT di Aceh.') : state.data.dosen.length ? 'Belum ada dosen yang sesuai pada hasil yang dimuat.<br>Coba Cari seluruh Aceh atau pilih PT/prodi.' : 'Nama dosen belum dimuat.<br>Pilih PT/prodi atau klik Muat lebih banyak untuk melanjutkan.'}</td></tr>`;
  $('page-info').textContent = state.remote!==null&&(state.loading||state.error)?'Pencarian belum selesai':(state.remote!==null||state.data.metadata.selection_complete) ? `Halaman ${format(state.page)} dari ${format(pages)}` : `Halaman ${format(state.page)} · total belum diketahui`;
  $('row-range').textContent = rows.length ? `${format(start+1)}–${format(start+rows.length)} dari ${format(state.filtered.length)} dosen dimuat` : '0 dosen';
  $('page-numbers').innerHTML = pageNumbers(state.page,pages).map(page=>page === '…'
    ? '<span class="page-ellipsis" aria-hidden="true">…</span>'
    : `<button type="button" data-page="${page}" class="page-number${page === state.page ? ' current' : ''}" aria-label="Halaman ${page}"${page === state.page ? ' aria-current="page"' : ''}>${format(page)}</button>`).join('');
  $('jump-page').max = String(pages+((state.remote!==null||state.data.metadata.selection_complete)?0:1)); $('jump-page').value = String(state.page);
  $('prev').disabled = state.loading||state.page<=1; $('next').disabled = state.loading||(state.page>=pages&&(state.remote!==null||state.data.metadata.selection_complete));
  $('page-numbers').querySelectorAll('button').forEach(button=>button.disabled=state.loading);
  $('jump-form').querySelector('button').disabled=state.loading;
  $('load-more').disabled=state.loading||(state.remote!==null||state.data.metadata.selection_complete);
  $('load-all').textContent=state.all?'Jeda pemuatan':'Muat seluruh cakupan';
  $('load-all').disabled=!state.all&&(state.loading||(state.remote!==null||state.data.metadata.selection_complete));
  $('sort-name').disabled=!(state.remote!==null||state.data.metadata.selection_complete);
  $('sort-name').title=(state.remote!==null||state.data.metadata.selection_complete)?'Urutkan nama':'Urutan halaman mengikuti kedatangan API sampai cakupan selesai';
  $('export').disabled = !state.filtered.length;
}
function renderInstitutions() {
  if (!state.data||$('panel-pt').hidden) return;
  const query = normalize($('pt-search').value);
  const counts = new Map();
  for (const lecturer of state.data.dosen) for (const id of new Set(lecturer.afiliasi.map(a=>a.id_pt))) counts.set(id, (counts.get(id) || 0) + 1);
  const programs = new Map();
  for (const program of state.data.prodi) programs.set(program.id_pt, (programs.get(program.id_pt) || 0) + 1);
  const rows = state.data.perguruan_tinggi.filter(pt => matchesText(pt.nama+' '+pt.kab_kota,query)).sort((a,b)=>a.nama.localeCompare(b.nama,'id'));
  $('pt-rows').innerHTML = rows.length ? rows.map(pt => `<tr><td class="name-cell"><a href="${escape(state.data.metadata.source + '/detail-pt/' + pt.id)}" target="_blank" rel="noopener noreferrer">${escape(pt.nama)} ↗</a><small>${escape(pt.jenis)}</small></td><td>${escape(pt.kab_kota)}</td><td>${badge(pt.status)}</td><td>${state.engine.byPT.has(pt.id)?format(programs.get(pt.id)):'—'}</td><td>${state.engine.byPT.has(pt.id)?format(counts.get(pt.id))+' dimuat':'—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Perguruan tinggi tidak ditemukan.</td></tr>';
}
function renderMetadata() {
  const meta=state.data.metadata,c=meta.coverage,complete=state.remote!==null?!state.error&&!state.loading:meta.selection_complete;
  const year=Number(meta.semester.slice(0,4));
  $('semester').textContent=state.remote!==null?'Terkini · pencarian API':(meta.semester.endsWith('1')?'Ganjil':'Genap')+' '+year+'/'+(year+1);
  $('updated').textContent=meta.updated_at?'API diperiksa '+new Date(meta.updated_at).toLocaleTimeString('id-ID',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})+' UTC+7':'Menghubungi API PDDIKTI';
  const count=state.remote!==null?state.remote.length:c.unique_lecturers;
  $('stat-dosen-label').textContent=state.remote!==null?'Dosen ditemukan':'Dosen unik dimuat';
  $('stat-dosen-note').textContent=state.remote!==null?'Hasil pencarian API untuk Aceh':'Hasil API pada sesi halaman ini';
  $('stat-dosen').textContent=format(count);$('tab-count').textContent=format(count);
  $('stat-pt').textContent=c.pt_expected===null?'—':format(c.pt_expected);
  $('stat-pt-note').textContent=format(c.pt_found)+' PT sudah dimuat dari API';
  $('stat-prodi').textContent=format(c.prodi_found);$('stat-prodi-note').textContent=format(c.prodi_processed)+' prodi sudah dimuat dosennya';
  $('stat-coverage').textContent=state.loading?'Memuat':complete?'Siap':'Live';$('stat-coverage-note').textContent=state.remote!==null?'Hasil yang dikembalikan PDDIKTI':complete?'Cakupan pilihan selesai':'Data diambil sesuai kebutuhan';
  $('notice').className='notice'+(state.error?' error':complete?' success':'');
  $('notice').textContent=state.error|| (state.loading?'Memuat data langsung dari PDDIKTI…':state.remote?'Hasil pencarian API terkini untuk PT di Aceh. Data pencarian tidak memakai filter semester.':complete?'Seluruh prodi pada cakupan pilihan berhasil dimuat dari API.':'Data dimuat bertahap dari API. Pilih PT/prodi untuk hasil lebih cepat; pencarian berlaku pada dosen yang sudah dimuat.');
  $('scope').textContent=meta.scope;
  const different=state.data.prodi.filter(p=>p.jumlah_dosen_terambil!==undefined&&p.jumlah_dosen_terambil!==p.jumlah_dosen_api).length;
  $('count-differences').hidden=!different;$('count-differences').textContent=format(different)+' prodi memiliki jumlah nama homebase berbeda dari ringkasan PDDIKTI; seluruh nama dari daftar homebase disertakan.';
  $('progress').innerHTML=[['PT dari API',format(c.pt_found)+' / '+(c.pt_expected===null?'—':format(c.pt_expected))+' PT'],['Prodi dimuat',format(c.pt_processed)+' PT'],['Homebase dimuat',format(c.prodi_processed)+' / '+format(c.prodi_found)+' prodi'],['Permintaan API sesi ini',format(state.engine.client.requests)+' permintaan']].map(([label,value])=>'<li><span>'+label+'</span><strong>'+value+'</strong></li>').join('');
  $('error-section').hidden=!meta.errors.length;
  $('errors').innerHTML=meta.errors.map(error=>'<li>'+escape(error.nama_pt||'')+' · '+escape(error.nama_prodi||'')+': '+escape(error.message)+'</li>').join('');
}
let scheduledView=false;
function scheduleView(){if(scheduledView)return;scheduledView=true;requestAnimationFrame(()=>{scheduledView=false;updateView();});}
function updateView() {
  state.data=state.engine.snapshot(filters());
  options('pt-filter',state.data.perguruan_tinggi.slice().sort((a,b)=>a.nama.localeCompare(b.nama,'id')).map(pt=>({id:pt.id,label:pt.nama})),'Semua perguruan tinggi');
  options('status-filter',[...new Set(state.data.perguruan_tinggi.map(pt=>pt.status))].sort().map(status=>({id:status,label:status})),'Semua status');
  programOptions();renderMetadata();renderLecturers(false);renderInstitutions();
}
async function fillPage(target,{all=false,keepPage=false}={}) {
  const model=state.engine,epoch=++state.epoch,scope={...filters()};
  const active=()=>state.engine===model&&state.epoch===epoch;
  state.loading=true;state.all=all;state.error='';state.sorting=false;updateView();
  try {
    if(scope.pt) {const pt=model.institutions.get(scope.pt);if(pt)await model.loadPrograms(pt);}
    if(!active())return;
    const minimum=all?Number.MAX_SAFE_INTEGER:Math.max(1,target)*Number($('page-size').value);
    do {await model.ensure(scope,minimum,{active,onUpdate:scheduleView,budget:8});}while(all&&active()&&!model.complete(scope));
    if(active()&&!keepPage)state.page=Math.min(target,Math.max(1,Math.ceil(model.rowsFor(scope).length/Number($('page-size').value))));
  }catch(error){if(active())state.error=error.message;}
  finally {if(active()){state.loading=false;state.all=false;updateView();if(!state.error)model.prefetch(scope);}}
}
async function navigate(page) {
  const available=Math.max(1,Math.ceil(state.filtered.length/Number($('page-size').value)));
  if(page<=available&&(state.remote!==null||state.engine.complete(filters())||state.filtered.length>=page*Number($('page-size').value))){state.page=page;renderLecturers(false);return;}
  await fillPage(page);
}
function scopeChanged() {state.remote=null;state.searchEpoch++;state.epoch++;state.all=false;state.loading=false;state.page=1;state.sorting=false;fillPage(1);}
async function load() {
  const model=new LiveData(new ApiClient());state.engine=model;state.remote=null;state.searchEpoch++;state.epoch++;state.loading=true;state.error='';state.page=1;state.sorting=false;state.all=false;
  $('filters').reset();updateView();
  try {
    const initialEpoch=state.epoch;
    await model.loadPTPage(1);if(state.engine!==model)return;updateView();
    if(state.epoch===initialEpoch)await fillPage(1);
    if(state.engine===model)model.loadIndex(()=>{if(state.engine===model)scheduleView();},()=>state.engine===model).catch(error=>{if(state.engine===model){state.error='Sebagian daftar PT belum dimuat: '+error.message;updateView();}});
  }catch(error){if(state.engine===model){state.error=error.message;state.loading=false;updateView();}}
}
function detail(id) {
  const lecturer = (state.remote||state.data.dosen).find(row=>row.id === id);
  if (!lecturer) return;
  $('detail-name').textContent = lecturer.nama;
  $('detail-facts').innerHTML = [['NIDN',lecturer.nidn],['NUPTK',lecturer.nuptk],['Pendidikan',lecturer.pendidikan],['Status',lecturer.status],['Ikatan kerja',lecturer.ikatan_kerja]].map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value || 'Tidak tersedia')}</dd></div>`).join('');
  $('detail-affiliations').innerHTML = lecturer.afiliasi.map(a=>`<div class="homebase"><strong>${escape(a.nama_pt)}</strong><p>${escape(a.nama_prodi)} · ${escape(a.jenjang)}<br>${escape(a.kab_kota)} · Status PT: ${escape(a.status_pt)} · Semester ${escape(a.semester)}</p></div>`).join('');
  $('detail-source').hidden = false;
  $('detail-source').href = 'profile.php?id=' + encodeURIComponent(lecturer.id) + '&nidn='+encodeURIComponent(lecturer.nidn)+'&nuptk='+encodeURIComponent(lecturer.nuptk)+'&nama='+encodeURIComponent(lecturer.nama)+'&redirect=1';
  if(lecturer.profile_id)$('detail-source').href=state.data.metadata.source+'/detail-dosen/'+lecturer.profile_id;
  $('detail-source').title = 'Mencari ID profil terbaru dan memeriksa kecocokan identitas di PDDIKTI';
  $('detail').showModal();
}
function exportCsv() {
  const cells = value => { let cell = String(value ?? ''); if (/^[=+@-]/.test(cell)) cell = "'" + cell; return '"' + cell.replaceAll('"','""') + '"'; };
  const rows = [['Nama','NIDN','NUPTK','Pendidikan','Status dosen','Perguruan tinggi','Program studi','Jenjang','Status PT','Semester']];
  const f = filters();
  for (const lecturer of state.filtered) for (const a of lecturer.afiliasi) {
    if ((f.pt && a.id_pt !== f.pt) || (f.prodi && a.id_prodi !== f.prodi) || (f.status && a.status_pt !== f.status)) continue;
    rows.push([lecturer.nama,lecturer.nidn,lecturer.nuptk,lecturer.pendidikan,lecturer.status,a.nama_pt,a.nama_prodi,a.jenjang,a.status_pt,a.semester]);
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row=>row.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `dosen-aceh-${state.data.metadata.semester}-filter.csv`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function searchApi(){
 const query=$('search').value.trim();if(tokens(query).join(' ').length<3)return;
 state.epoch++;const epoch=++state.searchEpoch,model=state.engine;state.remote=[];state.searchQuery=query;state.loading=true;state.all=false;state.error='';state.page=1;
 $('pt-filter').value='';$('prodi-filter').value='';$('status-filter').value='';for(const id of ['pt-filter','prodi-filter','status-filter'])syncSelect(id);
 updateView();const active=()=>state.engine===model&&state.searchEpoch===epoch;
 try{const results=await model.search(query,{active,onUpdate:results=>{if(active()){state.remote=results;scheduleView();}}});if(active())state.remote=results;}
 catch(error){if(active())state.error=error.message;}
 finally{if(active()){state.loading=false;updateView();}}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();searchApi();});
$('search-api').addEventListener('click',searchApi);
function resetSearchView(){state.epoch++;state.searchEpoch++;state.remote=null;state.loading=false;state.all=false;state.page=1;state.sorting=false;state.error='';renderMetadata();renderLecturers(false);}
$('search').addEventListener('input',resetSearchView);
$('search-clear').addEventListener('click',()=>{$('search').value='';resetSearchView();$('search').focus();});
$('search-back').addEventListener('click',()=>{state.remote=null;$('search').value='';scopeChanged();});
for(const id of ['prodi-filter','status-filter'])$(id).addEventListener('change',scopeChanged);
$('page-size').addEventListener('change',()=>{if(state.remote!==null){state.page=1;renderLecturers(false);}else scopeChanged();});
$('pt-filter').addEventListener('change',()=>{$('prodi-filter').value='';programOptions();scopeChanged();});
$('reset').addEventListener('click',()=>{$('filters').reset();for(const id of ['pt-filter','status-filter','prodi-filter'])syncSelect(id);scopeChanged();});
$('sort-name').addEventListener('click',()=>{state.descending=state.sorting?!state.descending:false;state.sorting=true;state.page=1;$('sort-name').querySelector('span').textContent=state.descending?'↓':'↑';renderLecturers(false);});
$('prev').addEventListener('click',()=>navigate(state.page-1));$('next').addEventListener('click',()=>navigate(state.page+1));
$('page-numbers').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(button)navigate(Number(button.dataset.page));});
$('jump-form').addEventListener('submit',event=>{event.preventDefault();if($('jump-page').checkValidity())navigate(Number($('jump-page').value));});
$('load-more').addEventListener('click',()=>fillPage(state.page+1,{keepPage:true}));
$('load-all').addEventListener('click',()=>{if(state.all){state.epoch++;state.loading=false;state.all=false;updateView();}else fillPage(state.page,{all:true,keepPage:true});});
$('pt-search').addEventListener('input',renderInstitutions);$('refresh').addEventListener('click',load);$('export').addEventListener('click',exportCsv);
$('dosen-rows').addEventListener('click',event=>{const button=event.target.closest('[data-id]');if(button)detail(button.dataset.id);});
$('close-detail').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('click',event=>{if(event.target===$('detail')){const rect=$('detail').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('detail').close();}});
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-json').addEventListener('click',()=>download('dosen-aceh-live.json',JSON.stringify(state.remote!==null?{metadata:{source:state.data.metadata.source,mode:'search',query:state.searchQuery,semester:'Terkini',pt_index_complete:state.engine.indexComplete,search_complete:!state.loading&&!state.error,errors:state.error?[state.error]:[],scope:'Hasil yang dikembalikan pencarian PDDIKTI, dicocokkan dengan daftar PT Aceh.'},dosen:state.remote}:state.data,null,2),'application/json'));
$('export-txt').addEventListener('click',()=>download('nama-dosen-aceh-live.txt',state.filtered.map(row=>row.nama).join('\r\n'),'text/plain;charset=utf-8'));
$('export-csv').addEventListener('click',exportCsv);
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));});for(const name of ['dosen','pt','coverage'])$('panel-'+name).hidden=name!==button.dataset.tab;if(button.dataset.tab==='pt')renderInstitutions();}));
enhanceSelects(['pt-filter','prodi-filter','status-filter','page-size']);
await load();
