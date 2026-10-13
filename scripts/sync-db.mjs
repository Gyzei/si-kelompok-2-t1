import {Database} from '../server/database.mjs';
import {syncStep,retryDelay} from '../server/sync.mjs';
const semester=process.argv.find(arg=>/^\d{4}[12]$/.test(arg))||'20261';
const db=new Database();let failures=0,first=true;
while(true){
 try {
  const result=await syncStep(db,{semester,restart:first&&process.argv.includes('--restart')});first=false;
  if(result.busy){console.log('Sinkronisasi lain sedang berjalan. Menunggu…');await new Promise(r=>setTimeout(r,5000));continue;}
  failures=0;console.log(JSON.stringify({phase:result.run.phase,page:result.run.cursor,published:result.run.publish_offset,done:result.done}));
  if(result.done)break;await new Promise(r=>setTimeout(r,500));
 }catch(error){first=false;console.error(error.message);failures++;
  const temporary=error.retryable??(error.status>=500||error.status===429);
  if(!temporary||(failures>=3&&!process.argv.includes('--retry'))){process.exitCode=1;break;}
  const wait=Math.max(retryDelay(error),Math.min(120000,5000*2**Math.min(failures-1,5)));
  console.log(JSON.stringify({retryInSeconds:Math.ceil(wait/1000),failures}));await new Promise(r=>setTimeout(r,wait));}
}
