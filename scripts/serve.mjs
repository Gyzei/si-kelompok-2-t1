import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveApi } from './live-api.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT||8787);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8'};
http.createServer(async(request,response)=>{
 try {
  const url=new URL(request.url,'http://localhost');
  if ((url.pathname==='/api.php'&&request.method==='POST')||(url.pathname==='/profile.php'&&request.method==='GET')) {
   let input;
   if (url.pathname==='/profile.php') {
    const id=url.searchParams.get('id')||'';
    input={action:'profile',nidn:id.startsWith('nidn:')?id.slice(5):(url.searchParams.get('nidn')||''),nuptk:id.startsWith('nuptk:')?id.slice(6):(url.searchParams.get('nuptk')||''),nama:url.searchParams.get('nama')||''};
   } else {
    let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>4096)throw Object.assign(new Error('Permintaan terlalu besar.'),{status:413});}
    try{input=JSON.parse(raw);}catch{throw Object.assign(new Error('JSON tidak valid.'),{status:400});}
   }
   const result=await liveApi(input);
   if (url.pathname==='/profile.php'&&url.searchParams.get('redirect')==='1') {response.writeHead(302,{'Location':result.url,'Cache-Control':'no-store'});response.end();return;}
   response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(result));return;
  }
  const relative=['/','/index.php'].includes(url.pathname)?'index.html':url.pathname.slice(1);
  if ((relative!=='index.html'&&!/^assets\/[a-zA-Z0-9.-]+$/.test(relative))||!['GET','HEAD'].includes(request.method)) {response.writeHead(404);response.end('Not found');return;}
  const body=await fs.readFile(path.join(root,relative));
  response.writeHead(200,{'Content-Type':types[path.extname(relative)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  response.end(request.method==='HEAD'?undefined:body);
 } catch(error) {
  response.writeHead(error.status||(error.code==='ENOENT'?404:502),{'Content-Type':'application/json','Cache-Control':'no-store'});
  response.end(JSON.stringify({error:error.message,retryAfter:error.retryAfter||null}));
 }
}).listen(port,'127.0.0.1',()=>console.log('Direktori Dosen Aceh LIVE: http://127.0.0.1:'+port));
