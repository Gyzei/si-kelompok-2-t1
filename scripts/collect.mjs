import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { SOURCE, hash, text, unwrapPage, unwrapList, deduplicate, toCsv } from './lib.mjs';
import { replaceFile } from './files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const semester = option('--semester', '20261');
const refresh = args.includes('--refresh');
const delay = Number(option('--delay', '500'));
const concurrency = Number(option('--concurrency', '2'));
if (!/^\d{4}[12]$/.test(semester) || !Number.isFinite(delay) || delay < 300
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
  throw new Error('Gunakan semester YYYY1/YYYY2, jeda minimal 300 ms, dan concurrency 1–3.');
}
const dataDir = path.join(root, 'data');
const cacheDir = path.join(dataDir, 'cache', semester);
await fs.mkdir(cacheDir, { recursive: true });
const lockPath = path.join(dataDir, '.collect.lock');
try {
  const old = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  let alive = false;
  try { process.kill(old.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
  if (alive) throw new Error(`Pengumpulan lain masih berjalan (PID ${old.pid}).`);
  await fs.unlink(lockPath);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const lock = await fs.open(lockPath, 'wx');
await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
await lock.close();

let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });
let nextRequest = 0;
let gate = Promise.resolve();
let blocked = false;
let requests = 0;
let cacheHits = 0;
async function rateLimit() {
  const current = gate.then(async () => {
    await sleep(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + delay;
  });
  gate = current.catch(() => {});
  await current;
  if (interrupted) throw new Error('Pengumpulan dijeda. Jalankan kembali untuk melanjutkan.');
  if (blocked) throw new Error('Akses API ditolak; pengumpulan dihentikan.');
}

async function request(endpoint, body) {
  const key = hash(`${body ? 'POST' : 'GET'} ${endpoint} ${JSON.stringify(body || null)}`);
  const cachePath = path.join(cacheDir, key + '.json');
  if (!refresh) {
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (cached.response?.status === 'success') { cacheHits++; return cached.response; }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    await rateLimit();
    let retryAfter = 0;
    try {
      requests++;
      const response = await fetch(SOURCE + '/api' + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json',
          Referer: SOURCE + '/perguruan-tinggi', Origin: SOURCE, 'User-Agent': 'Mozilla/5.0' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      if ([401, 403].includes(response.status)) {
        blocked = true;
        throw new Error(`HTTP ${response.status}: API menolak akses. Periksa akses melalui halaman resmi PDDIKTI.`);
      }
      const retryHeader = response.headers.get('retry-after');
      retryAfter = retryHeader ? Math.max(0, /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
      const responseText = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${responseText.slice(0, 180)}`);
        error.permanent = response.status < 500 && response.status !== 429;
        throw error;
      }
      const payload = JSON.parse(responseText);
      if (payload.status !== 'success') {
        const error = new Error('API: ' + (payload.message || 'status respons bukan success'));
        error.permanent = true;
        throw error;
      }
      await fs.writeFile(cachePath, JSON.stringify({ endpoint, fetched_at: new Date().toISOString(), response: payload }));
      return payload;
    } catch (error) {
      if (error.cause?.message && !error.message.includes(error.cause.message)) {
        error.message += ': ' + error.cause.message;
      }
      lastError = error;
      if (blocked || error.permanent || interrupted) throw error;
      if (attempt < 2) {
        const pause = Math.max(2000 * 2 ** attempt, retryAfter || 0);
        console.log(`Ulangi permintaan (${attempt + 1}/2), tunggu ${Math.ceil(pause / 1000)} detik: ${error.message}`);
        // A long Retry-After is respected while still allowing an interrupted run to finish.
        for (let remaining = pause; remaining > 0; remaining -= 1000) {
          if (interrupted) throw error;
          await sleep(Math.min(1000, remaining));
        }
      }
    }
  }
  throw lastError;
}

async function atomicJson(filename, value) {
  const target = path.join(dataDir, filename);
  await fs.writeFile(target + '.tmp', JSON.stringify(value, null, 2));
  await replaceFile(target + '.tmp', target);
}

const institutions = [];
const programs = [];
const records = [];
const errors = [];
const startedAt = new Date().toISOString();
let stage = 'perguruan_tinggi';
let ptExpected = null;
let ptPages = 0;
let ptDone = 0;
let programsDone = 0;
let complete = false;
let publication = Promise.resolve();
function publish() {
  publication = publication.catch(() => {}).then(async () => {
    const lecturers = deduplicate(records);
    const metadata = {
      schema_version: 1, source: SOURCE, province: 'Prov. Aceh', semester,
      started_at: startedAt, updated_at: new Date().toISOString(),
      complete, stage, interrupted, requests, cache_hits: cacheHits,
      coverage: { pt_expected: ptExpected, pt_pages: ptPages, pt_found: institutions.length,
        pt_processed: ptDone, prodi_found: programs.length, prodi_processed: programsDone,
        raw_lecturer_rows: records.length, unique_lecturers: lecturers.length,
        merged_duplicates: records.length - lecturers.length, errors: errors.length,
        prodi_count_differences: programs.filter(program => program.jumlah_dosen_terambil !== undefined
          && program.jumlah_dosen_terambil !== program.jumlah_dosen_api).length },
      scope: 'Dosen homebase pada seluruh PT terdaftar di Prov. Aceh, untuk semester yang dipilih. Cakupan mengikuti pelaporan PDDIKTI.',
      deduplication: 'NIDN, NUPTK, atau ID SDM; nama yang sama tidak menjadi alasan penggabungan.',
      errors,
    };
    await atomicJson('dataset.json', { metadata, perguruan_tinggi: institutions, prodi: programs, dosen: lecturers });
    await atomicJson('status.json', metadata);
    await fs.writeFile(path.join(dataDir, 'dosen-aceh.csv.tmp'), toCsv(lecturers));
    await replaceFile(path.join(dataDir, 'dosen-aceh.csv.tmp'), path.join(dataDir, 'dosen-aceh.csv'));
    await fs.writeFile(path.join(dataDir, 'nama-dosen.txt.tmp'), lecturers.map(row => row.nama).join('\r\n') + (lecturers.length ? '\r\n' : ''));
    await replaceFile(path.join(dataDir, 'nama-dosen.txt.tmp'), path.join(dataDir, 'nama-dosen.txt'));
  });
  return publication;
}

async function pool(items, action) {
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < items.length && !interrupted && !blocked) {
      const item = items[index++];
      await action(item);
    }
  }));
}
function reportError(type, context, error) {
  errors.push({ type, ...context, message: error.message, at: new Date().toISOString() });
  console.error(`Gagal ${type}: ${context.nama_prodi || context.nama_pt || ''}: ${error.message}`);
}

try {
  console.log(`PDDIKTI Aceh · semester ${semester} · melanjutkan cache: ${!refresh}`);
  const seen = new Set();
  let totalPages = null;
  for (let page = 1; totalPages === null || page <= totalPages; page++) {
    const payload = await request(`/v2/pt/search/filter?limit=15&page=${page}&provinsi=Prov.%20Aceh`);
    const result = unwrapPage(payload, page);
    if (ptExpected !== null && (ptExpected !== result.totalItems || totalPages !== result.totalPages)) {
      throw new Error('Total PT berubah selama pagination. Jalankan dengan --refresh untuk daftar yang konsisten.');
    }
    ptExpected = result.totalItems;
    totalPages = result.totalPages;
    let added = 0;
    for (const item of result.data) {
      if (!text(item.id_sp) || item.provinsi_pt !== 'Prov. Aceh') throw new Error('ID/provinsi PT tidak sesuai filter.');
      if (!seen.has(item.id_sp)) {
        seen.add(item.id_sp);
        institutions.push({ id: item.id_sp, nama: text(item.nama_pt), status: text(item.status_pt),
          kab_kota: text(item.kab_kota_pt), jenis: text(item.jenis_pt), jumlah_prodi_api: item.jumlah_prodi });
        added++;
      }
    }
    if (!added && page < totalPages) throw new Error('Pagination PT mengulang halaman atau mengembalikan halaman kosong.');
    ptPages++;
    console.log(`PT halaman ${page}/${totalPages}: ${institutions.length}/${ptExpected}`);
    await publish();
  }
  if (institutions.length !== ptExpected) throw new Error(`Jumlah PT unik ${institutions.length} berbeda dari total API ${ptExpected}.`);

  stage = 'program_studi';
  await pool(institutions, async institution => {
    try {
      // IDs are URL-safe encrypted tokens. Preserve '=' in paths as on the official frontend.
      const result = unwrapList(await request(`/pt/prodi/${institution.id}/${semester}`), 'prodi');
      const seenPrograms = new Set();
      for (const item of result) {
        if (!text(item.id_sms) || !text(item.nama_prodi)) throw new Error('ID atau nama prodi hilang.');
        if (seenPrograms.has(item.id_sms)) continue;
        seenPrograms.add(item.id_sms);
        programs.push({ id: item.id_sms, id_pt: institution.id, nama_pt: institution.nama,
          status_pt: institution.status, kab_kota: institution.kab_kota,
          nama: text(item.nama_prodi), kode: text(item.kode_prodi), jenjang: text(item.jenjang_prodi),
          status: text(item.status_prodi), jumlah_dosen_api: item.jumlah_dosen });
      }
      ptDone++;
      console.log(`Prodi PT ${ptDone}/${institutions.length}: ${institution.nama} (${result.length})`);
    } catch (error) { reportError('prodi', { id_pt: institution.id, nama_pt: institution.nama }, error); }
    await publish();
  });

  stage = 'dosen';
  await publish();
  await pool(programs, async program => {
    try {
      const endpoint = `/dosen/homebase?semester=${semester}`;
      const result = unwrapList(await request(endpoint, { id: program.id }), 'dosen homebase', { allowNull: program.jumlah_dosen_api === 0 });
      for (const item of result) {
        if (!text(item.nama_dosen)) throw new Error('Respons dosen tidak memiliki nama_dosen.');
      }
      records.push(...result.map(item => ({ ...item, afiliasi: { id_pt: program.id_pt, nama_pt: program.nama_pt,
        status_pt: program.status_pt, kab_kota: program.kab_kota, id_prodi: program.id,
        nama_prodi: program.nama, jenjang: program.jenjang, status_prodi: program.status, semester } })));
      program.jumlah_dosen_terambil = result.length;
      programsDone++;
      console.log(`Dosen prodi ${programsDone}/${programs.length}: ${program.nama_pt} · ${program.nama} (${result.length})`);
    } catch (error) { reportError('dosen', { id_prodi: program.id, nama_prodi: program.nama, nama_pt: program.nama_pt }, error); }
    if (programsDone % 10 === 0 || errors.length || interrupted || blocked) await publish();
  });

  complete = !interrupted && !blocked && !errors.length && ptDone === institutions.length && programsDone === programs.length;
  stage = complete ? 'selesai' : interrupted ? 'dijeda' : 'perlu_dilanjutkan';
  await publish();
  console.log(`${complete ? 'Selesai' : 'Belum lengkap'}: ${deduplicate(records).length} dosen unik, ${programsDone}/${programs.length} prodi, ${errors.length} kesalahan.`);
  if (!complete) process.exitCode = 2;
} catch (error) {
  stage = interrupted ? 'dijeda' : 'perlu_dilanjutkan';
  reportError('pengumpulan', {}, error);
  await publish();
  process.exitCode = 2;
} finally {
  await fs.unlink(lockPath).catch(() => {});
}
