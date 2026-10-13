# Direktori Dosen Aceh

Website memakai Supabase untuk pencarian dan pagination. Sinkronisasi mengambil PT → prodi → dosen/homebase dari API PDDIKTI, menyimpan progres, dan menggabungkan dosen berdasarkan NIDN/NUPTK/ID SDM.

Ikuti [SETUP-SUPABASE.md](SETUP-SUPABASE.md) untuk konfigurasi, sinkronisasi, dan deployment Vercel.

## Menjalankan

Gunakan Node.js 24 dan `npm ci`. Isi `.env` berdasarkan `.env.example`.

- `npm run dev` atau `npm run serve`: website di http://127.0.0.1:8787/.
- `npm run dev -- 8790`: website di http://127.0.0.1:8790/.
- `npm run sync -- 20261 --retry`: sinkronisasi dengan progres di Supabase dan percobaan ulang saat sumber terganggu.
- `npm run build`: menghasilkan folder `public` untuk Vercel.
- `npm test`: pengujian database, sinkronisasi, deduplikasi, pencarian, pagination, dan profil. PGlite hanya dipakai dalam pengujian.

Halaman utama berada di `index.html`; halaman pengelola di `admin.html`. Jalankan website dengan server Node atau Vercel agar route `/api/*` tersedia. Folder Laragon saja tidak menjalankan API Node.

## Data dan sinkronisasi

Pada pengumpulan pertama, dosen ditampilkan bertahap setiap 20 prodi dengan label cakupan sementara dan refresh otomatis 30 detik. Setelah ada generasi lengkap, pembaruan berikutnya mempertahankan data aktif sampai seluruh generasi pengganti selesai.

Pencarian dan pagination dijalankan di database. Browser menampung maksimal 20 respons selama satu menit di RAM dan menyiapkan halaman berikutnya. Unduhan CSV/JSON/TXT mencakup halaman yang ditampilkan. Website tidak memakai dataset lokal.

Sinkronisasi CLI memerlukan proses Node aktif dan koneksi internet. Halaman pengelola `/admin.html` juga dapat menggerakkan sinkronisasi menggunakan token. Workflow GitHub Actions opsional tersedia; lihat panduan setup untuk mengaktifkannya.

## Struktur

- `assets/`: tampilan, dropdown pencarian, pagination, dan klien API.
- `api/`: endpoint website untuk Vercel dan server lokal.
- `server/`: akses Supabase dan sinkronisasi.
- `scripts/`: server lokal, build, sinkronisasi CLI, klien PDDIKTI, dan deduplikasi.
- `supabase/schema.sql`: tabel, indeks, RPC, dan aturan akses database.
- `tests/`: pengujian.
- `work/`: log dan catatan proses lokal, tidak dipublikasikan.
- `outputs/`: dokumentasi visual pemeriksaan, tidak dipublikasikan.

Simpan secret hanya di `.env` atau environment variables server. Secret dan file kerja tidak masuk deployment.
