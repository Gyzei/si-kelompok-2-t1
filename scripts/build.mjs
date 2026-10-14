import fs from 'node:fs/promises';
await fs.mkdir('public/assets',{recursive:true});
await fs.copyFile('index.html','public/index.html');await fs.copyFile('admin.html','public/admin.html');
for(const name of ['database-app.js','database-client.mjs','export.mjs','admin.js','filter.mjs','pagination.mjs','search-select.js','style.css'])await fs.copyFile('assets/'+name,'public/assets/'+name);
console.log('Vercel assets ready. Only database UI and public assets are published.');

