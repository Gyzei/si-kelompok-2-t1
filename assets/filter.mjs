export const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('id');
export const words = value => normalize(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export const tokens = query => words(query).split(' ').filter(Boolean);
export const matchesText = (text,query) => tokens(query).every(token=>words(text).includes(token));

const index=new WeakMap();
export function invalidateSearch(row){index.delete(row);}
function documentFor(row) {
  let entry=index.get(row);
  if(!entry){entry={name:words([row.nama,...(row.nama_lain||[])].join(' ')),base:words([row.nama,...(row.nama_lain||[]),row.nidn,row.nuptk].join(' ')),affiliations:new Map(row.afiliasi.map(a=>[a,words([a.nama_pt,a.nama_prodi,a.kab_kota,a.jenjang].join(' '))]))};index.set(row,entry);}
  return entry;
}
export function compileQuery(query){return {terms:tokens(query),compact:String(query??'').replace(/[\s.-]/g,''),nameQuery:words(query)};}
export function searchScore(row,query,affiliations=row.afiliasi) {
  const {terms,compact,nameQuery}=typeof query==='object'?query:compileQuery(query);if(!terms.length)return 0;
  if(/^\d{10}$|^\d{16}$/.test(compact))return [row.nidn,row.nuptk].includes(compact)?1000:-1;
  const doc=documentFor(row);
  if(!affiliations.some(a=>{const full=doc.base+' '+(doc.affiliations.get(a)||'');return terms.every(token=>full.includes(token));}))return -1;
  return doc.name===nameQuery?500:doc.name.startsWith(nameQuery)?300:terms.every(token=>doc.name.includes(token))?200:100;
}
export function filterLecturers(lecturers,filters={}) {
  const ranked=[],query=compileQuery(filters.query);
  for(const row of lecturers){
    const affiliations=row.afiliasi.filter(a=>(!filters.pt||a.id_pt===filters.pt)&&(!filters.prodi||a.id_prodi===filters.prodi)&&(!filters.status||a.status_pt===filters.status));
    if(!affiliations.length)continue;
    const score=searchScore(row,query,affiliations);
    if(score>=0)ranked.push({row,score});
  }
  if(query.terms.length)ranked.sort((a,b)=>b.score-a.score);
  return ranked.map(result=>result.row);
}

