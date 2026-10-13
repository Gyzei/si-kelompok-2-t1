import {createHash,timingSafeEqual} from 'node:crypto';
export function authorized(request,env=process.env) {
  const supplied=String(request.headers.authorization||'');
  return [env.SYNC_SECRET,env.CRON_SECRET].filter(Boolean).some(secret=>timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update('Bearer '+secret).digest()));
}
export function json(response,status,data) {
  response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
  response.statusCode=status;response.end(JSON.stringify(data));
}
export async function body(request) {
  if(request.body!==undefined){const raw=typeof request.body==='string'?request.body:JSON.stringify(request.body);if(raw.length>4096)throw Object.assign(new Error('Permintaan terlalu besar.'),{status:413});return JSON.parse(raw);}
  let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>4096)throw Object.assign(new Error('Permintaan terlalu besar.'),{status:413});}
  try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('JSON tidak valid.'),{status:400});}
}
export function fail(response,error) {json(response,error.status||502,{error:error.status?error.message:'Proses belum berhasil. Coba lagi atau periksa konfigurasi server.'});}
