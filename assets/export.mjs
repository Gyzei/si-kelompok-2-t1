export function filteredCsv(lecturers,filters={}){
 const cell=value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows=[['Nama','NIDN','NUPTK','Perguruan tinggi','Program studi','Semester']];
 for(const row of lecturers)for(const a of row.afiliasi)if((!filters.pt||a.id_pt===filters.pt)&&(!filters.prodi||a.id_prodi===filters.prodi)&&(!filters.status||a.status_pt===filters.status))rows.push([row.nama,row.nidn,row.nuptk,a.nama_pt,a.nama_prodi,a.semester]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
