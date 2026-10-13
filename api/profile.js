import {resolveProfile} from '../scripts/profile.mjs';
import {json,fail} from '../server/http.mjs';
export const config={maxDuration:60};
export default async function handler(request,response) {
  if(request.method!=='GET')return json(response,405,{error:'Gunakan GET.'});
  try {
    const q=new URL(request.url,'https://directory.invalid').searchParams;
    const nidn=q.get('nidn')||'',nuptk=q.get('nuptk')||'',nama=q.get('nama')||'';
    if((nidn&&!/^\d{10}$/.test(nidn))||(nuptk&&!/^\d{16}$/.test(nuptk))||nama.length>200||(!nidn&&!nuptk&&!nama))return json(response,400,{error:'Identitas profil tidak valid.'});
    const result=await resolveProfile({nidn,nuptk,nama});
    response.setHeader('Cache-Control','no-store');response.setHeader('Location',result.url);response.statusCode=302;response.end();
  }catch(error){fail(response,error);}
}
