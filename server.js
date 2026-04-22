const express   = require('express');//bikin server
const cors      = require('cors');//izinkan akses dari frontend
const NodeCache = require('node-cache');//simpan data sementara (hemat API)
const axios     = require('axios');//REQUEST KE API
require('dotenv').config(); //ambbil api key dari .env

const app  = express();//jalankan server di port .env
const PORT = process.env.PORT || 3000; // jika .env tidak ada port maka menggunakan port 3000

// NodeCache menyimpan data hasil dari API di memory (RAM),
// supaya tidak perlu request ke API lagi selama 5 menit.
// Setelah itu, data di cache dihapus, jadi request berikutnya akan ambil lagi dari API.
// Tujuan: hemat kuota Geoapify (gratis 3.000 req/hari)
const cache = new NodeCache({ stdTTL: 300 });

let mcpClient = null;        // sebagai jembatan antara server.js dan mcp-server.ts, cara terhubungnya dari startMCP
let mcpTools  = [];          // mengambil tools dari mcp-server.ts ke server.js
let mcpReady  = false;       // mcp berhasil terhubung atau tidak. if: mcp terhubung → ollama bisa pakai tool. else: mcp gagal → ollama jawab sendiri tanpa tool
const chatSessions = new Map(); // memory chat dalam sesi tersebut

// ================================================================
// MIDDLEWARE — kode yang berjalan sebelum request sampai ke route
// ================================================================
app.use(cors({ origin: '*' }));     // cors memblokir orang yang localhost-nya berbeda (bukan localhost:3000)
                                    // tapi dengan cors origin: '*' semua boleh akses, '*' artinya izinkan semua orang dari mana saja
app.use(express.json());            // sebagai pembaca json. cara kerjanya:
                                    // JSON.stringify() = memasukkan prompt ke dalam kotak (browser kirim)
                                    // express.json()   = membuka kotak dan mengambil isinya (server baca)
app.use(express.static(__dirname)); // menjalankan HTML, CSS dan JS saja
                                    // express.static cari index.html → ketemu → kirim ke browser → tampil!

// ================================================================
// KONSTANTA & HELPER
// ================================================================

const GEO_BASE = 'https://api.geoapify.com'; // sebagai tempat tanya dan pemberi jawaban.
                                              // kita memerlukan api key dulu, kalau tidak ada
                                              // /api/places/search atau yang lain pun tidak akan memberikan data

// fungsi getKey() untuk mengambil api key geoapify dari .env
// dan jika key belum ada maka dia akan throw pesan error
function getKey() {
    const k = process.env.GEOAPIFY_API_KEY;
    if (!k) throw new Error('GEOAPIFY_API_KEY belum diset');
    return k;
}

// fungsi fail(res, status, msg) sebagai helper untuk mengirim response error
// dengan format konsisten di semua endpoint
// Contoh: fail(res, 400, 'lat dan lng wajib')
// Output: HTTP 400 → { success: false, error: "lat dan lng wajib" }
function fail(res, status, msg) {
    return res.status(status).json({ success: false, error: msg });
}

// untuk Geoapify paham, kita menggunakan catering.
// jika tidak ada catering maka dia tidak akan paham.
// contoh: kita memilih filter cafe, maka dia akan pakai catering.cafe
// kalau tidak ada catering tapi cuma cafe maka dia tidak akan paham
const TYPE_MAP = {
    all:        'catering',
    cafe:       'catering.cafe',
    restaurant: 'catering.restaurant,catering.fast_food,catering.food_court',
};

// untuk BLACKLIST tempat yang tidak relevan
const BLACKLIST = [
    // minimarket
    'alfamart', 'indomaret', 'alfamidi', 'lawson', 'circle k', 'bimoli',
    // supermarket besar
    'hypermart', 'giant', 'lottemart', 'superindo', 'hero', 'transmart',
    // SPBU & ATM
    'atm', 'spbu', 'pom bensin', 'pertamina', 'vivo', 'shell', 'total energi',
    // fasilitas kesehatan
    'apotek', 'klinik', 'puskesmas', 'rumah sakit', 'rs ',
    // bank
    'bank bri', 'bank bni', 'bank mandiri', 'bank btpn',
];

// fungsi isBlacklisted(name) untuk mengecek apakah nama tempat mengandung kata dari blacklist
// nama di-lowercase dan return true = tempat ini harus disembunyikan
function isBlacklisted(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    return BLACKLIST.some(b => lower.includes(b));
}

