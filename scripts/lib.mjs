import { createHash } from 'node:crypto';

export const SOURCE = 'https://pddikti.kemdiktisaintek.go.id';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const text = value => value == null ? '' : String(value).trim();

export function unwrapList(payload, label, { allowNull = false } = {}) {
  if (payload?.status === 'success' && payload.data === null && allowNull) return [];
  if (payload?.status !== 'success' || !Array.isArray(payload.data)) {
    throw new Error(`Format respons ${label} berubah: diharapkan status=success dan data berupa daftar.`);
  }
  return payload.data;
}

export function unwrapPage(payload, requestedPage) {
  const page = payload?.data;
  if (payload?.status !== 'success' || !Array.isArray(page?.data)
      || page.page !== requestedPage || !Number.isInteger(page.totalItems)
      || !Number.isInteger(page.totalPages) || page.totalPages < 1 || page.totalItems < 0) {
    throw new Error('Format atau nomor halaman daftar PT tidak sesuai. Pengumpulan dihentikan agar data tidak dianggap lengkap.');
  }
  return page;
}

function identifier(value, length) {
  const cleaned = text(value);
  return new RegExp(`^\\d{${length}}$`).test(cleaned) && !/^0+$/.test(cleaned) ? cleaned : '';
}

// NIDN/NUPTK are stable across responses; the public encrypted IDs may vary.
// An unregistered lecturer is kept by source ID, never merged by name alone.
export function deduplicate(records) {
  const parent = records.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owners = new Map();
  records.forEach((record, i) => {
    const keys = [
      identifier(record.nidn, 10) && `nidn:${identifier(record.nidn, 10)}`,
      identifier(record.nuptk, 16) && `nuptk:${identifier(record.nuptk, 16)}`,
      text(record.id_sdm) && `id:${text(record.id_sdm)}`,
    ].filter(Boolean);
    for (const key of keys) {
      if (owners.has(key)) parent[find(i)] = find(owners.get(key));
      else owners.set(key, i);
    }
  });
  const groups = new Map();
  records.forEach((record, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });
  return [...groups.values()].map(group => {
    const first = group[0];
    const values = field => [...new Set(group.map(row => text(row[field])).filter(Boolean))];
    const nidn = values('nidn').find(value => identifier(value, 10)) || '';
    const nuptk = values('nuptk').find(value => identifier(value, 16)) || '';
    const ids = values('id_sdm');
    const affiliations = [...new Map(group.map(row => [
      `${row.afiliasi.id_pt}|${row.afiliasi.id_prodi}|${row.afiliasi.semester}`,
      row.afiliasi,
    ])).values()];
    return {
      id: nidn ? `nidn:${nidn}` : nuptk ? `nuptk:${nuptk}` : ids.length ? `sdm:${ids[0]}` : `record:${hash(JSON.stringify(first))}`,
      nama: text(first.nama_dosen), nama_lain: values('nama_dosen').filter(name => name !== text(first.nama_dosen)),
      nidn, nuptk, id_sdm: ids[0] || '', id_sdm_lain: ids.slice(1),
      pendidikan: values('pendidikan').join(' / '),
      status: values('status_aktif').join(' / '),
      ikatan_kerja: values('ikatan_kerja').join(' / '),
      afiliasi: affiliations,
      identitas_terverifikasi: Boolean(nidn || nuptk || ids.length),
    };
  }).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

export function csvCell(value) {
  let cell = text(value);
  // Keep downloaded data from being interpreted as spreadsheet formulas.
  if (/^[=+@-]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}

export function toCsv(lecturers) {
  const rows = [['Nama', 'NIDN', 'NUPTK', 'Pendidikan', 'Status dosen', 'Ikatan kerja', 'Perguruan tinggi', 'Program studi', 'Jenjang', 'Status PT', 'Semester']];
  for (const lecturer of lecturers) for (const affiliation of lecturer.afiliasi) {
    rows.push([lecturer.nama, lecturer.nidn, lecturer.nuptk, lecturer.pendidikan, lecturer.status,
      lecturer.ikatan_kerja, affiliation.nama_pt, affiliation.nama_prodi, affiliation.jenjang,
      affiliation.status_pt, affiliation.semester]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
