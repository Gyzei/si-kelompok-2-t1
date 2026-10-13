# Direktori Dosen Aceh — Vercel + Supabase

Versi hosting memakai database Supabase untuk pencarian dan pagination. Sinkronisasi mengambil PT → prodi → dosen/homebase dari PDDIKTI, menyimpan progres, melakukan deduplikasi, lalu mempublikasikan satu generasi lengkap secara atomik. Tidak ada data contoh atau snapshot lama pada website produksi.

Mulai dengan **[SETUP-SUPABASE.md](SETUP-SUPABASE.md)** untuk membuat project gratis, memasang skema SQL, mengisi environment variables, melakukan sinkronisasi, dan deploy ke Vercel.

- `npm run dev`: website database lokal di port 8787.
- `npm run sync -- 20261`: sinkronisasi resumable ke Supabase.
- `npm run build`: aset publik untuk Vercel.
- `npm test`: pengujian aplikasi termasuk schema PostgreSQL sungguhan dalam test engine sementara. PGlite hanya dipakai dalam pengujian, bukan database aplikasi.

Kode PHP/API langsung sebelumnya tetap tersedia untuk Laragon. `index.html` dan `npm run serve` menjalankan versi API langsung; versi Vercel memakai `database.html` sebagai halaman utama melalui build.

---

# Versi sebelumnya: API langsung

Direktori mengambil data dari API PDDIKTI saat digunakan. Aplikasi tidak membaca dataset JSON, CSV, database, atau cache respons di disk. Tidak memakai localStorage/IndexedDB. Hasil ditampung sementara di memori halaman dan hilang saat reload atau tombol **Ambil data terbaru** digunakan.

## Menjalankan

Dengan Laragon aktif, buka http://localhost/integrasi/t2/ . PHP memakai cURL bawaan untuk koneksi API tanpa menjalankan proses tambahan. Verifikasi TLS dan sertifikat tepercaya Windows tetap aktif. Jika cURL native tidak tersedia atau tidak bisa memuat sertifikat, aplikasi memakai Node.js 24+ sebagai penghubung. Tidak perlu memasang paket npm.

Alternatif tanpa Laragon:

~~~powershell
npm run serve
~~~

Buka http://127.0.0.1:8787 . Server Node juga mengambil semua data langsung dari PDDIKTI.

## Pagination dan pemuatan

- Daftar PT Aceh memakai pagination asli API: 15 PT per request. Indeks PT dimuat bertahap untuk dropdown pencarian.
- Prodi dimuat hanya ketika PT terkait diperlukan.
- Daftar homebase belum memiliki pagination pada endpoint yang ditemukan. Aplikasi memuat prodi berikutnya hingga cukup untuk halaman yang diminta, dengan batas delapan prodi per interaksi. Jika banyak prodi kosong, klik Muat lebih banyak untuk melanjutkan.
- Respons sukses dan permintaan yang sedang berjalan dipakai bersama di RAM untuk sesi halaman. Perpindahan ke halaman yang telah dimuat tidak mengulang request sumber.
- Halaman pertama dosen diprioritaskan sebelum indeks PT di latar belakang. Maksimal tiga request bersamaan, dengan satu tugas latar belakang. Dua homebase dapat dimuat bersamaan dengan urutan tampil tetap stabil. Satu prodi berikutnya disiapkan di RAM untuk mempercepat halaman lanjutan.
- Permintaan dijadwalkan dengan jeda 500 ms. Gangguan jaringan/HTTP 5xx dicoba ulang sekali. HTTP 401/403 tidak dicoba berulang; HTTP 429 menghormati Retry-After.
- Nomor halaman bertambah berdasarkan hasil yang sudah dimuat. Total akhir hanya muncul setelah cakupan pilihan selesai; lompat halaman dibatasi ke halaman yang tersedia dan satu halaman berikutnya.
- Urutan kedatangan API dipertahankan selama pemuatan agar pagination stabil. Urutan alfabet tersedia setelah cakupan selesai.
- Pencarian saat mengetik memakai indeks RAM pada hasil yang sudah dimuat; tidak memicu request API. Mendukung gabungan nama/kampus/prodi, urutan kata bebas, tanda baca/aksen, peringkat relevansi, dan kecocokan tepat NIDN/NUPTK lengkap.
- **Enter / Cari seluruh Aceh** memakai endpoint pencarian PDDIKTI, lalu memeriksa kampus terhadap seluruh indeks PT Aceh. Tidak perlu mengambil homebase semua prodi. Hasil yang kampusnya sudah terverifikasi tampil lebih dahulu sementara dua halaman indeks PT diproses bersamaan. Jika sumber gagal di tengah proses, hasil tetap tersedia dengan label parsial. Hasil mengikuti data pencarian terkini, tidak memakai filter semester, dan hanya mencakup hasil yang dikembalikan sumber. Memilih filter PT/prodi mengembalikan tampilan ke direktori semester.
- Pilih PT/prodi atau **Muat seluruh cakupan** untuk menelusuri homebase semester. Tombol **Jeda pemuatan** menghentikan request lanjutan; maksimal dua request batch yang sudah dimulai dapat selesai.
- Pergantian filter mengabaikan hasil tampilan dari permintaan lama. Respons sukses yang sudah datang tetap dapat dipakai dari RAM selama sesi yang sama.

