import {Database} from '../server/database.mjs';
import {json,fail,authorized} from '../server/http.mjs';
export default async function handler(request,response) {
  if(request.method!=='GET')return json(response,405,{error:'Gunakan GET.'});
  if(!authorized(request))return json(response,401,{error:'Kunci sinkronisasi tidak sesuai.'});
  try{return json(response,200,{run:await new Database().rpc('da_sync_status')});}catch(error){fail(response,error);}
}
