# SpotIn — Temukan Spot Nongkrong Terbaik 🗺️

> Kelompok 3 

SpotIn adalah aplikasi web pencari cafe, restoran, dan tempat nongkrong di kota-kota Indonesia. Menggabungkan **Peta Interaktif** berbasis Geoapify + Leaflet dan **Chat AI** berbasis MCP + Ollama.

---

## 👥 Anggota Kelompok

| Nama | Tugas |
|------|-------|
| Kelvin | Project lead, integrasi sistem, semua file |
| Egi Hartedy | `mcp-server.ts` & `server.js` |
| jlyansi putri | `map.html` |
| putri artika destianti | `index.html` |

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|-------|------------|
| 🗺️ Peta Interaktif | Cari tempat by nama kota atau GPS, tampil di peta Leaflet + OpenStreetMap |
| 🤖 Chat AI | Tanya AI tentang tempat nongkrong, dijawab pakai MCP tools + Ollama |
| 🔍 Autocomplete | Saran nama kota otomatis saat mengetik di search bar |
| 📋 Data Lokal | 60 tempat hasil riset di Sintang, Pontianak, dan Singkawang |
| ⚡ Fallback System | Data lokal tidak ada → otomatis pakai Geoapify API |
| 🌙 Dark/Light Mode | Tema gelap dan terang, tersimpan otomatis |

---

## 🏗️ Struktur Project

```
SpotIn1/
├── data/
│   └── places.json     ← Database lokal 60 tempat hasil riset
├── index.html          ← Halaman Chat AI (SpotIn AI)
├── map.html            ← Halaman Peta Interaktif
├── mcp-server.ts       ← MCP Server (3 tools pencarian)
├── server.js           ← Backend Express + MCP Client
├── package.json        ← Daftar dependencies
├── .env                ← API keys (JANGAN di-upload ke GitHub)
└── README.md           ← Dokumentasi ini
```

> **Catatan:** Folder `node_modules/` dan file `.env` tidak perlu di-upload ke GitHub.

---

## 🔧 Cara Kerja Sistem

```
Browser (index.html / map.html)
        │
        ▼
    server.js  ──────────────────────► Geoapify API
        │                               (data peta)
        ▼
    Ollama AI
        │
        ▼
  mcp-server.ts
        │
        ├──► places.json  (data lokal — Sintang, Pontianak, Singkawang)
        │
        └──► Geoapify API (fallback jika kota tidak ada di data lokal)
```

### Penjelasan setiap file

| File | Fungsi |
|------|--------|
| `server.js` | Backend utama — melayani semua request dari browser dan menjalankan MCP client |
| `mcp-server.ts` | MCP Server — menyediakan 3 tools pencarian untuk Chat AI |
| `index.html` | Halaman Chat AI dengan Ollama + MCP |
| `map.html` | Halaman Peta Interaktif dengan Leaflet + Geoapify |
| `places.json` | Database lokal 60 tempat hasil riset manual |

---

## 🛠️ MCP Tools (3 Tools)

| Tool | Fungsi | Trigger |
|------|--------|---------|
| `cari_tempat_di_kota` | Cari cafe/resto berdasarkan nama kota | "cafe di Sintang" |
| `cari_tempat_terdekat` | Cari cafe/resto berdasarkan koordinat GPS | "tempat nongkrong dekat sini" |
| `cari_berdasarkan_nama` | Cari berdasarkan nama brand | "cari Mixue", "KFC terdekat" |

### Sistem Fallback

```
User tanya kota tertentu
        │
        ▼
Cek places.json dulu
        │
        ├── Ada datanya? ──► Pakai data lokal ✅ (akurat)
        │
        └── Tidak ada? ───► Fallback Geoapify API ✅ (real-time)
```

> **Tips:** Untuk hasil AI paling akurat, ketik **Sintang**, **Pontianak**, atau **Singkawang** — kota-kota yang sudah punya data lokal terverifikasi.

---

## 📦 Cara Instalasi & Menjalankan