// fungsi formatPlace(feature): Mengubah format data GeoJSON mentah dari Geoapify
// menjadi objek yang konsisten dan mudah dipakai oleh frontend (map.html)
function formatPlace(feature) {
    const p      = feature.properties;              // Geoapify kirim data dalam format GeoJSON yang bertingkat.
                                                     // properties adalah tempat semua informasi tempat disimpan
    const coords = feature.geometry?.coordinates || []; // ambil coord kalau ada, kalau tidak ada jangan error gara-gara '?.'
    return {
        place_id: p.place_id,
        // id unik untuk setiap tempat di Geoapify, dipakai untuk fetch detail tempat saat user klik kartu
        // contoh: place_id: "5a3f2b1c9e8d7a6b4c3d2e1f"
        // dipakai di map.html saat buka modal: fetch('/api/places/details?place_id=' + p.place_id)

        name: p.name || p.formatted,
        // ambil nama tempat. kalau name tidak ada, pakai formatted sebagai cadangan
        // formatted adalah alamat lengkap dalam satu kalimat dari Geoapify

        vicinity: [p.address_line1, p.address_line2].filter(Boolean).join(', ') || p.city || '',
        // membuat alamat lengkap dari beberapa bagian
        // line1 = Jl, line2 = Kota, jadi array contoh: ['Jl. Oevang No. 10', 'Sintang']
        // filter(Boolean): kalau null dibuang
        // .join(', '): gabungkan dengan koma
        // kalau kedua line null, pakai p.city = 'kota'
        // kalau city juga null pakai '' (kosong)

        formatted_address: p.formatted,
        // alamat lengkap versi Geoapify dalam satu baris, dipakai di modal detail
        // contoh: "CW Cafe, Jl. Oevang Oeray No. 10, Sintang, West Kalimantan, Indonesia"

        types: (p.categories || []).map(c => c.split('.').pop()), 
        // mengambil tipe tempat dari kategori Geoapify, dia mencari bagian terakhir saja
        // contoh: "catering.cafe" → split('.') → ["catering","cafe"] → pop() → "cafe"
        // hasil: types = ["cafe", "coffee_shop"]

        geometry: {
            location: { lat: coords[1], lng: coords[0] }
            // koordinat dibalik karena GeoJSON formatnya [lng, lat] bukan [lat, lng]
            // kenapa dibalik: karena GeoJSON ikut sistem x=horizontal=longitude, y=vertical=latitude
        },

        photos: p.wiki_and_media?.image ? [{ photo_url: p.wiki_and_media.image }] : [],
        // mengambil foto tempat kalau ada, kalau tidak ada pakai array kosong []

        website: p.website || null,
        // mencari website cafe/resto mereka, jika tidak ada null

        formatted_phone_number: p.contact?.phone || null,
        // mencari nomor telepon tempat mereka, kalau tidak ada null
    };
}

// fungsi fetchOnce: melakukan SATU request ke Geoapify Places API
// limit 40 = batas maksimal hasil per request dari Geoapify
async function fetchOnce(lng, lat, category, radius, limit = 40) {
    const { data } = await axios.get(`${GEO_BASE}/v2/places`, { // axios adalah kendaraan untuk pergi ke Geoapify, await menunggu jawaban dari Geoapify
        params: {
            categories: category,                          // tipe tempat dari TYPE_MAP
            filter:     `circle:${lng},${lat},${radius}`, // batasi area berbentuk lingkaran
            bias:       `proximity:${lng},${lat}`,         // prioritaskan yang paling dekat
            limit,                                         // maksimal hasil yaitu 40 default kalau tidak diisi
            apiKey:     getKey(),                          // tiket masuk ke Geoapify
        },
    });
    return (data.features || [])
    // ambil array features, kalau tidak ada pakai array kosong []
        .map(formatPlace)
        // ubah format Geoapify → format SpotIn
        // sebelum .map(): { properties: { name: "CW Cafe", ... }, geometry: {...} }
        // sesudah .map(): { name: "CW Cafe", place_id: "abc", vicinity: "...", ... }
        .filter(p => {
            if (!p.name || isBlacklisted(p.name)) return false;
            return true;
            // filter untuk nama yang ada di blacklist
            // yang sesuai dengan category akan ditampilkan
        });
}

