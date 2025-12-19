// src/services/locationService.js
let _watchId = null;
let _lastPos = null;

/** Haversine distance in meters */
function _distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

/**
 * Get one-shot current position (promise).
 * options: { enableHighAccuracy, maximumAge, timeout }
 */
export function getCurrentLocation(options = { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }) {
  return new Promise((resolve, reject) => {
    if (options.simulate && options.simulatePath) {
      // simulated path: options.simulatePath is an array of {lat,lng}
      return resolve(options.simulatePath[0]);
    }
    if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      options
    );
  });
}

/**
 * startLocationWatch(onUpdate, onError, opts)
 * opts:
 *   enableHighAccuracy (bool),
 *   maximumAge,
 *   timeout,
 *   minDistanceMeters (only call onUpdate if distance > threshold),
 *   simulate: false | { path: [{lat,lng}], intervalMs }
 */
export function startLocationWatch(onUpdate, onError, opts = {}) {
  // simulation mode (for demo) — emits location events from an array
  if (opts.simulate && opts.simulate.path && opts.simulate.path.length) {
    let i = 0;
    const interval = opts.simulate.intervalMs || 4000;
    _watchId = setInterval(() => {
      const pos = opts.simulate.path[i % opts.simulate.path.length];
      i += 1;
      _lastPos = pos;
      try { onUpdate(pos); } catch (e) { /* swallow handler errors */ }
    }, interval);
    return;
  }

  if (!navigator.geolocation) {
    onError?.(new Error("Geolocation not supported"));
    return;
  }

  const { enableHighAccuracy = true, maximumAge = 5000, timeout = 10000, minDistanceMeters = 10 } = opts;

  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      if (_lastPos && minDistanceMeters) {
        const d = _distanceMeters(_lastPos, p);
        if (d < minDistanceMeters) return; // ignore small movements
      }
      _lastPos = p;
      try { onUpdate(p); } catch (e) { console.error("onUpdate handler error", e); }
    },
    (err) => {
      console.error("Geolocation watch error", err);
      onError?.(err);
    },
    { enableHighAccuracy, maximumAge, timeout }
  );
}

/** Stop watching (clears both real watchId and simulated interval) */
export function stopLocationWatch() {
  if (_watchId === null) return;
  if (typeof _watchId === "number") {
    // simulated interval uses numeric id from setInterval (in browsers)
    clearInterval(_watchId);
  } else {
    navigator.geolocation.clearWatch(_watchId);
  }
  _watchId = null;
  _lastPos = null;
}
