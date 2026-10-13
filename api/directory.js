import {Database,searchParameters} from '../server/database.mjs';
import {json,fail} from '../server/http.mjs';
export default async function handler(request,response) {
  if(request.method!=='GET')return json(response,405,{error:'Gunakan GET.'});
  try {
    const query=new URL(request.url,'https://directory.invalid').searchParams,db=new Database();
    const action=query.get('action')||'list';
    if(action==='meta')return json(response,200,await db.rpc('da_metadata'));
    if(action!=='list')return json(response,400,{error:'Action tidak valid.'});
    return json(response,200,await db.rpc('da_search',searchParameters(query)));
  }catch(error){fail(response,error);}
}
