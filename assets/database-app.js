import {DirectoryClient} from './database-client.mjs';
import {enhanceSelects,syncSelect} from './search-select.js';
import {pageNumbers} from './pagination.mjs';
import {matchesText,tokens,searchScore} from './filter.mjs';
const $=id=>document.getElementById(id),client=new DirectoryClient();
const state={meta:null,rows:[],total:0,page:1,epoch:0,loading:false,error:'',desc:false,timer:null};
const number=value=>Number(value||0).toLocaleString('id-ID');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const filters=()=>({query:$('search').value.trim(),pt:$('pt-filter').value,prodi:$('prodi-filter').value,status:$('status-filter').value});
function highlight(value){
 const raw=String(value??''),terms=tokens($('search').value).sort((a,b)=>b.length-a.length);if(!terms.length)return escape(raw);
 let out='',last=0;for(const match of raw.matchAll(new RegExp(terms.join('|'),'giu'))){out+=escape(raw.slice(last,match.index))+'<mark>'+escape(match[0])+'</mark>';last=match.index+match[0].length;}return out+escape(raw.slice(last));
}
function options(id,rows,label){const value=$(id).value;$(id).innerHTML='<option value="">'+label+'</option>'+rows.map(row=>'<option value="'+escape(row.id)+'">'+escape(row.label)+'</option>').join('');$(id).value=rows.some(r=>r.id===value)?value:'';syncSelect(id);}
function programs(){options('prodi-filter',(state.meta?.prodi||[]).filter(p=>!$('pt-filter').value||p.id_pt===$('pt-filter').value).map(p=>({id:p.id,label:p.nama+' ('+p.jenjang+')'+($('pt-filter').value?'':' · '+p.nama_pt)})),'Semua program studi');}
function period(value){if(!value)return 'Belum ada sinkronisasi';const year=Number(value.slice(0,4));return(value.endsWith('1')?'Ganjil':'Genap')+' '+year+'/'+(year+1);}
function render(){
 const meta=state.meta,complete=Boolean(meta?.updated_at),partial=Boolean(meta?.run_id&&!meta.updated_at),syncing=meta?.sync?.status==='running',paused=meta?.sync?.status==='paused',pt=meta?.perguruan_tinggi||[],prodi=meta?.prodi||[],pages=Math.max(1,Math.ceil(state.total/Number($('page-size').value))),f=filters();
 $('semester').textContent=period(meta?.semester);$('updated').textContent=meta?.updated_at?'Diperbarui '+new Date(meta.updated_at).toLocaleString('id-ID',{timeZone:'Asia/Bangkok'})+' UTC+7':syncing?'Sinkronisasi pertama berlangsung':paused?'Sinkronisasi pertama tertunda':meta?'Menunggu sinkronisasi pertama':'Database belum dihubungkan';
 $('stat-dosen').textContent=number(meta?.total_dosen);$('tab-count').textContent=number(meta?.total_dosen);$('stat-pt').textContent=number(pt.length);$('stat-pt-note').textContent='PT pada data tersimpan';
 const processed=prodi.filter(p=>p.jumlah_dosen_terambil!==null&&p.jumlah_dosen_terambil!==undefined).length; $('stat-prodi').textContent=number(prodi.length);$('stat-prodi-note').textContent=number(processed)+' dari '+number(prodi.length)+' prodi sudah diproses';$('stat-coverage').textContent=complete?'Tersimpan':partial?'Sebagian':syncing?'Memuat':paused?'Tertunda':meta?'Terhubung':'Setup';$('stat-coverage-note').textContent=complete?'Sinkronisasi lengkap':partial?'Data bertambah selama sinkronisasi':syncing?'Pengumpulan PDDIKTI berlangsung':paused?'Progres tersimpan di database':meta?'Siap untuk sinkronisasi pertama':'Hubungkan dan sinkronkan data';
 $('notice').className='notice'+(state.error?' error':complete?' success':'');
 $('notice').textContent=state.error||(state.loading?'Mencari data di database…':complete?'Data tersimpan dari PDDIKTI. Pencarian mencakup seluruh data semester ini.':partial?'Cakupan sementara: '+number(processed)+' dari '+number(prodi.length)+' prodi sudah diproses. Data dosen akan bertambah selama sinkronisasi.':syncing?'Sinkronisasi pertama sedang berjalan. Data dosen akan tampil setelah pengumpulan dan pemeriksaan selesai.':paused?'Sinkronisasi pertama tertunda. Progres tersimpan; lanjutkan dari halaman pengelola.':'Database terhubung dan belum berisi data. Jalankan sinkronisasi dari halaman pengelola.');
 $('search-clear').hidden=!$('search').value;
 $('result-count').textContent=number(state.total)+' dosen sesuai filter'+(partial?' · cakupan sementara':'');$('search-hint').textContent='Cari nama, NIDN/NUPTK, kampus, atau prodi. Hasil diperbarui saat mengetik.';
 const start=(state.page-1)*Number($('page-size').value);
 $('dosen-rows').innerHTML=state.rows.length?state.rows.map((row,i)=>{
  const eligible=row.afiliasi.filter(a=>(!f.pt||a.id_pt===f.pt)&&(!f.prodi||a.id_prodi===f.prodi)&&(!f.status||a.status_pt===f.status));
  const a=eligible.find(a=>searchScore(row,f.query,[a])>=0)||eligible[0]||row.afiliasi[0];
  return '<tr><td class="row-number">'+number(start+i+1)+'</td><td class="name-cell">'+highlight(row.nama)+'<small>'+escape(row.pendidikan||'Tidak tersedia')+'</small></td><td class="nidn">'+highlight(row.nidn||'—')+'</td><td class="affiliation"><strong>'+highlight(a?.nama_pt)+'</strong><small>'+highlight(a?.nama_prodi)+' · '+escape(a?.jenjang)+'</small></td><td>'+badge(row.status)+'</td><td><button class="detail-button" type="button" data-id="'+escape(row.id)+'" aria-label="Detail '+escape(row.nama)+'">↗</button></td></tr>';
 }).join(''):'<tr><td colspan="6" class="empty">'+(state.error?'Data belum dapat dibaca. Klik Perbarui tampilan untuk mencoba lagi.':state.loading?'Memuat data…':meta?.run_id?'Tidak ada dosen yang cocok. Coba kata kunci atau filter lain.':syncing?'Pengumpulan data PDDIKTI sedang berjalan. Nama dosen akan tampil setelah seluruh sinkronisasi selesai.':paused?'Sinkronisasi belum selesai. Lanjutkan dari halaman pengelola.':'Belum ada data. Jalankan sinkronisasi dari halaman pengelola.')+'</td></tr>';
 $('page-info').textContent='Halaman '+number(state.page)+' dari '+number(pages);$('row-range').textContent=state.rows.length?number(start+1)+'–'+number(start+state.rows.length)+' dari '+number(state.total)+' dosen':'0 dosen';
 $('page-numbers').innerHTML=pageNumbers(state.page,pages).map(p=>p==='…'?'<span class="page-ellipsis">…</span>':'<button class="page-number'+(p===state.page?' current':'')+'" type="button" data-page="'+p+'" aria-label="Halaman '+p+'"'+(p===state.page?' aria-current="page"':'')+'>'+number(p)+'</button>').join('');
 $('prev').disabled=state.loading||state.page===1;$('next').disabled=state.loading||state.page>=pages;$('jump-page').max=String(pages);$('jump-page').value=String(state.page);
 $('page-numbers').querySelectorAll('button').forEach(b=>b.disabled=state.loading);$('jump-form').querySelector('button').disabled=state.loading;
 $('sort-name').querySelector('span').textContent=state.desc?'↓':'↑';$('export').disabled=state.loading||!state.rows.length;
 $('scope').textContent=partial?'Sinkronisasi pertama: dosen yang sudah terkumpul ditampilkan bertahap. Cakupan belum lengkap.':'Data tersimpan dari PDDIKTI. Pembaruan berikutnya tidak mengganti data lengkap lama hingga seluruh proses selesai.';
 $('progress').innerHTML=[['Perguruan tinggi',number(pt.length)+' PT'],['Homebase diproses',number(processed)+' / '+number(prodi.length)+' prodi'],['Dosen unik',number(meta?.total_dosen)],['Sinkronisasi terakhir',meta?.sync?.status==='paused'?'Tertunda':meta?.sync?.status==='running'?'Sedang berjalan':meta?.run_id?'Selesai':'Belum dijalankan']].map(([label,value])=>'<li><span>'+label+'</span><strong>'+escape(value)+'</strong></li>').join('');
 const different=prodi.filter(p=>p.jumlah_dosen_terambil!==null&&p.jumlah_dosen_terambil!==undefined&&p.jumlah_dosen_api!==p.jumlah_dosen_terambil).length;
 $('count-differences').hidden=!different;$('count-differences').textContent=number(different)+' prodi memiliki jumlah homebase berbeda dari ringkasan sumber. Nama pada daftar homebase tetap disertakan.';
 renderPT();
}
function badge(value){return '<span class="badge'+(value==='Aktif'?'':' inactive')+'">'+escape(value||'Tidak tersedia')+'</span>';}
function renderPT(){
 if($('panel-pt').hidden)return;
 $('pt-rows').innerHTML=(state.meta?.perguruan_tinggi||[]).filter(p=>matchesText(p.nama+' '+p.kab_kota,$('pt-search').value)).map(p=>'<tr><td class="name-cell"><a href="https://pddikti.kemdiktisaintek.go.id/detail-pt/'+escape(p.id)+'" target="_blank" rel="noopener noreferrer">'+escape(p.nama)+' ↗</a><small>'+escape(p.jenis)+'</small></td><td>'+escape(p.kab_kota)+'</td><td>'+badge(p.status)+'</td><td>'+number(state.meta.prodi.filter(program=>program.id_pt===p.id).length)+'</td><td>'+number(p.dosen_count)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">Tidak ada perguruan tinggi yang cocok.</td></tr>';
}
async function page(target=1){
 clearTimeout(state.timer);const epoch=++state.epoch;state.page=target;state.loading=true;state.error='';state.rows=[];render();
 try{
  const scope=filters(),size=Number($('page-size').value);let result=await client.list(scope,target,size,state.desc);if(epoch!==state.epoch)return;
  if(result.run_id!==state.meta?.run_id){client.clear();state.meta=await client.meta();if(epoch!==state.epoch)return;setupOptions();result=await client.list(filters(),target,size,state.desc);if(epoch!==state.epoch)return;}
  const pages=Math.max(1,Math.ceil(result.total/size));if(target>pages)return page(pages);
  state.total=result.total;state.rows=result.items;
  if(target<pages)client.list(scope,target+1,size,state.desc).catch(()=>{});
 }catch(error){if(epoch===state.epoch){state.error=error.message;state.total=0;}}
 finally{if(epoch===state.epoch){state.loading=false;render();}}
}
function setupOptions(){options('pt-filter',(state.meta?.perguruan_tinggi||[]).map(p=>({id:p.id,label:p.nama})),'Semua perguruan tinggi');options('status-filter',[...new Set((state.meta?.perguruan_tinggi||[]).map(p=>p.status))].sort().map(status=>({id:status,label:status})),'Semua status');programs();}
async function load({keepPage=false}={}){const target=keepPage?state.page:1,epoch=++state.epoch;client.clear();state.loading=true;state.error='';render();try{const meta=await client.meta();if(epoch!==state.epoch)return;state.meta=meta;setupOptions();await page(target);}catch(error){if(epoch===state.epoch){state.error=error.message;state.loading=false;state.rows=[];render();}}}
function input(){clearTimeout(state.timer);state.epoch++;state.page=1;state.rows=[];state.total=0;state.loading=true;state.error='';render();state.timer=setTimeout(()=>page(1),350);}
$('search').addEventListener('input',input);$('filters').addEventListener('submit',e=>{e.preventDefault();page(1);});$('search-api').addEventListener('click',()=>page(1));
$('search-clear').addEventListener('click',()=>{$('search').value='';page(1);$('search').focus();});
$('pt-filter').addEventListener('change',()=>{$('prodi-filter').value='';programs();page(1);});for(const id of ['prodi-filter','status-filter','page-size'])$(id).addEventListener('change',()=>page(1));
$('reset').addEventListener('click',()=>{$('filters').reset();for(const id of ['pt-filter','prodi-filter','status-filter','page-size'])syncSelect(id);programs();page(1);});
$('refresh').addEventListener('click',load);$('sort-name').addEventListener('click',()=>{state.desc=!state.desc;page(1);});
$('prev').addEventListener('click',()=>page(state.page-1));$('next').addEventListener('click',()=>page(state.page+1));
$('page-numbers').addEventListener('click',e=>{const button=e.target.closest('[data-page]');if(button)page(Number(button.dataset.page));});
$('jump-form').addEventListener('submit',e=>{e.preventDefault();if($('jump-page').checkValidity())page(Number($('jump-page').value));});
$('pt-search').addEventListener('input',renderPT);
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});for(const name of ['dosen','pt','coverage'])$('panel-'+name).hidden=name!==button.dataset.tab;renderPT();}));
$('dosen-rows').addEventListener('click',e=>{const button=e.target.closest('[data-id]');if(!button)return;const row=state.rows.find(r=>r.id===button.dataset.id);if(!row)return;
 $('detail-name').textContent=row.nama;$('detail-facts').innerHTML=[['NIDN',row.nidn],['NUPTK',row.nuptk],['Pendidikan',row.pendidikan],['Status',row.status],['Ikatan kerja',row.ikatan_kerja]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escape(value||'Tidak tersedia')+'</dd></div>').join('');
 $('detail-affiliations').innerHTML=row.afiliasi.map(a=>'<div class="homebase"><strong>'+escape(a.nama_pt)+'</strong><p>'+escape(a.nama_prodi)+' · '+escape(a.jenjang)+'<br>'+escape(a.kab_kota)+' · '+escape(a.semester)+'</p></div>').join('');
 $('detail-source').href='api/profile?'+new URLSearchParams({nidn:row.nidn,nuptk:row.nuptk,nama:row.nama});$('detail').showModal();
});
$('close-detail').addEventListener('click',()=>$('detail').close());
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csv(){const cell=value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';},rows=[['Nama','NIDN','NUPTK','Perguruan tinggi','Program studi','Semester']];const f=filters();for(const row of state.rows)for(const a of row.afiliasi)if((!f.pt||a.id_pt===f.pt)&&(!f.prodi||a.id_prodi===f.prodi)&&(!f.status||a.status_pt===f.status))rows.push([row.nama,row.nidn,row.nuptk,a.nama_pt,a.nama_prodi,a.semester]);download('dosen-aceh-halaman-'+state.page+'.csv','\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
$('export').addEventListener('click',csv);$('export-csv').addEventListener('click',csv);$('export-json').addEventListener('click',()=>download('dosen-aceh-halaman-'+state.page+'.json',JSON.stringify({semester:state.meta?.semester,updated_at:state.meta?.updated_at,complete:Boolean(state.meta?.updated_at),page:state.page,total:state.total,dosen:state.rows},null,2),'application/json'));$('export-txt').addEventListener('click',()=>download('nama-dosen-halaman-'+state.page+'.txt',state.rows.map(r=>r.nama).join('\r\n'),'text/plain;charset=utf-8'));
enhanceSelects(['pt-filter','prodi-filter','status-filter','page-size']);await load();

setInterval(()=>{if(state.meta&&!state.meta.updated_at&&!state.loading)load({keepPage:true});},30000);
