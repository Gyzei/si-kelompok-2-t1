import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import directory from '../api/directory.js';
import sync from '../api/sync.js';
import status from '../api/sync-status.js';
import profile from '../api/profile.js';
const routes={'/api/directory':directory,'/api/sync':sync,'/api/sync-status':status,'/api/profile':profile};
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'};
const port=Number(process.env.PORT||process.argv[2]||8787);
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(routes[url.pathname])return routes[url.pathname](req,res);
 const file=url.pathname==='/'?'index.html':url.pathname==='/admin.html'?'admin.html':url.pathname.slice(1);
 if(!['index.html','admin.html'].includes(file)&&!/^assets\/[a-zA-Z0-9.-]+$/.test(file)){res.writeHead(404);res.end();return;}
 try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-cache'});res.end(data);}
 catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log('Direktori database: http://127.0.0.1:'+port));

