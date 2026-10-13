import {randomUUID} from 'node:crypto';
import {liveApi} from '../scripts/live-api.mjs';
import {deduplicate} from '../scripts/lib.mjs';
import {publishPreview,pruneLecturers} from './preview.mjs';

export function retryDelay(error){
  if(error.status!==429)return 5000;
  const header=String(error.retryAfter||''),wait=/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now();
  return Math.min(86400000,Math.max(1000,Number.isFinite(wait)&&wait>0?wait:30000));
}

export async function syncStep(db,{semester='20261',restart=false,source=request=>liveApi(request,{timeoutMs:60000})}={}) {
  if(!/^\d{4}[12]$/.test(semester)||typeof restart!=='boolean')throw Object.assign(new Error('Parameter sinkronisasi tidak valid.'),{status:400});
  const owner=randomUUID(),claim=await db.rpc('da_sync_claim',{p_semester:semester,p_owner:owner,p_restart:restart});
  if(claim.busy)return {busy:true};
  const {run,task}=claim;
  try {
    let data;
    if(run.phase==='dosen'){
      const progress=await db.rpc('da_sync_status');
      if(run.total_dosen===null||progress.prodi_processed%20===0)await publishPreview(db,run);
    }
    if(task.action==='publish') {
      if(!run.plan_ready){
        const records=[];
        for(let offset=0;;offset+=500){const chunk=await db.rpc('da_sync_records',{p_run:run.id,p_offset:offset,p_limit:500});records.push(...chunk);if(chunk.length<500)break;}
        const lecturers=deduplicate(records).sort((a,b)=>a.nama.localeCompare(b.nama,'id')||a.id.localeCompare(b.id));
        await pruneLecturers(db,run.id,lecturers);
        for(let offset=0;offset<Math.max(1,lecturers.length);offset+=500)await db.rpc('da_prepare_chunk',{p_run:run.id,p_owner:owner,p_offset:offset,p_items:lecturers.slice(offset,offset+500),p_total:lecturers.length});
        await db.rpc('da_plan_ready',{p_run:run.id,p_owner:owner,p_total:lecturers.length});
      }
      data=await db.rpc('da_publish_chunk',{p_run:run.id,p_offset:task.offset});
      if(!data)throw new Error('Publish plan missing');
    } else {
      const request={action:task.action,semester:run.semester};
      if(task.action==='pt')request.page=task.page;
      else request.id=(task.pt||task.program).id;
      data=await source(request);
    }
    const next=await db.rpc('da_sync_commit',{p_run:run.id,p_owner:owner,p_task:task,p_data:data});
    return {run:next,done:next.status==='complete'};
  } catch(error) {
    await db.rpc('da_sync_fail',{p_run:run.id,p_owner:owner,p_error:error.status?error.message:'Sinkronisasi tertunda. Periksa respons sumber dan skema database.'}).catch(()=>{});
    throw error;
  }
}
