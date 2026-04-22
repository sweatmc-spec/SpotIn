# SpotIn — Temukan Spot Nongkrong Terbaik 🗺️

SpotIn adalah aplikasi web untuk mencari cafe, restoran, dan tempat nongkrong di kota-kota Indonesia. Terdiri dari dua fitur utama: **Peta Interaktif** dan **Chat AI** berbasis MCP + Ollama.

---

## 👥 Anggota Kelompok

| Nama | TUGAS |
|------|-----|
| [kelvin] | [mcp-server.ts], [server.js], [map.html], [server.js], [index.html], [places.json], [.env] |
| [Egi] | [mcp-server.ts] & [server.js] |
| [Amoy] | [map.html] |
| [putri] | [index.html] |


---

## ✨ Fitur

- 🗺️ **Peta Interaktif** — Cari tempat berdasarkan nama kota atau GPS, tampil di peta Leaflet + OpenStreetMap
- 🤖 **Chat AI** — Tanya ke AI tentang tempat nongkrong, dijawab menggunakan MCP tools + Ollama
- 🔍 **Autocomplete** — Saran nama kota saat mengetik di search bar
- 📋 **Data Lokal** — Database 40 tempat hasil riset di Sintang dan Pontianak
- ⚡ **Fallback System** — Kalau data lokal tidak ada, otomatis pakai Geoapify API

---

## 🏗️ Struktur Project

```
SpotIn1/
├── data/
│   └── places.json       ← Database lokal 40 tempat (Sintang & Pontianak)
|── index.html        ← Halaman Chat AI
│── map.html          ← Halaman Peta Interaktif
├── node_modules/         ← Dependencies (auto-generated)
├── .env                  ← API keys (buat manual, jangan di-upload)
├── mcp-server.ts         ← MCP Server (3 tools pencarian tempat)
├── package.json          ← Daftar dependencies
├── README.md             ← Dokumentasi ini
└── server.js             ← Backend Express + MCP Client
```

---

## 🔧 Cara Kerja Sistem

```
Browser (index.html / map.html)
        ↓ request
server.js  ←→  Geoapify API  (data peta)
        ↓
    Ollama AI  ←→  mcp-server.ts  (3 MCP tools)
                        ↓
                   places.json / Geoapify
```

### Penjelasan setiap file:

| File | Fungsi |
|------|--------|
| `server.js` | Backend utama — melayani semua request dari browser |
| `mcp-server.ts` | Menyediakan 3 tools untuk Chat AI |
| `index.html` | Halaman Chat AI (SpotIn AI) |
| `map.html` | Halaman Peta Interaktif |
| `places.json` | Database lokal 40 tempat hasil riset |

---

## 🛠️ MCP Tools (3 Tools)

| Tool | Fungsi |
|------|--------|
| `cari_tempat_di_kota` | Cari cafe/resto berdasarkan nama kota |
| `cari_tempat_terdekat` | Cari cafe/resto berdasarkan koordinat GPS |
| `cari_berdasarkan_nama` | Cari berdasarkan nama brand (Mixue, KFC, dll) |

### Sistem Fallback:
1. Cek `places.json` dulu (data lokal)
2. Kalau tidak ada → otomatis pakai Geoapify API

---

## 📦 Cara Instalasi

### 1. Install Node.js
Download dan install dari [nodejs.org](https://nodejs.org) (versi 18 ke atas)

### 2. Clone / Download project
```bash
cd SpotIn1
npm install
```

### 3. Buat file `.env`
Buat file `.env` di dalam folder SpotIn1:
```
PORT=3000
GEOAPIFY_API_KEY=isi_api_key_geoapify_disini
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gpt-oss:120b
OLLAMA_API_KEY=
```

### 4. Dapatkan Geoapify API Key (gratis)
1. Daftar di [myprojects.geoapify.com](https://myprojects.geoapify.com)
2. Buat project baru
3. Copy API key → paste ke `.env`
4. Gratis: 3.000 request/hari


### 5. Jalankan SpotIn
```bash
npm run dev
```

Buka browser → `http://localhost:3000`

---

## 🌐 API Endpoints

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| GET | `/api/health` | Cek status server dan MCP |
| GET | `/api/places/nearby` | Cari tempat terdekat by GPS |
| GET | `/api/places/search` | Cari tempat by nama kota |
| GET | `/api/places/details` | Detail satu tempat by place_id |
| GET | `/api/places/autocomplete` | Saran nama kota saat mengetik |
| POST | `/api/chat` | Kirim pesan ke AI |
| POST | `/api/reset` | Reset sesi chat |

---

## 📊 Data Lokal (places.json)

Database lokal hasil riset sendiri berisi 40 tempat:

| Kota | Cafe | Restaurant | Total |
|------|------|------------|-------|
| Sintang | 10 | 10 | 20 |
| Pontianak | 10 | 10 | 20 |
| **Total** | **20** | **20** | **40** |

---

## 🔑 Teknologi yang Digunakan

| Teknologi | Kegunaan |
|-----------|----------|
| Node.js + Express | Backend server |
| TypeScript + tsx | MCP server |
| Ollama | AI lokal |
| Model Context Protocol (MCP) | Jembatan AI dengan tools |
| Geoapify API | Data dan peta tempat |
| Leaflet + OpenStreetMap | Tampilan peta interaktif |
| NodeCache | Cache hasil API (5 menit) |

---

## ❗ Troubleshooting

**Server tidak bisa jalan:**
```bash
# Pastikan port 3000 tidak dipakai
# Windows:
netstat -ano | findstr :3000
taskkill /PID [nomor PID] /F
```

**MCP tidak terhubung:**
```bash
npm install  # pastikan semua dependencies terinstall
```

**Ollama tidak bisa dijangkau:**
```bash
ollama serve  # jalankan di terminal terpisah
```

**API key Geoapify tidak valid:**
- Cek file `.env` sudah terisi
- Cek kuota tidak habis (max 3.000/hari)
- Test di browser: `http://localhost:3000/api/test`

---

## 📝 Catatan

- File `.env` **jangan di-upload ke GitHub** karena berisi API key rahasia
- Folder `node_modules` **tidak perlu di-upload** — jalankan `npm install` untuk generate ulang
- Data Geoapify untuk kota kecil seperti Sintang mungkin terbatas — itulah fungsi `places.json`
- saya sarankan untuk mengetikan sintang atau pontianak untuk AI nya, data itu yang paling benar dari places.json