import { McpServer }           from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z }     from "zod";
import axios     from "axios";
import dotenv    from "dotenv";
import * as fs   from "fs";
import * as path from "path";
dotenv.config();

const GEO_BASE = "https://api.geoapify.com";

// ================================================================
// LOAD DATA LOKAL — places.json
// Pakai process.cwd() agar path selalu relatif ke folder SpotIn1
// (lebih reliable daripada import.meta.url saat pakai tsx)
// ================================================================
let localPlaces: any[] = [];
try {
  const filePath = path.join(process.cwd(), "data", "places.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  localPlaces = JSON.parse(raw);
  console.error(`✅ Data lokal dimuat: ${localPlaces.length} tempat`);
} catch (e: any) {
  console.error("⚠️ places.json tidak ditemukan:", e.message);
  console.error("   Pastikan file ada di: SpotIn1/data/places.json");
}

function getKey(): string {
  const k = process.env.GEOAPIFY_API_KEY;
  if (!k) throw new Error("GEOAPIFY_API_KEY belum diset di .env");
  return k;
}

const TYPE_MAP: Record<string, string> = {
  all:        "catering",
  cafe:       "catering.cafe",
  restaurant: "catering.restaurant,catering.fast_food,catering.food_court",
};

const BLACKLIST = [
  "alfamart","indomaret","alfamidi","lawson","hypermart",
  "giant","lottemart","superindo","atm","spbu","pertamina",
  "apotek","klinik","puskesmas","rumah sakit","bank bri","bank bni",
];

function isBlacklisted(name: string): boolean {
  return BLACKLIST.some(b => name.toLowerCase().includes(b));
}

// ================================================================
// FUNGSI: cariDataLokal(kota, tipe)
// Cari data dari places.json berdasarkan nama kota dan tipe.
// Kalau return [] berarti tidak ada data → pakai Geoapify.
// ================================================================
function cariDataLokal(kota: string, tipe: string): any[] {
  if (!localPlaces.length) return [];
  const kotaLower = kota.toLowerCase().replace(/, indonesia/g, "").trim();
  return localPlaces.filter(p => {
    const kotaMatch = p.kota?.toLowerCase().includes(kotaLower) ||
                      kotaLower.includes(p.kota?.toLowerCase());
    if (!kotaMatch) return false;
    if (tipe === "all") return true;
    return p.tipe === tipe;
  });
}

// ================================================================
// FUNGSI: formatLokal(place)
// Ubah format places.json → format konsisten dengan Geoapify
// ================================================================
function formatLokal(p: any): any {
  return {
    place_id: `local_${p.id}`,
    name:     p.name,
    address:  p.alamat,
    lat:      p.lat,
    lng:      p.lng,
    phone:    p.telepon || null,
    website:  p.website || null,
  };
}

// ================================================================
// FUNGSI: formatHasil(places, label, sumber)
// Format array tempat → teks untuk AI
// ================================================================
function formatHasil(places: any[], label: string, sumber = "geoapify"): string {
  if (!places.length) return `Tidak ada ${label} ditemukan.`;
  const info = sumber === "lokal"
    ? "📋 Data dari database lokal SpotIn\n\n"
    : "🌐 Data dari Geoapify (real-time)\n\n";
  const lines = places.slice(0, 15).map((p, i) => {
    const phone = p.phone   ? ` | 📞 ${p.phone}`   : "";
    const web   = p.website ? ` | 🌐 ${p.website}` : "";
    return `${i + 1}. ${p.name}\n   📍 ${p.address || "-"}${phone}${web}`;
  });
  return `${info}Ditemukan ${places.length} ${label}:\n\n${lines.join("\n\n")}`;
}

// ── Geoapify helpers ──────────────────────────────────────────
function formatPlaceGeo(feature: any): any | null {
  const p = feature.properties;
  const geo = feature.geometry;
  if (!p || !geo) return null;
  const name = p.name || p.formatted || "";
  if (!name || isBlacklisted(name)) return null;
  const coords = geo.coordinates || [];
  return {
    place_id: p.place_id || "",
    name,
    address: [p.address_line1, p.address_line2].filter(Boolean).join(", ") || p.city || "",
    lat: coords[1] ?? 0,
    lng: coords[0] ?? 0,
    phone:   p.contact?.phone || null,
    website: p.website || null,
  };
}

const BATCH_CATS = [
  "catering.cafe", "catering.restaurant", "catering.fast_food",
  "catering.food_court", "catering.bar,catering.pub", "catering.ice_cream",
];

async function fetchOnce(lng: number, lat: number, category: string, radiusM: number, limit = 40): Promise<any[]> {
  const { data } = await axios.get(`${GEO_BASE}/v2/places`, {
    params: { categories: category, filter: `circle:${lng},${lat},${radiusM}`, bias: `proximity:${lng},${lat}`, limit, apiKey: getKey() },
  });
  return (data.features || []).map(formatPlaceGeo).filter(Boolean);
}

async function fetchPlacesGeo(lng: number, lat: number, category: string, radiusM: number): Promise<any[]> {
  if (category === "catering") {
    const results = await Promise.allSettled(BATCH_CATS.map(c => fetchOnce(lng, lat, c, radiusM, 20)));
    return results.filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled").flatMap(r => r.value);
  }
  return fetchOnce(lng, lat, category, radiusM, 40);
}

function dedupe(places: any[]): any[] {
  const seen = new Set<string>();
  return places.filter(p => {
    if (!p.place_id || seen.has(p.place_id)) return false;
    seen.add(p.place_id); return true;
  });
}

// ================================================================
// MCP SERVER
// ================================================================
const server = new McpServer({ name: "spotin-mcp-server", version: "1.0.0" });

// ── TOOL 1: cari_tempat_di_kota ──────────────────────────────
server.tool(
  "cari_tempat_di_kota",
  "Mencari cafe, restoran, atau tempat nongkrong di suatu kota Indonesia.",
  {
    kota:      z.string().describe("Nama kota, contoh: Sintang, Pontianak, Singkawang"),
    tipe:      z.enum(["all", "cafe", "restaurant"]).default("all"),
    radius_km: z.number().default(15),
  },
  async ({ kota, tipe, radius_km }) => {
    try {
      // Cek lokal dulu
      const lokal = cariDataLokal(kota, tipe);
      if (lokal.length > 0) {
        console.error(`[tool1] ✅ Data lokal "${kota}" → ${lokal.length} tempat`);
        const tipeLabel = tipe === "cafe" ? "cafe" : tipe === "restaurant" ? "restoran" : "tempat nongkrong";
        return { content: [{ type: "text", text: formatHasil(lokal.map(formatLokal), `${tipeLabel} di ${kota}`, "lokal") }] };
      }

      // Fallback Geoapify
      console.error(`[tool1] ⚡ Fallback Geoapify "${kota}"`);
      const searchText = kota.toLowerCase().includes("indonesia") ? kota : `${kota}, Indonesia`;
      const geoRes = await axios.get(`${GEO_BASE}/v1/geocode/search`, {
        params: { text: searchText, limit: 5, filter: "countrycode:id", apiKey: getKey() },
      });
      const features = geoRes.data.features || [];
      if (!features.length) return { content: [{ type: "text", text: `Kota "${kota}" tidak ditemukan.` }] };

      const PRIORITY = ["city", "county", "district", "town"];
      let best = features[0];
      for (const f of features) {
        if (PRIORITY.some(p => (f.properties.result_type || "").includes(p))) { best = f; break; }
      }

      const [centerLng, centerLat] = best.geometry.coordinates;
      const category = TYPE_MAP[tipe] ?? "catering";
      const [r1, r2, r3] = await Promise.allSettled([
        fetchOnce(centerLng, centerLat, category, 10000, 40),
        fetchOnce(centerLng, centerLat, category, 25000, 40),
        fetchOnce(centerLng, centerLat, category, 50000, 40),
      ]);
      let places = dedupe([
        ...(r1.status === "fulfilled" ? r1.value : []),
        ...(r2.status === "fulfilled" ? r2.value : []),
        ...(r3.status === "fulfilled" ? r3.value : []),
      ]);
      if (places.length < 15) {
        const SUB = ["catering.cafe","catering.restaurant","catering.fast_food","catering.food_court","catering.bar","catering.ice_cream"];
        const subs = await Promise.allSettled(SUB.map(c => fetchOnce(centerLng, centerLat, c, 50000, 20)));
        places = dedupe([...places, ...subs.filter((b): b is PromiseFulfilledResult<any[]> => b.status === "fulfilled").flatMap(b => b.value)]);
      }

      const tipeLabel = tipe === "cafe" ? "cafe" : tipe === "restaurant" ? "restoran" : "tempat nongkrong";
      return { content: [{ type: "text", text: formatHasil(places, `${tipeLabel} di ${best.properties.city || kota}`, "geoapify") }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── TOOL 2: cari_tempat_terdekat ─────────────────────────────
server.tool(
  "cari_tempat_terdekat",
  "Mencari cafe atau restoran terdekat berdasarkan koordinat GPS user.",
  {
    lat:       z.number(),
    lng:       z.number(),
    tipe:      z.enum(["all", "cafe", "restaurant"]).default("all"),
    radius_km: z.number().default(5),
  },
  async ({ lat, lng, tipe, radius_km }) => {
    try {
      // Cek lokal dulu — filter by jarak < 50km
      const jarak = (p: any) => Math.sqrt(
        Math.pow((p.lat - lat) * 111, 2) +
        Math.pow((p.lng - lng) * 111 * Math.cos((lat * Math.PI) / 180), 2)
      );
      const lokal = localPlaces
        .filter(p => (tipe === "all" || p.tipe === tipe) && p.lat && p.lng && jarak(p) <= 50)
        .sort((a, b) => jarak(a) - jarak(b));

      if (lokal.length > 0) {
        console.error(`[tool2] ✅ Data lokal terdekat → ${lokal.length} tempat`);
        const tipeLabel = tipe === "cafe" ? "cafe" : tipe === "restaurant" ? "restoran" : "tempat nongkrong";
        return { content: [{ type: "text", text: formatHasil(lokal.map(formatLokal), `${tipeLabel} terdekat`, "lokal") }] };
      }

      // Fallback Geoapify
      console.error(`[tool2] ⚡ Fallback Geoapify koordinat (${lat}, ${lng})`);
      const category = TYPE_MAP[tipe] ?? "catering";
      const radiusM  = radius_km * 1000;
      let places = await fetchPlacesGeo(lng, lat, category, radiusM);
      if (places.length < 10) {
        const bigger = await fetchPlacesGeo(lng, lat, category, radiusM * 4);
        places = dedupe([...places, ...bigger]);
      }
      places.sort((a: any, b: any) => jarak(a) - jarak(b));

      const tipeLabel = tipe === "cafe" ? "cafe" : tipe === "restaurant" ? "restoran" : "tempat nongkrong";
      return { content: [{ type: "text", text: formatHasil(places, `${tipeLabel} terdekat`, "geoapify") }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

// ── TOOL 3: cari_berdasarkan_nama ────────────────────────────
server.tool(
  "cari_berdasarkan_nama",
  "Mencari tempat berdasarkan nama spesifik atau brand seperti Mixue, KFC, Starbucks, CW Cafe.",
  {
    nama: z.string().describe("Nama brand, contoh: Mixue, KFC, CW Cafe"),
    lat:  z.number().optional(),
    lng:  z.number().optional(),
  },
  async ({ nama, lat, lng }) => {
    try {
      // Cek lokal dulu
      const lokal = localPlaces.filter(p => p.name?.toLowerCase().includes(nama.toLowerCase()));
      if (lokal.length > 0) {
        console.error(`[tool3] ✅ Data lokal "${nama}" → ${lokal.length} hasil`);
        return { content: [{ type: "text", text: formatHasil(lokal.map(formatLokal), `hasil pencarian "${nama}"`, "lokal") }] };
      }

      // Fallback Geoapify
      console.error(`[tool3] ⚡ Fallback Geoapify nama "${nama}"`);
      const params: any = { name: nama, limit: 20, apiKey: getKey() };
      if (lat && lng) { params.filter = `circle:${lng},${lat},50000`; params.bias = `proximity:${lng},${lat}`; }
      const { data } = await axios.get(`${GEO_BASE}/v2/places`, { params });
      const places = (data.features || []).map(formatPlaceGeo).filter((p: any) => p !== null);
      return { content: [{ type: "text", text: formatHasil(places, `hasil pencarian "${nama}"`, "geoapify") }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const kota = [...new Set(localPlaces.map((p: any) => p.kota))].join(", ");
  console.error(`🗺️ SpotIn MCP Server aktif!`);
  console.error(`📋 Data lokal: ${localPlaces.length} tempat (${kota || "tidak ada"})`);
}

main().catch(console.error);