### 1. Prasyarat
- Node.js versi 18 ke atas → [nodejs.org](https://nodejs.org)
- Akses ke server Ollama (lokal atau remote dari instruktur)

### 2. Install dependencies
```bash
cd SpotIn1
npm install
```

### 3. Buat file `.env`
Buat file `.env` di dalam folder `SpotIn1`:

```env
PORT=3001
GEOAPIFY_API_KEY=isi_api_key_geoapify_disini
OLLAMA_HOST=isi_url_ollama_disini
OLLAMA_MODEL=gpt-oss:120b
OLLAMA_API_KEY=isi_api_key_ollama_jika_ada
```

### 4. Dapatkan Geoapify API Key (gratis)
1. Daftar di [myprojects.geoapify.com](https://myprojects.geoapify.com)
2. Buat project baru
3. Copy API key → paste ke `.env`
4. Gratis: **3.000 request/hari**

### 5. Jalankan SpotIn
```bash
npm run dev
```

Buka browser → `http://localhost:3001`

---

## 🌐 API Endpoints

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| GET | `/api/health` | Cek status server, Geoapify, dan MCP |
| GET | `/api/places/nearby` | Cari tempat terdekat by GPS |
| GET | `/api/places/search` | Cari tempat by nama kota |
| GET | `/api/places/details` | Detail satu tempat by place_id |
| GET | `/api/places/autocomplete` | Saran nama kota saat mengetik |
| POST | `/api/chat` | Kirim pesan ke AI |
| POST | `/api/reset` | Reset sesi chat |

---

## 📊 Data Lokal (places.json)

Database 60 tempat hasil riset manual yang sudah diverifikasi:

| Kota | Cafe | Restaurant | Total |
|------|------|------------|-------|
| Sintang | 10 | 10 | 20 |
| Pontianak | 10 | 10 | 20 |
| Singkawang | 10 | 10 | 20 |
| **Total** | **30** | **30** | **60** |

---

## 🔑 Teknologi yang Digunakan

| Teknologi | Versi | Kegunaan |
|-----------|-------|----------|
| Node.js + Express | 18+ | Backend server |
| TypeScript + tsx | 5.x | MCP server |
| Ollama | - | AI model runner |
| Model Context Protocol (MCP) | 1.0 | Jembatan AI ↔ tools |
| Geoapify API | v2 | Data dan geocoding tempat |
| Leaflet + OpenStreetMap | 1.9.4 | Tampilan peta interaktif |
| NodeCache | - | Cache hasil API (5 menit) |
| marked.js | 9.1.6 | Render markdown di chat AI |

---

## ❗ Troubleshooting

**Port sudah dipakai (EADDRINUSE):**
```bash
# Windows — cari PID yang pakai port 3001
netstat -ano | findstr :3001
taskkill /PID [nomor_pid] /F

# Atau kill semua proses node sekaligus
taskkill /IM node.exe /F
```

**MCP tidak terhubung:**
```bash
npm install   # pastikan semua dependencies terinstall
npm run dev   # restart server
```

**Geoapify belum diset:**
- Pastikan file `.env` ada dan `GEOAPIFY_API_KEY` sudah diisi
- Cek di terminal: harus muncul `🔑 Geoapify : ✅ OK`
- Test: buka `http://localhost:3001/api/test` di browser

**Ollama tidak bisa dijangkau:**
- Cek `OLLAMA_HOST` di `.env` sudah benar
- Kalau pakai Ollama lokal: jalankan `ollama serve` di terminal terpisah
- Kalau pakai server instruktur: pastikan URL dan API key benar

**AI respond lambat:**
- Wajar jika model besar (120b) — perlu waktu beberapa detik
- Chat biasa ("halo") cepat, tanya lokasi lebih lambat karena harus fetch data

---

## 📝 Catatan Penting

- File `.env` **JANGAN di-upload ke GitHub** — berisi API key rahasia
- Folder `node_modules/` **tidak perlu di-upload** — jalankan `npm install` untuk generate ulang
- Untuk demo presentasi, gunakan kota **Sintang**, **Pontianak**, atau **Singkawang** agar data AI lebih akurat
- Data Geoapify untuk kota lain mungkin kurang akurat — selalu cek link Google Maps yang disediakan AI