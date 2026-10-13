import {deduplicate} from '../scripts/lib.mjs';
const inList=ids=>'in.('+ids.map(id=>JSON.stringify(id)).join(',')+')';

export async function pruneLecturers(db,runId,lecturers){
 const keep=new Set(lecturers.map(row=>row.id)),existing=[];
 for(let offset=0;;offset+=1000){const rows=await db.table('da_lecturers',{query:{run_id:'eq.'+runId,select:'id',order:'id',limit:1000,offset}});existing.push(...rows.map(row=>row.id));if(rows.length<1000)break;}
 const stale=existing.filter(id=>!keep.has(id));
 for(let i=0;i<stale.length;i+=50)await db.table('da_lecturers',{method:'DELETE',query:{run_id:'eq.'+runId,id:inList(stale.slice(i,i+50))}});
}

// First import only. A complete existing generation is never replaced by a preview.
// Called by syncStep while holding its normal sync lease.
export async function publishPreview(db,run){
 const meta=await db.rpc('da_metadata');
 if(meta.updated_at||(meta.run_id&&meta.run_id!==run.id))return {skipped:true};
 const programs=[];
 for(let offset=0;;offset+=50){const chunk=await db.table('da_programs',{query:{run_id:'eq.'+run.id,processed:'eq.true',select:'id,payload,raw',order:'id',limit:50,offset}});programs.push(...chunk);if(chunk.length<50)break;}
 const records=[];
 for(const {payload:p,raw} of programs)for(const item of raw||[])records.push({...item,afiliasi:{id_pt:p.id_pt,nama_pt:p.nama_pt,status_pt:p.status_pt,kab_kota:p.kab_kota,id_prodi:p.id,nama_prodi:p.nama,jenjang:p.jenjang,status_prodi:p.status,semester:run.semester}});
 const lecturers=deduplicate(records);
 if(!lecturers.length)return {lecturers:0,programs:programs.length};
 for(let i=0;i<lecturers.length;i+=200){
  const rows=lecturers.slice(i,i+200);
  await db.table('da_lecturers',{method:'POST',query:{on_conflict:'run_id,id'},body:rows.map(row=>({run_id:run.id,id:row.id,nama:row.nama,nidn:row.nidn,nuptk:row.nuptk,payload:row}))});
  const affiliations=rows.flatMap(row=>row.afiliasi.map(a=>({run_id:run.id,lecturer_id:row.id,id_pt:a.id_pt,id_prodi:a.id_prodi,status_pt:a.status_pt||'',search_text:[row.nama,...row.nama_lain,row.nidn,row.nuptk,a.nama_pt,a.nama_prodi,a.kab_kota,a.jenjang].join(' ')})));
  for(let j=0;j<affiliations.length;j+=500)await db.table('da_affiliations',{method:'POST',query:{on_conflict:'run_id,lecturer_id,id_pt,id_prodi'},body:affiliations.slice(j,j+500)});
 }
 await pruneLecturers(db,run.id,lecturers);
 await db.table('da_runs',{method:'PATCH',query:{id:'eq.'+run.id,phase:'eq.dosen'},body:{total_dosen:lecturers.length}});
 if(!meta.run_id)await db.table('da_state',{method:'PATCH',query:{singleton:'eq.true',active_run:'is.null'},body:{active_run:run.id}});
 return {lecturers:lecturers.length,programs:programs.length};
}
