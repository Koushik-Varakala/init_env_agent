// src/services/aqiService.js
import { DEMO_MODE } from "../config/constants";

const CACHE = new Map();
const CACHE_TTL_MS = 120 * 1000; // 2 minutes

function _cacheKey(lat, lng) {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

async function _fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export async function fetchAQI(lat, lng, { retries = 2 } = {}) {
  if (DEMO_MODE) {
    // deterministic demo switching values
    const t = Date.now();
    return (Math.floor(t / 30000) % 2 === 0) ? 180 : 70;
  }

  const key = _cacheKey(lat, lng);
  const cached = CACHE.get(key);
  if (cached && (Date.now() - cached.t) < CACHE_TTL_MS) {
    return cached.value;
  }

  const token = import.meta.env.VITE_WAQI_TOKEN;
  if (!token) throw new Error("WAQI token missing (VITE_WAQI_TOKEN)");

  const url = `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${token}`;

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await _fetchWithTimeout(url, {}, 8000);
      const data = await res.json();
      if (!data || data.status !== "ok" || !data.data) {
        throw new Error("WAQI response invalid");
      }
      const aqi = Number(data.data.aqi);
      CACHE.set(key, { value: aqi, t: Date.now() });
      return aqi;
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        console.error("fetchAQI failed:", err);
        throw err;
      }
      // backoff
      const wait = 300 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
