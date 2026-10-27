# Microstock Adobe Helper Pro (AI Contributor Edition)

Aplikasi web statis (*100% Client-Side*) yang dirancang khusus untuk kontributor **Adobe Stock**, **Shutterstock**, dan **Freepik** (terutama pengguna aset **Generative AI** seperti Midjourney, Flux, Firefly, dan DALL-E).

## Keunggulan Dibandingkan Versi Lama
1. **Real Multimodal Gemini Vision AI (`js/gemini-vision.js`)**:
   - Menganalisis **visual piksel gambar asli**, bukan menebak dari nama file (`IMG_1234.jpg`).
   - Tidak ada *silent fallback* palsu yang menyuntikkan judul *"Electronic Microchip"* atau *"Ceramic Pottery"*.
   - Menyusun **10 Keyword Pertama** berdasarkan prioritas bobot algoritma pencarian Adobe Stock.
   - **Auto-Sanitizer**: Menghapus otomatis 150+ merek/trademark terlarang dan kata teknis spam (`4K, 8K, DSLR, Photorealistic, Midjourney, Wallpaper`).
2. **Multi-Mode Anti-Halo Upscaler (`js/upscaler.js`)**:
   - Mendukung target resolusi **4.4 MP**, **8.6 MP (4K)**, **12.5 MP**, dan **16.5 MP**.
   - Memiliki 3 profil nyata: **AI Photorealistic / 3D**, **AI Illustration / Flat Art**, dan **Ultra-Sharp Texture** dengan *Luminance Unsharp Mask + Clamping* agar bebas *ringing halo* saat diperiksa kurator Adobe Stock.
3. **True Contour & Smooth Bezier Vectorizer (`js/vectorizer.js`)**:
   - Mengubah gambar ilustrasi/ikon/stiker menjadi kurva **Bezier `.SVG` dan `.EPS` (PostScript Level 3)** menggunakan *K-Means++ Color Quantization*, *Despeckle Filter*, *Moore-Neighbor Contour Tracing*, dan *Douglas-Peucker Bezier Fitting* (bukan sekadar potongan persegi panjang per baris piksel).
   - Dilengkapi **Vector Suitability Advisor** yang memberi tahu apakah sebuah gambar cocok dijadikan Vector atau lebih aman di-upload sebagai JPG High-Res.
4. **Direct Adobe XMP / IPTC Binary Injector (`js/xmp-exporter.js`)**:
   - Menyuntikkan paket XMP standar Adobe langsung ke dalam file `.JPG` (`APP1`) dan `.PNG` (`iTXt`) sehingga saat di-upload ke portal Adobe Stock Contributor, kolom **Title** dan **Keywords** langsung terisi otomatis.

---

## Cara Upload ke GitHub Pages (Tanpa Build / Langsung Jalan)
1. Buat repository baru di GitHub (misal: `microstock-adobe-helper`).
2. Upload seluruh isi folder `microstock-adobe-helper` ini (`index.html`, `.nojekyll`, folder `css/`, dan folder `js/`) ke branch `main`.
3. Buka menu **Settings ➔ Pages** di repository GitHub Anda.
4. Pada bagian **Build and deployment**, pilih Source: **Deploy from a branch**, lalu pilih branch **`main`** dan folder **`/ (root)`**, kemudian klik **Save**.
5. Aplikasi Anda langsung aktif di `https://<username-github-anda>.github.io/microstock-adobe-helper/`.

## Cara Menjalankan di Lokal (XAMPP)
Karena folder ini berada di dalam `c:\xampp\htdocs\simsdm-uinsaizu\microstock-adobe-helper`, Anda juga dapat membukanya melalui server lokal atau menggunakan ekstensi **Live Server** di VS Code.