// fungsi fetchPlaces: wrapper cerdas di atas fetchOnce()
// mode "all" → fetch semua sub-kategori parallel
// mode spesifik → fetch langsung satu kategori
async function fetchPlaces(lng, lat, category, radius) {
    const cats = category.split(',').map(c => c.trim());
    // .split(',') → pecah berdasarkan koma
    // .map(c => c.trim()) → hapus spasi di depan/belakang

    // sub-kategori untuk mode "all"
    const BATCH_CATS = [
        'catering.cafe',
        'catering.restaurant',
        'catering.fast_food',
        'catering.food_court',
        'catering.bar,catering.pub', 
        'catering.ice_cream',
    ];

    let results;

    if (cats.includes('catering') || category.includes('catering,')) {
        // Mode "all" → category = 'catering'
        // Mode spesifik → category = 'catering.cafe'

        // mode "all" - fetch semua sub-kategori sekaligus (parallel), semua jalan bersamaan, lebih cepat
        const batches = await Promise.allSettled(
        // Promise.allSettled → kalau 1 gagal, yang lain tetap jalan ✅
            BATCH_CATS.map(c => fetchOnce(lng, lat, c, radius, 20))
        );

        // gabungkan semua hasil dari batch yang berhasil
        const all = batches
            .filter(b => b.status === 'fulfilled') // ambil hanya yang berhasil, buang yang gagal
            .flatMap(b => b.value);                // gabungkan semua array hasil menjadi satu array

        // deduplikasi - satu tempat tidak boleh muncul dua kali
        const seen = new Set();
        results = all.filter(p => {
            if (!p.place_id || seen.has(p.place_id)) return false;
            // kalau place_id tidak ada → buang
            // kalau place_id sudah pernah masuk seen → duplikat, buang
            seen.add(p.place_id);
            return true; // belum pernah → simpan ke seen, loloskan
        });
    } else {
        // mode spesifik - fetch langsung satu kategori
        results = await fetchOnce(lng, lat, category, radius);
    }
    return results;
}

// ================================================================
// ENDPOINT: GET /api/health
// Mengecek status server, API key, dan koneksi MCP.
// Dipakai frontend untuk menampilkan dot status (hijau/merah)
// di sidebar index.html dan header chat.
// Response: { success, status, apiKeyConfigured, mcpConnected, toolsAvailable }
// ================================================================
app.get('/api/health', (req, res) => {
    res.json({
        success:          true,
        status:           'OK',
        apiKeyConfigured: !!process.env.GEOAPIFY_API_KEY,
        mcpConnected:     mcpReady,
        toolsAvailable:   mcpTools.map(t => t.name),
    });
});

// ================================================================
// ENDPOINT: GET /api/places/nearby
// Mencari tempat terdekat berdasarkan koordinat GPS user
// ================================================================
app.get('/api/places/nearby', async (req, res) => {
    const { lat, lng, type = 'cafe', radius = 5000 } = req.query;
    if (!lat || !lng) return fail(res, 400, 'lat dan lng wajib');

    const category = TYPE_MAP[type] || 'catering.cafe';
    console.log(`[nearby] type=${type} → category=${category} radius=${radius}m`);

    try {
        let results = await fetchPlaces(lng, lat, category, radius);

        // auto-expand jika hasil terlalu sedikit (daerah sepi)
        if (results.length < 10) {
            console.log(`[nearby] Sedikit (${results.length}), expand radius...`);
            const bigger = await fetchPlaces(lng, lat, category, Number(radius) * 4);
            const seen   = new Set(results.map(r => r.place_id));
            const extra  = bigger.filter(r => r.place_id && !seen.has(r.place_id));
            results = [...results, ...extra];
        }

        console.log(`[nearby] → ${results.length} hasil`);
        res.json({ success: true, results });
    } catch (e) {
        console.error('[nearby] ERROR:', e.response?.data?.message || e.message);
        fail(res, 500, e.response?.data?.message || e.message);
    }
});