## Endpoint sumber

1. GET /api/v2/pt/search/filter?limit=15&page=1&provinsi=Prov.%20Aceh
2. GET /api/pt/prodi/{id_sp}/{semester}
3. POST /api/dosen/homebase?semester={semester}, JSON body berisi id_sms pada field id.
4. GET /api/pencarian/dosen/{nidn}, kemudian POST /api/dosen/profile untuk menemukan dan memeriksa ID profil resmi.

Semester awal adalah 20261, Ganjil 2026/2027. Jika ingin mengganti periode awal, atur semester pada constructor LiveData di assets/live-data.mjs.

Browser memanggil api.php sebagai penghubung ke domain resmi agar tidak bergantung pada CORS PDDIKTI. Action, semester, nomor halaman, dan format ID divalidasi; pengguna tidak dapat mengirim URL sumber sembarang. Verifikasi TLS tetap aktif. profile.php juga memakai API langsung dan tidak mencari identitas di file dataset.

Respons null pada homebase diperlakukan sebagai kosong hanya jika ringkasan prodi juga menyebut nol. Respons gagal atau tidak dikenal ditampilkan sebagai kesalahan dan dapat dicoba lagi, bukan sebagai data kosong yang lengkap.

## Unduhan dan cakupan

CSV/JSON/TXT dibuat di browser hanya ketika pengguna memilih unduhan. Hasil berisi data API yang telah dimuat pada sesi itu; unduhan bukan pembacaan file snapshot lama. CSV memuat satu baris per afiliasi dan filter yang dipilih. NIDN/NUPTK harus diimpor sebagai teks dalam spreadsheet untuk mempertahankan nol di depan.

Dosen digabung dengan NIDN, NUPTK, atau ID SDM, bukan nama. Cakupan mengikuti pelaporan homebase per semester. Angka ringkasan prodi dan jumlah nama pada daftar homebase dapat berbeda dan ditampilkan pada tab Cakupan data.

Jika PDDIKTI mengalami gangguan, tampilan menunjukkan kegagalan sumber. Tidak ada fallback ke dataset lama. Direktori data lama diblokir dari akses web dan tidak dibutuhkan oleh aplikasi. Skrip pengumpulan offline sebelumnya tersedia sebagai alat lama terpisah; menjalankannya tetap menulis file dan bukan bagian mode langsung.

## Pengujian

~~~powershell
npm test
~~~

Pengujian mencakup batas jumlah request, penggunaan ulang halaman, pembatalan cakupan, filter per prodi, deduplikasi, request bersama, percobaan ulang, validasi proxy, dan profil resmi.
