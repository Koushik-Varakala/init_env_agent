// src/agent/observe.js
import { startLocationWatch, stopLocationWatch } from "../services/locationService";
import { fetchAQI } from "../services/aqiService";
import { fetchWeather } from "../services/weatherService";

/**
 * startObservingEnvironment(onObservation, opts)
 * opts:
 *  - throttleMs: minimum time between heavy fetches (default 5000)
 *  - minDistanceMeters: forwarded to locationService
 */
let _observing = false;
let _lastFetch = 0;
let _latestLocation = null;
let _onObservation = null;

export function startObservingEnvironment(onObservation, opts = {}) {
  if (_observing) return;
  _observing = true;
  _onObservation = onObservation;

  const { throttleMs = 5000, minDistanceMeters = 10, simulate } = opts;

  startLocationWatch(async (loc) => {
    _latestLocation = loc;
    const now = Date.now();
    if (now - _lastFetch < throttleMs) {
      // quick update - provide location-only observation (if desired)
      // but we skip heavy API calls
      try { onObservation({ location: loc, aqi: null, windSpeed: null, meta: { skipped: true } }); } catch (e) { console.error(e); }
      return;
    }
    _lastFetch = now;
    try {
      const [aqi, weather] = await Promise.all([
        fetchAQI(loc.lat, loc.lng),
        fetchWeather(loc.lat, loc.lng)
      ]);
      const obs = { location: loc, aqi, windSpeed: weather.windSpeed, weatherDesc: weather.description };
      try { onObservation(obs); } catch (e) { console.error("onObservation error", e); }
    } catch (err) {
      console.warn("Observation fetch error", err);
      try { onObservation({ location: loc, aqi: null, windSpeed: null, error: err.message }); } catch (e) { console.error(e); }
    }
  }, (err) => {
    console.error("startObservingEnvironment location error", err);
    _onObservation?.({ location: null, error: err.message });
  }, { minDistanceMeters, simulate });
}

export function stopObservingEnvironment() {
  if (!_observing) return;
  stopLocationWatch();
  _observing = false;
  _lastFetch = 0;
  _latestLocation = null;
  _onObservation = null;
}