// ================================================================
// ENDPOINT: GET /api/places/search
// Mencari tempat berdasarkan nama kota
// ================================================================
app.get('/api/places/search', async (req, res) => {
    const { q, type = 'cafe', lat, lng } = req.query;
    // q = 'Sintang' → kata kunci pencarian
    // type = 'cafe' → filter tipe (default 'cafe' kalau tidak dikirim)

    if (!q?.trim()) return fail(res, 400, 'q wajib diisi');
    // validasi — pastikan keyword tidak kosong sebelum lanjut

    // cache adalah tempat menyimpan hasil sementara supaya tidak perlu request ke Geoapify berulang kali
    const cacheKey = `s_${q}_${type}`; 
    // membuat nama unik untuk setiap kombinasi pencarian
    // contoh: q='Sintang' type='cafe' → cacheKey = 's_Sintang_cafe'

    const cached = cache.get(cacheKey);
    // cek apakah hasil pencarian ini sudah pernah disimpan sebelumnya
    // kalau belum ada → pergi ke Geoapify
    // kalau sudah ada → langsung kasih hasilnya (yang penting bukan lebih dari 5 menit)

    if (cached) return res.json({ ...cached, fromCache: true });
    // kalau sudah ada di cache, langsung kirim balik tanpa ke Geoapify

    try {
        // step 1: geocode — ubah nama kota → koordinat
        // tambah ", Indonesia" agar tidak salah kota dengan negara lain
        const searchText = q.toLowerCase().includes('indonesia') ? q : `${q}, Indonesia`;
        // memastikan pencarian selalu di Indonesia
        // jadi ketika kita cuma menambahkan nama kota, nanti akan otomatis kasih tau kalau itu Indonesia
        // contoh: searchText = 'Sintang, Indonesia'

        console.log(`[search] Geocode "${searchText}"`); // menulis pesan di terminal

        const geoRes = await axios.get(`${GEO_BASE}/v1/geocode/search`, {
            params: { text: searchText, limit: 5, filter: 'countrycode:id', apiKey: getKey() },
        });
        // kirim nama kota ke Geoapify untuk dapat koordinatnya — ini namanya Geocoding
        // Geocoding = ubah nama tempat → koordinat

        const features = geoRes.data.features || [];
        // ambil hasil geocoding dari response Geoapify
        // contoh: { properties: { city: 'Sintang', result_type: 'city' }, geometry: { coordinates: [111.47, -0.06] } }

        if (!features.length)
            return res.json({ success: true, results: [], centerLat: null, centerLng: null });
        // kalau kota tidak ditemukan, langsung kirim response kosong

        // step 2: pilih hasil geocode terbaik
        const PRIORITY = ['city', 'county', 'district', 'state', 'town', 'municipality'];
        // prioritaskan level city/county/district — bukan village (terlalu kecil)

        let best = features[0];
        // default pilihan pertama sebagai cadangan kalau tidak ada yang cocok dengan PRIORITY

        for (const f of features) {
        // loop — periksa satu per satu hasil geocoding karena minta 5 hasil
            const ftype = f.properties.result_type || '';
            // ambil level wilayahnya, contoh: 'city', 'village', 'district'

            if (PRIORITY.some(p => ftype.includes(p))) { best = f; break; }
            // mencari tau apakah wilayah ini ada di priority
            // kalau ada → best = f akan jadi 1 priority untuk sebagai tempat pusat pencarian
        }

        const [centerLng, centerLat] = best.geometry.coordinates;
        // ambil koordinat dari hasil terbaik

        console.log(`[search] Dipilih: "${best.properties.formatted}" (${best.properties.result_type})`);

        const category = TYPE_MAP[type] || 'catering.cafe';
        // terjemahkan tipe filter ke kategori Geoapify

        // helper deduplikasi lokal
        // kita akan fetch 3 radius sekaligus, jadi kita akan coba mendeteksi 3 kali
        // jika kita mendeteksi tempat yang sama 3 kali maka akan dihapus menjadi 1
        const dedupe = (arr) => {
            const seen = new Set();
            return arr.filter(p => {
                if (!p.place_id || seen.has(p.place_id)) return false;
                seen.add(p.place_id); return true;
            });
        };

        // step 3: fetch parallel 3 radius sekaligus, untuk mencoba mencari lebih banyak tempat
        const [r10, r25, r50] = await Promise.allSettled([
        // cara ini buat semuanya berjalan bersamaan, dari 3 detik menjadi 1
            fetchOnce(centerLng, centerLat, category, 10000, 40),
            fetchOnce(centerLng, centerLat, category, 25000, 40),
            fetchOnce(centerLng, centerLat, category, 30000, 40),
        ]);

        // step 4: gabung + deduplikasi — ambil hasil masing-masing radius ke variabel sendiri
        let results = dedupe([
            ...(r10.status === 'fulfilled' ? r10.value : []),
            // kalau r10 berhasil ambil hasil, kalau gagal pakai array kosong supaya tidak error
            ...(r25.status === 'fulfilled' ? r25.value : []),
            // sebelum spread: [CW Cafe, Kopi Kapuas]
            // sesudah spread "...": CW Cafe, Kopi Kapuas (tanpa kurung)
            // digabungkan r10+r25+r50 menjadi satu array besar
            ...(r50.status === 'fulfilled' ? r50.value : []),
        ]);

        // step 5: fallback — kalau masih sedikit, fetch per sub-kategori
        // berguna untuk kota kecil yang datanya terbatas di Geoapify
        if (results.length < 15) {
            console.log(`[search] Masih ${results.length}, fetch sub-kategori parallel...`);
            const SUB = [
                'catering.cafe', 'catering.restaurant', 'catering.fast_food',
                'catering.food_court', 'catering.bar', 'catering.ice_cream'
            ]; // fallback tambahan

            const subs = await Promise.allSettled(
                SUB.map(c => fetchOnce(centerLng, centerLat, c, 30000, 20))
            );
            // fetch 6 sub-kategori parallel, radius 50km, limit 20

            const extra = subs
                .filter(b => b.status === 'fulfilled') // ambil yang berhasil saja
                .flatMap(b => b.value);                // keluarkan isi, gabung jadi satu

            results = dedupe([...results, ...extra]);
            // gabungkan hasil lama + hasil baru
            // contoh: results = [CW Cafe, Kopi Kapuas, Kopi Dayak, RM Padang, Betang, Seafood]
        }

        // step 6: sort dari yang paling dekat ke pusat kota
        // Pythagoras sederhana — cukup akurat untuk radius kota
        results.sort((a, b) => {
            const dist = (p) => {
            // fungsi untuk menghitung jarak satu tempat dari pusat kota
                const loc = p.geometry?.location; // ambil koordinat tempat
                if (!loc) return 99999;            // kalau tidak ada koordinat anggap sangat jauh
                const dlat = loc.lat - centerLat, dlng = loc.lng - centerLng; // selisih lat dan lng
                return Math.sqrt(dlat * dlat + dlng * dlng); // rumus Pythagoras
            };
            return dist(a) - dist(b);
        });

        console.log(`[search] → ${results.length} hasil total`);
        // di terminal contoh: [search] → 12 hasil total

        // step 7: simpan ke cache dan kirim ke browser
        const response = { success: true, results, centerLat, centerLng };
        // membungkus semua data yang mau dikirim ke browser menjadi satu objek

        cache.set(cacheKey, response);
        // simpan response ke cache supaya next request tidak perlu ke Geoapify lagi

        res.json(response);
        // kirim response ke browser sebagai JSON, map.html terima data ini

    } catch (e) {
        console.error('[search] ERROR:', e.response?.data?.message || e.message); // tulisan error di terminal
        fail(res, 500, e.response?.data?.message || e.message);                   // kirim error ke browser
    }
});

