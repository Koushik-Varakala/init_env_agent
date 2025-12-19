// src/services/weatherService.js
import { DEMO_MODE } from "../config/constants";

const W_CACHE = new Map();
const W_CACHE_TTL_MS = 90 * 1000; // 90s

function _wKey(lat, lng) {
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

export async function fetchWeather(lat, lng, { retries = 1 } = {}) {
  if (DEMO_MODE) {
    const t = Date.now();
    const wind = (Math.floor(t / 40000) % 2 === 0) ? 1.2 : 4.5;
    return { windSpeed: wind, description: wind < 2 ? "calm" : "windy" };
  }

  const key = import.meta.env.VITE_OPENWEATHER_KEY;
  if (!key) throw new Error("OpenWeather key missing (VITE_OPENWEATHER_KEY)");

  const cacheKey = _wKey(lat, lng);
  const c = W_CACHE.get(cacheKey);
  if (c && (Date.now() - c.t) < W_CACHE_TTL_MS) return c.value;

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${key}&units=metric`;

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await _fetchWithTimeout(url, {}, 7000);
      const data = await res.json();
      if (!data) throw new Error("Weather API invalid");
      const val = {
        windSpeed: data.wind?.speed ?? 0,
        description: data.weather?.[0]?.description ?? "unknown"
      };
      W_CACHE.set(cacheKey, { value: val, t: Date.now() });
      return val;
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        console.error("fetchWeather failed:", err);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
    }
  }
}
