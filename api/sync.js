import {Database} from '../server/database.mjs';
import {syncStep} from '../server/sync.mjs';
import {json,fail,authorized,body} from '../server/http.mjs';
export const config={maxDuration:300};
export default async function handler(request,response) {
  if(!['GET','POST'].includes(request.method))return json(response,405,{error:'Gunakan POST.'});
  if(!authorized(request))return json(response,401,{error:'Kunci sinkronisasi tidak sesuai.'});
  try {const input=request.method==='POST'?await body(request):{};
    if(!input||Array.isArray(input)||typeof input!=='object')return json(response,400,{error:'Permintaan tidak valid.'});
    return json(response,200,await syncStep(new Database(),{semester:input.semester??'20261',restart:input.restart??false}));}
  catch(error){fail(response,error);}
}