// ================================================================
// ENDPOINT: GET /api/places/details
// Mengambil detail lengkap satu tempat berdasarkan place_id-nya.
// Dipanggil saat user klik kartu tempat di map.html untuk buka modal
// ================================================================
app.get('/api/places/details', async (req, res) => {
    const { place_id } = req.query;
    // ambil place_id dari URL
    // URL yang dikirim: '/api/places/details?place_id=abc123'
    // jadi req.query = { place_id: 'abc123' }, dan place_id = 'abc123'

    if (!place_id) return fail(res, 400, 'place_id wajib');
    // validasi: kalau tidak ada place_id, tidak mungkin tahu tempat mana yang mau dicari → error 400

    try {
        const { data } = await axios.get(`${GEO_BASE}/v2/place-details`, {
        // minta detail lengkap satu tempat ke Geoapify berdasarkan place_id
            params: { id: place_id, apiKey: getKey() }, 
        });
        res.json({ success: true, result: data.features?.[0]?.properties || {} });
        // ambil properties dari hasil pertama
    } catch (e) {
        fail(res, 500, 'Gagal detail: ' + e.message); // tangkap error kalau request ke Geoapify gagal
    }
});

// ================================================================
// ENDPOINT: GET /api/places/autocomplete
// Memberikan saran nama kota saat user mengetik di search bar
// ================================================================
app.get('/api/places/autocomplete', async (req, res) => {
    const { input, lat, lng } = req.query;
    // ambil data dari URL yang dikirim map.html lewat fungsi fetchAC()
    // contoh: input = 'Sint', lat = '-0.06', lng = '111.47'

    if (!input) return fail(res, 400, 'input wajib');
    // kalau tidak ada input/kata kunci akan ditolak

    const cacheKey = `ac_${input}`;
    // buat nama unik untuk cache autocomplete
    // contoh: input = 'Sint' → cacheKey = 'ac_Sint'

    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });
    // kalau sudah pernah dicari pakai cache, tapi jika tidak pakai Geoapify

    try {
        const params = { text: input, limit: 5, apiKey: getKey() };
        // parameter yang dikirim ke Geoapify

        if (lat && lng) params.bias = `proximity:${lng},${lat}`;
        // kalau GPS aktif, prioritaskan saran yang dekat user

        const { data } = await axios.get(`${GEO_BASE}/v1/geocode/autocomplete`, { params });
        // mengirimkan data params ke Geoapify dan tunggu untuk mendapatkan hasilnya

        const predictions = (data.features || []).map(f => ({
        // ubah format Geoapify → format predictions
        // Geoapify formatnya ada: id, formatted, name, city, country
            place_id:    f.properties.place_id,
            description: f.properties.formatted,
            structured_formatting: {
                main_text:      f.properties.name || f.properties.city || f.properties.formatted,
                secondary_text: [f.properties.city, f.properties.country].filter(Boolean).join(', '),
                // buat teks kecil di bawah saran
                // kalau city tidak ada: [null, 'Indonesia'].filter(Boolean) → buang null → ['Indonesia'] → 'Indonesia'
            },
        }));

        const response = { success: true, predictions };
        cache.set(cacheKey, response, 300); // simpan cache untuk 5 menit
        res.json(response);
    } catch (e) {
        fail(res, 500, 'Gagal autocomplete'); // kalau error kasih pesan
    }
});

