import { SOURCE } from './lib.mjs';
import { pathToFileURL } from 'node:url';

const clean = value => String(value ?? '').trim();
export function selectProfile(matches, lecturer) {
  const exact = matches.filter(candidate =>
    (lecturer.nidn && clean(candidate.nidn) === lecturer.nidn)
    || (lecturer.nuptk && clean(candidate.nuptk) === lecturer.nuptk));
  if (exact.length !== 1 || !clean(exact[0].id)) return null;
  return exact[0];
}
export async function resolveProfile(lecturer, { fetcher = fetch } = {}) {
  const searchUrl = SOURCE + '/search/dosen/' + encodeURIComponent(lecturer.nidn || lecturer.nuptk || lecturer.nama);
  const fallback = message => ({ url: searchUrl, direct: false, message });
  if (!lecturer.nidn && !lecturer.nuptk) return fallback('Identitas profil belum dapat dipastikan. Gunakan pencarian resmi PDDIKTI.');
  async function request(endpoint, body) {
    const response = await fetcher(SOURCE + '/api' + endpoint, {
      method: body ? 'POST' : 'GET', headers: { Accept:'application/json', 'Content-Type':'application/json',
        Referer:SOURCE + '/', Origin:SOURCE, 'User-Agent':'Mozilla/5.0' },
      body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`PDDIKTI merespons HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== 'success') throw new Error('Profil belum tersedia dari PDDIKTI');
    return data.data;
  }
  try {
    let matches = await request('/pencarian/dosen/' + encodeURIComponent(lecturer.nidn || lecturer.nuptk));
    let candidate = selectProfile(Array.isArray(matches) ? matches : [], lecturer);
    if (!candidate && !lecturer.nidn) {
      matches = await request('/pencarian/dosen/' + encodeURIComponent(lecturer.nama));
      candidate = selectProfile(Array.isArray(matches) ? matches : [], lecturer);
    }
    if (!candidate) return fallback('Hasil pencarian belum menunjukkan satu identitas yang cocok. Pilih hasilnya di PDDIKTI.');
    const profile = await request('/dosen/profile', { id:candidate.id });
    if (!profile || !clean(profile.nama_dosen)) return fallback('Biodata belum dapat dibaca. Gunakan pencarian PDDIKTI.');
    const names = [lecturer.nama, ...(lecturer.nama_lain || []), candidate.nama].map(name=>clean(name).toLocaleUpperCase('id'));
    if (!names.includes(clean(profile.nama_dosen).toLocaleUpperCase('id'))) return fallback('Nama biodata berbeda dari hasil pencarian. Periksa melalui pencarian PDDIKTI.');
    return { url:SOURCE + '/detail-dosen/' + candidate.id, direct:true, message:'Identitas dan biodata profil berhasil diperiksa.' };
  } catch { return fallback('Profil langsung belum dapat diperiksa. Gunakan pencarian resmi PDDIKTI.'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try { process.stdout.write(JSON.stringify(await resolveProfile(JSON.parse(input)))); }
  catch { process.stdout.write(JSON.stringify({ error:'Permintaan profil tidak valid.' })); process.exitCode = 1; }
}
