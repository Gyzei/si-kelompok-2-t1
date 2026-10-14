# Setup Supabase dan Vercel

Versi database sudah disiapkan. Project Supabase `vnynbwmcaxwlmjmsicos` sudah dibuat dan koneksi server lokal telah diverifikasi. Deployment Vercel belum dilakukan. Tidak ada kredensial, dataset contoh, atau database lokal yang digunakan oleh aplikasi produksi.

## 1. Buat database gratis

1. Buka [Supabase](https://supabase.com/dashboard), masuk, lalu pilih **New project**.
2. Gunakan organisasi pada paket **Free**. Pilih region yang dekat dengan pengguna dan hosting, misalnya Singapore bila tersedia.
3. Atur nama project dan password database, lalu tunggu sampai project siap.
4. Buka **SQL Editor** → **New query**. Salin seluruh isi `supabase/schema.sql`, lalu klik **Run**. SQL membuat tabel, indeks pencarian, fungsi sinkronisasi, dan pembatasan akses.
5. Ambil **Project URL** dari pengaturan Data API/project. Ambil **Secret key** (`sb_secret_…`) dari bagian API Keys. Kunci `service_role` lama juga didukung, tetapi publishable/anon key tidak dapat dipakai untuk konfigurasi server ini.

Secret key Supabase hanya boleh diisi pada server, bukan pada JavaScript browser, chat, atau repository. SQL mengaktifkan RLS dan mencabut akses anon/authenticated ke tabel dan fungsi aplikasi. Website mengakses subset data melalui fungsi server Vercel.

## 2. Coba dari komputer

Jalankan dari folder project:

```powershell
Copy-Item .env.example .env
npm ci
```

Edit `.env`, isi:

```dotenv
SUPABASE_URL=https://vnynbwmcaxwlmjmsicos.supabase.co
SUPABASE_SECRET_KEY=SECRET-KEY-DARI-SUPABASE
SYNC_SECRET=TOKEN-ACAK-KHUSUS-SINKRONISASI
```

Untuk membuat `SYNC_SECRET`, jalankan `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, lalu salin hasilnya ke `.env`. Gunakan token berbeda dari secret key Supabase. `.env` sudah diabaikan Git dan Vercel.

```powershell
npm run dev
```

Buka **http://127.0.0.1:8787/**. Untuk sinkronisasi pertama, buka **http://127.0.0.1:8787/admin.html**, isi `SYNC_SECRET` dan semester, lalu klik **Mulai / lanjutkan sinkronisasi**. Biarkan halaman terbuka. Token tidak disimpan pada localStorage/cookie.

Untuk pengumpulan besar, lebih praktis memakai terminal terpisah:

```powershell
npm run sync -- 20261
```

Progres berada di Supabase. Jika PDDIKTI sedang gagal, perintah biasa berhenti setelah tiga kegagalan berturut-turut. Gunakan `npm run sync -- 20261 --retry` untuk melanjutkan percobaan otomatis dengan jeda bertambah hingga dua menit. HTTP 429 tetap mengikuti Retry-After. HTTP 400/401/403 menghentikan proses. Sinkronisasi memberi setiap request sumber waktu maksimal 60 detik. Jalankan lagi untuk melanjutkan. Pada sinkronisasi pertama, data dosen ditampilkan bertahap dengan label cakupan sementara. Jika sudah ada data lengkap, pembaruan berikutnya tetap tidak menggantinya dengan hasil parsial. Sinkronisasi awal dapat memerlukan waktu lama karena seluruh PT/prodi harus dibaca dari sumber.

Jika ingin membatalkan progres lama dan mengumpulkan ulang atau mengganti semester, jalankan `npm run sync -- 20261 --restart`. Ini membuat generasi baru; data lengkap yang aktif tetap tersedia sampai proses baru berhasil. Tidak dapat me-restart ketika worker lain masih memegang lease; tunggu worker selesai atau lease kedaluwarsa.

## 3. Deploy ke Vercel

1. Simpan project di repository Git. Jangan commit `.env`, log lokal, atau file berisi kredensial.
2. Di Vercel, pilih **Add New → Project**, lalu impor repository.
3. Pilih framework **Other**, Node.js **24.x**. Build command `npm run build`, output directory `public`. Root Directory harus menunjuk folder yang berisi `package.json` dan `vercel.json`. Konfigurasi `framework: null` dalam `vercel.json` memaksa preset Other agar Vercel memakai halaman statis dan fungsi pada `/api/*`.
4. Di **Environment Variables**, isi `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `SYNC_SECRET`. Terapkan pada Production; isi Preview hanya jika preview memang boleh menggunakan database tersebut.
5. Deploy. Build hanya mempublikasikan halaman database, halaman pengelola, dan aset frontend. Penghubung database berjalan sebagai Vercel Functions pada `/api/*`.
6. Buka domain deployment. Periksa hasil pencarian dan pagination. Buka `/admin.html` untuk memeriksa progres atau memperbarui data.

Database kosong akan menampilkan petunjuk sinkronisasi. Konfigurasi yang belum lengkap menampilkan kesalahan setup; aplikasi tidak berpindah ke dataset lama atau contoh. Akses API PDDIKTI dari Vercel tetap perlu diuji setelah deployment. Jika akses sumber dari Vercel bermasalah, jalankan `npm run sync` dari komputer untuk memperbarui Supabase; website Vercel tetap membaca database yang sama.

Jika build menampilkan `No entrypoint found`, periksa bahwa deployment memakai revisi terbaru yang menyertakan `framework: null`. Di Settings → Build and Deployment, pastikan Framework Preset adalah **Other**, lalu deploy ulang revisi terbaru. Aplikasi ini menggunakan halaman statis dan Vercel Functions di folder `api`; `scripts/serve-db.mjs` hanya untuk server lokal.

## 4. Pembaruan otomatis opsional

Workflow `.github/workflows/sync.yml` disiapkan untuk pembaruan **setiap Minggu pukul 09.00 UTC+7** dan pemicu manual **Run workflow**. Jadwal GitHub dapat terlambat; ini bukan jaminan waktu persis. Agar berjalan, tambahkan GitHub repository secrets `SUPABASE_URL` dan `SUPABASE_SECRET_KEY`, lalu aktifkan Actions pada repository. Kuota GitHub Actions mengikuti paket dan jenis repository; jangan menganggap pekerjaan panjang selalu gratis.

Vercel Cron tidak dikonfigurasi otomatis: satu pemanggilan `/api/sync` hanya mengerjakan satu langkah, sedangkan pengumpulan penuh memerlukan banyak langkah. Halaman pengelola, CLI, atau workflow menjadi penggerak proses sampai selesai. Endpoint sync memerlukan `SYNC_SECRET`; akses pengguna biasa ke halaman pengelola tidak memberinya hak memperbarui database.

## Cara kerja dan batas

- PT/prodi/homebase disimpan sementara per generasi. Langkah yang gagal tidak memajukan cursor dan dapat diulang.
- Dosen dideduplikasi berdasarkan NIDN/NUPTK/ID SDM, termasuk hubungan identitas yang ditemukan di prodi berikutnya. Nama sama saja tidak cukup untuk menggabungkan dosen.
- Sinkronisasi pertama memperbarui tabel dosen setiap 20 prodi yang diproses. Data awal langsung bisa dicari, dengan indikator cakupan sementara dan refresh otomatis 30 detik.
- Hasil deduplikasi akhir dipersiapkan dalam batch 500 dosen. Generasi aktif baru berubah dalam transaksi setelah seluruh batch berhasil. Satu generasi lengkap sebelumnya dipertahankan; generasi yang lebih lama dan respons mentah yang telah dipublikasikan dibersihkan.
- Pencarian PostgreSQL memakai indeks GIN, mendukung beberapa kata dengan urutan bebas, prefix kata, aksen umum, kampus/prodi, dan NIDN/NUPTK lengkap yang cocok tepat. Filter PT/prodi/status diterapkan pada afiliasi yang sama.
- Pagination menghitung seluruh hasil di database, mengembalikan hanya 25/50/100 nama per halaman, dengan urutan stabil. Browser menyimpan maksimal 20 respons selama satu menit di RAM dan menyiapkan halaman berikutnya. Pengetikan memakai debounce 350 ms.
- CSV mengambil seluruh hasil filter dan pencarian dalam batch 500 dosen, dengan satu baris per afiliasi yang sesuai filter. JSON/TXT berisi halaman yang sedang ditampilkan. Jika data berubah atau request gagal saat CSV disiapkan, unduhan dibatalkan agar hasil parsial tidak dianggap lengkap.
- Daftar dosen mengikuti homebase semester, bukan pencarian fuzzy nasional. Link biodata PDDIKTI mencari dan memeriksa ID profil resmi ketika dibuka.
- Paket Supabase Free memiliki batas kapasitas/traffic dan dapat dijeda saat tidak aktif. Pantau ukuran tabel dan indeks setelah data lengkap masuk. Jangan menyimpan respons mentah tanpa batas.

Referensi: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase pricing](https://supabase.com/pricing), [Vercel Marketplace databases](https://vercel.com/docs/marketplace-storage), [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).