// ================================================================
// FUNGSI: startMCP()
// Menjalankan mcp-server.ts sebagai subprocess dan menghubungkan
// server.js ke dalamnya sebagai MCP client via STDIO pipe.
//
// Cara kerja:
//   server.js (MCP client) ←→ STDIO pipe ←→ mcp-server.ts (MCP server)
//
// Proses:
//   1. Cari tsx (TypeScript runner) di node_modules lokal
//   2. Jalankan mcp-server.ts sebagai subprocess
//   3. Hubungkan MCP client ke subprocess via StdioClientTransport
//   4. Ambil daftar tools → simpan ke mcpTools
//   5. Set mcpReady = true agar /api/chat bisa pakai tools
// ================================================================
async function startMCP() {
    try {
        const { Client }               = await import('@modelcontextprotocol/sdk/client/index.js');
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        const path = require('path');
        const fs   = require('fs');

        // tentukan command untuk menjalankan mcp-server.ts di dalam server.js
        // js tidak mengerti ts jadi kita npm install untuk tsx otomatis ubah ts supaya js dapat paham
        const isWin  = process.platform === 'win32';
        // cek apakah komputer pakai Windows atau bukan
        // karena kalau pakai Mac atau Linux caranya berbeda

        const tsxBin = path.join(__dirname, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
        // cari lokasi file tsx di dalam folder project

        const hasTsx = fs.existsSync(tsxBin);
        // ketika npm start, cek apakah file tsx benar-benar ada
        // kalau ada → true, kalau tidak ada → false

        const cmd = hasTsx ? tsxBin : (isWin ? 'npx.cmd' : 'npx');
        // untuk terminal menjalankan mcp-server.ts
        // jika ada tsx → pakai tsx, kalau tidak ada tsx → pakai npx sebagai cadangan

        const args = hasTsx
            ? [path.join(__dirname, 'mcp-server.ts')]
            : ['tsx', path.join(__dirname, 'mcp-server.ts')];
        // tsx ada  → langsung kasih file mcp-server.ts
        // tsx tidak ada → pakai npx, perlu kasih nama program dulu

        console.log('🔌 Menghubungkan MCP...');

        // buat transport — subprocess mcp-server.ts dijalankan di sini
        // sebagai koneksi antara mcp dan server.js
        const transport = new StdioClientTransport({
            command: cmd,
            args,
            env: { ...process.env, GEOAPIFY_API_KEY: process.env.GEOAPIFY_API_KEY || '' },
        });

        mcpClient = new Client({ name: 'spotin-server', version: '1.0.0' }); // membuat mcpClient
        await mcpClient.connect(transport);
        // menghubungkan mcpClient yang sudah dibuat dengan mcp-server.ts lewat transport

        // ambil daftar tools dari mcp-server.ts dan simpan ke server.js
        const { tools } = await mcpClient.listTools();
        mcpTools  = tools;
        mcpReady  = true; // mcp sudah siap dipakai — lampu hijau 🟢
        console.log('✅ MCP terhubung! Tools:', tools.map(t => t.name).join(', '));

    } catch (e) {
        console.error('❌ MCP GAGAL:', e.message);
        console.error('   Pastikan sudah: npm install');
        mcpReady = false; // lampu merah 🔴 — server tetap jalan, chat mode non-MCP
    }
}

// ================================================================
// SYSTEM_PROMPT
// Instruksi awal untuk Ollama — menentukan kepribadian SpotIn AI.
// Dikirim sebagai pesan pertama (role: 'system') di setiap sesi baru.
// ================================================================
const SYSTEM_PROMPT = `Kamu adalah SpotIn AI, asisten pencari tempat nongkrong di Indonesia.
Kamu membantu pengguna menemukan cafe, restoran, dan tempat makan di kota mereka.
Jawab dengan ramah dalam Bahasa Indonesia.

ATURAN PENTING:
- Tampilkan data dari tool PERSIS APA ADANYA. Jangan ubah nama atau alamat.
- JANGAN mengarang atau menambah informasi yang tidak ada di data tool.
- JANGAN deskripsikan suasana, interior, atau pengalaman tempat jika tidak ada di data.
- JANGAN bilang "tempat ini cozy", "suasana hangat", "instagramable" dll kecuali ada di data.
- Jika user tanya suasana → jawab jujur "Saya tidak punya info suasana tempat ini, silakan cek Google Maps atau Instagram mereka."
- Selalu sertakan link Google Maps agar user bisa verifikasi sendiri.
- kalau user menanyakan suasana tempat -> jawab "saya sarankan untuk mengecek Google Maps atau Instagram mereka untuk melihat suasana tempat tersebut, karena saya tidak memiliki informasi tentang suasana tempat tersebut."


Saat menampilkan daftar tempat, gunakan format tabel markdown seperti ini:
| No | Nama | Alamat | Kontak |
|----|------|--------|--------|
| 1  | nama | alamat | nomor  |

Pastikan kolom Kontak tidak terpotong — tulis nomor telpom lengkap dalam satu baris.
Pastikan kolom No tidak terpotong — tulis nomor urut dalam satu baris.
Berikan catatan singkat yang menarik untuk setiap tempat.

tolong buat teks nya se rapih mungkin dan muda di baca untuk user. dan tolong berikan sepasi supaya tidak terlalu mepet. 

ketika user menanyakan tentang tempat. kasi juga rasa suasana dari tempat tersebut. apakah tempatnya ramai, cocok untuk kerja, atau santai untuk ngobrol.
${mcpReady ? 'Gunakan tools yang tersedia untuk data real-time.' : ''}`;

// ================================================================
// FUNGSI: getSession(id)
// Sebagai cara system menjawab user.
// Setiap percakapan disimpan karena Ollama butuh riwayat
// karena tidak punya memori sendiri.
// Jadi dia bisa melihat balik apa yang kita minta sebelumnya.
// Kalau sesi baru  → buat array baru dengan system prompt
// Kalau sudah ada  → kembalikan array yang sudah ada
// ================================================================
function getSession(id) {
    if (!chatSessions.has(id)) {
        chatSessions.set(id, [{ role: 'system', content: SYSTEM_PROMPT }]);
        // instruksi awal untuk system, selanjutnya user
    }
    return chatSessions.get(id);
}

// ================================================================
// ENDPOINT: POST /api/chat
// Untuk menerima pesan user dan mengembalikan balasan AI
// ================================================================
app.post('/api/chat', async (req, res) => {
    const { message, sessionId = 'default' } = req.body || {};
    // ambil pesan dan ID sesi dari body POST

    if (!message?.trim()) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });
    // validasi, tolak kalau pesan kosong

    const ollamaHost  = process.env.OLLAMA_HOST  || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
    // sebagai cadangan jika .env tidak ada maka pakai ini

    try {
        const { Ollama } = await import('ollama');
        const ollama = new Ollama({
            host: ollamaHost, // buat koneksi dengan Ollama
            // Ollama remote jalan di server lain jadi butuh API key untuk masuk
            ...(process.env.OLLAMA_API_KEY 
                ? { headers: { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } }
                : {}),
        });

        const messages = getSession(sessionId);
        // ambil riwayat percakapan sesi ini

        messages.push({ role: 'user', content: message });
        // tambah pesan user ke riwayat dan supaya AI bisa baca

        let response;

        if (mcpReady && mcpTools.length > 0) {
        // cek apakah MCP siap dan punya tools

            const ollamaTools = mcpTools.map(t => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }));
            // konversi format tools MCP → format Ollama mengerti

            response = await ollama.chat({ model: ollamaModel, messages, tools: ollamaTools }); 
            // kirim pesan ke Ollama beserta tools
            // Ollama terima model, messages (riwayat), tools
            // dan Ollama putuskan "user tanya cafe Sintang" → pakai tool atau jawab sendiri

            // loop tool call — AI bisa minta panggil tool beberapa kali berturut-turut
            let loopCount = 0;
            while (response.message.tool_calls?.length > 0 && loopCount < 5) {
            // menjawab pertanyaan user yang lebih dari 1
            // contoh: "sintang dan pontianak cafe bagus yang mana" → 2 loop karena ada 2 pertanyaan dalam 1 teks
                loopCount++;
                messages.push(response.message); // simpan respons AI (berisi tool_calls)

                for (const tc of response.message.tool_calls) {
                    try {
                        // panggil tool di mcp-server.ts lewat MCP client
                        const result = await mcpClient.callTool({
                            name:      tc.function.name,      // tool-nya
                            arguments: tc.function.arguments, // kota dan filter/tipe-nya
                        });
                        const text = (result.content || [])
                            .filter(c => c.type === 'text')
                            .map(c => c.text)
                            .join('\n'); 
                        messages.push({ role: 'tool', content: text });
                        // simpan hasil tool ke riwayat supaya Ollama bisa baca
                    } catch (toolErr) {
                        messages.push({ role: 'tool', content: `Error: ${toolErr.message}` });
                    }
                }

                // kirim ulang ke Ollama — AI akan merangkum hasil tool
                response = await ollama.chat({ model: ollamaModel, messages, tools: ollamaTools });
            }
        } else {
            // mode non-MCP: Ollama jawab dari pengetahuan sendiri, tidak pakai tool
            response = await ollama.chat({ model: ollamaModel, messages });
        }

        const reply = response.message?.content || 'Maaf, tidak ada respons dari AI.';
        // ambil teks jawaban dari Ollama dan taruh ke reply
        // jika tidak ada maka reply minta maaf

        messages.push({ role: 'assistant', content: reply }); // simpan jawaban AI ke riwayat sesi
        res.json({ reply, sessionId, mcpUsed: mcpReady });    // kirim jawaban ke index.html

    } catch (e) {
    // 3 jenis error kalau ada yang salah
        console.error('[/api/chat error]', e.message);
        let userMsg = e.message;

        if (e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed')) {
            userMsg = `Ollama tidak bisa dijangkau di ${ollamaHost}.\n\nSolusi:\n• Kalau pakai Ollama lokal: jalankan "ollama serve" di terminal lain\n• Kalau pakai server guru: cek OLLAMA_HOST di file .env`;
        } else if (e.message.includes('model') && e.message.includes('not found')) {
            userMsg = `Model "${ollamaModel}" tidak ditemukan.\n\nSolusi: jalankan "ollama pull ${ollamaModel}" di terminal`;
        } else if (e.message.includes('API key') || e.message.includes('401')) {
            userMsg = `API key Ollama tidak valid. Cek OLLAMA_API_KEY di file .env`;
        }

        res.status(500).json({ error: userMsg });
    }
});

// ================================================================
// ENDPOINT: POST /api/reset
// Menghapus riwayat percakapan satu sesi saat user klik tombol
// "Chat Baru" di index.html. Sesi berikutnya fresh dari system prompt.
// ================================================================
app.post('/api/reset', (req, res) => {
    const { sessionId = 'default' } = req.body || {};
    chatSessions.delete(sessionId);
    res.json({ message: 'Sesi direset.' });
});

// ================================================================
// 404 HANDLER — HARUS PALING BAWAH
// Menangani request ke endpoint yang tidak terdaftar.
// Tanpa ini: server diam, tidak ada respon, browser bingung.
// Dengan ini: kita tahu apa yang bermasalah jika error.
// PERINGATAN: Jika dipindah ke atas, SEMUA endpoint akan dapat 404!
// ================================================================
app.use((req, res) => fail(res, 404, `${req.method} ${req.path} tidak ditemukan`));

// ================================================================
// START SERVER
// Jalankan Express di port dari .env (default 3000).
// startMCP() dipanggil TANPA await (non-blocking) agar:
//   - Server langsung bisa terima request dari browser
//   - User tidak perlu menunggu MCP selesai connect
//   - Jika MCP gagal, server tetap jalan (mode non-MCP)
// ================================================================
app.listen(PORT, () => {
    console.log(`\n🚀 SpotIn berjalan di http://localhost:${PORT}`);
    console.log(`🤖 SpotIn AI  : http://localhost:${PORT}/`);
    console.log(`🗺️  Peta       : http://localhost:${PORT}/map.html`);
    console.log(`📋 Health     : http://localhost:${PORT}/api/health`);
    console.log(`🔑 Geoapify   : ${process.env.GEOAPIFY_API_KEY ? '✅ OK' : '❌ Belum diset'}`);
    console.log(`🤖 Ollama     : ${process.env.OLLAMA_HOST || 'http://localhost:11434'}`);
    console.log(`📦 Model      : ${process.env.OLLAMA_MODEL || 'llama3.2'}\n`);
    startMCP(); // non-blocking — tidak pakai await
});

module.exports = app;

// ================================================================
// CATATAN PENTING
// ================================================================

// Kenapa Sintang cuma menunjukan sedikit tempat?
// Geoapify punya database tempat dari seluruh dunia
// tapi tidak semua kota punya data lengkap:
// Pontianak → kota besar → data banyak  → bisa dapat 40+ ✅
// Sintang   → kota kecil → data sedikit → hanya ada 4    ✅
// Jakarta   → kota besar → data banyak  → bisa dapat 40+ ✅
//
// Karena data Geoapify dari OpenStreetMap (OSM) → peta open source
// Data diisi oleh komunitas/masyarakat sendiri
// Kota besar → banyak yang kontribusi → data lengkap
// Kota kecil → sedikit yang kontribusi → data sedikit

// req = request  = yang DATANG dari browser ke server
// res = response = yang PERGI dari server ke browser
