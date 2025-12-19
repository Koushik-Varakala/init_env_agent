// src/main.js
// Robust main orchestrator: map, Google Places autocomplete with fallback, agent loop, voice, and UI logging.

import "./styles/main.css";

import { startObservingEnvironment, stopObservingEnvironment } from "./agent/observe";
import { decideRisk } from "./agent/decide";
import { generateAlertMessage, speak } from "./agent/act";
import { PROFILES } from "./config/constants";

/* =========================
   DOM elements (assumes these exist in index.html)
========================= */
const searchBox = document.getElementById("searchBox");
const startBtn = document.getElementById("startNav");
const voiceToggle = document.getElementById("voiceToggle");
const profileSelect = document.getElementById("profile");
const modeSelect = document.getElementById("mode");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("agentLog");
const alertBox = document.getElementById("alertBox");

// optional judge-facing panel to show the decision object
let decisionPanel = document.getElementById("decisionPanel");
if (!decisionPanel) {
  decisionPanel = document.createElement("div");
  decisionPanel.id = "decisionPanel";
  decisionPanel.style.fontSize = "13px";
  decisionPanel.style.marginTop = "8px";
  if (logEl && logEl.parentElement) logEl.parentElement.appendChild(decisionPanel);
}

/* =========================
   Utility helpers
========================= */
function log(msg) {
  const t = new Date().toLocaleTimeString();
  if (logEl) logEl.innerHTML = `<div>[${t}] ${msg}</div>` + logEl.innerHTML;
  console.log(`[AgentLog ${t}]`, msg);
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function showAlert(severity, text) {
  if (!alertBox) return;
  alertBox.className = "alert";
  alertBox.classList.remove("good", "warn", "danger");
  if (severity === "HIGH") alertBox.classList.add("danger");
  else if (severity === "MODERATE") alertBox.classList.add("warn");
  else alertBox.classList.add("good");
  alertBox.textContent = text;
}

function clearAlert() {
  if (!alertBox) return;
  alertBox.className = "alert hidden";
  alertBox.textContent = "";
  setStatus("Conditions normal.");
}

function speakIfEnabled(text) {
  if (!voiceToggle) return;
  if (!voiceToggle.checked) return;
  speak(text);
}

function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* =========================
   Map init (Leaflet via CDN must be present in index.html)
========================= */
const defaultCenter = [17.385, 78.4867];
const map = L.map("map", { preferCanvas: true }).setView(defaultCenter, 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// force size recalculation after Vite render/layout
setTimeout(() => map.invalidateSize(), 200);

/* =========================
   Destination handling
========================= */
let destination = null;
let destMarker = null;

function setDestination(lat, lng, label = "Destination") {
  destination = { lat, lng };
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([lat, lng]).addTo(map).bindPopup(label).openPopup();
  map.setView([lat, lng], 14);
  setStatus(`Destination set: ${label}`);
  log(`Destination selected → ${label} (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
}

/* allow clicking map to set destination */
map.on("click", (e) => {
  setDestination(e.latlng.lat, e.latlng.lng, "Pinned location");
});

/* =========================
   Google Places Autocomplete - robust init
   - Waits for google.maps.places to be available
   - If available, sets up Autocomplete, biases to map bounds
   - If not available in timeout, falls back to Nominatim suggestion mode
========================= */

let autocomplete = null;
let autocompleteInitialized = false;

// Poll for google.maps.places; returns promise that resolves true if ready
function waitForGooglePlaces(timeoutMs = 4000, pollInterval = 200) {
  const start = Date.now();
  return new Promise((resolve) => {
    const ticker = setInterval(() => {
      if (window.google && google.maps && google.maps.places) {
        clearInterval(ticker);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(ticker);
        resolve(false);
      }
    }, pollInterval);
  });
}

// Initialize Google Places autocomplete (only once)
function initGooglePlaces() {
  if (autocompleteInitialized) return;
  try {
    autocomplete = new google.maps.places.Autocomplete(searchBox, {
      types: ["establishment", "geocode"],
      fields: ["geometry", "name", "formatted_address", "place_id"],
      // You can add componentRestrictions here if needed e.g. { country: "in" }
    });

    // Bias to current map viewport for more relevant suggestions
    const updateBounds = () => {
      try {
        const b = map.getBounds();
        const ne = b.getNorthEast();
        const sw = b.getSouthWest();
        const googleBounds = new google.maps.LatLngBounds(
          new google.maps.LatLng(sw.lat, sw.lng),
          new google.maps.LatLng(ne.lat, ne.lng)
        );
        autocomplete.setBounds(googleBounds);
      } catch (e) {
        // ignore
      }
    };

    map.on("moveend", updateBounds);
    updateBounds();

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place || !place.geometry || !place.geometry.location) {
        log("Autocomplete: no geometry for place");
        return;
      }
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const label = place.name || place.formatted_address || "Selected place";
      setDestination(lat, lng, label);
    });

    autocompleteInitialized = true;
    log("Google Places Autocomplete initialized");
    setStatus("Search ready (Google Places)");
  } catch (err) {
    console.error("initGooglePlaces error", err);
    autocompleteInitialized = false;
  }
}

/* =========================
   Nominatim fallback (datalist) if Google Places not available
   - Debounced suggestions as user types
========================= */

let datalistEl = null;
function ensureDatalist() {
  if (datalistEl) return datalistEl;
  datalistEl = document.createElement("datalist");
  datalistEl.id = "nominatim-suggestions";
  document.body.appendChild(datalistEl);
  searchBox.setAttribute("list", datalistEl.id);
  return datalistEl;
}

async function nominatimSuggest(query, limit = 6) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=0`;
    const r = await fetch(url, { headers: { "Accept-Language": "en" } });
    const j = await r.json();
    return j; // array of places
  } catch (e) {
    console.warn("nominatimSuggest failed", e);
    return [];
  }
}

const onInputSuggest = debounce(async (ev) => {
  const q = ev.target.value.trim();
  if (!q || q.length < 2) {
    if (datalistEl) datalistEl.innerHTML = "";
    return;
  }
  const results = await nominatimSuggest(q, 6);
  const dl = ensureDatalist();
  dl.innerHTML = "";
  for (const r of results) {
    const opt = document.createElement("option");
    opt.value = r.display_name;
    // store lat/lon on dataset in case user picks value
    opt.dataset.lat = r.lat;
    opt.dataset.lon = r.lon;
    dl.appendChild(opt);
  }
}, 300);

// When user picks a datalist choice, set destination by matching display_name
async function onDatalistPick(ev) {
  const v = ev.target.value.trim();
  if (!v) return;
  // Find option matching value
  const items = datalistEl ? Array.from(datalistEl.children) : [];
  const match = items.find((o) => o.value === v);
  if (match && match.dataset.lat && match.dataset.lon) {
    setDestination(parseFloat(match.dataset.lat), parseFloat(match.dataset.lon), v);
    return;
  }
  // Fallback: call nominatim to get first match
  const res = await nominatimSuggest(v, 1);
  if (res && res.length) {
    setDestination(parseFloat(res[0].lat), parseFloat(res[0].lon), res[0].display_name);
  }
}

/* =========================
   Initialize search (tries Google then fallback)
========================= */
async function initSearch() {
  const ok = await waitForGooglePlaces(3000, 200);
  if (ok) {
    initGooglePlaces();
    // no need to attach nominatim listeners
  } else {
    log("Google Places not available - falling back to Nominatim suggestions");
    setStatus("Search ready (fallback)");
    // wire datalist fallback
    ensureDatalist();
    searchBox.addEventListener("input", onInputSuggest);
    searchBox.addEventListener("change", onDatalistPick);
  }
}

/* =========================
   Agent Observe → Decide → Act wiring
========================= */

let lastSeverity = "LOW";
let agentRunning = false;

// handler called for each observation from startObservingEnvironment
async function onObservation(obs) {
  if (!obs) return;
  if (obs.error) {
    log(`Observation error: ${obs.error}`);
    return;
  }
  const { location, aqi, windSpeed } = obs;
  if (!location) return;

  log(`Observed at ${location.lat.toFixed(4)},${location.lng.toFixed(4)} — AQI: ${aqi ?? "n/a"}, wind: ${windSpeed ?? "n/a"}`);

  // if aqi is null (throttled), skip heavy decision
  if (aqi === null || aqi === undefined) {
    return;
  }

  const profile = (profileSelect && profileSelect.value) || PROFILES.GENERAL;
  const travelMode = (modeSelect && modeSelect.value) || "driving";

  const decision = decideRisk({ aqi, windSpeed }, { profile, travelMode });

  // update decision panel for judges
  if (decisionPanel) {
    decisionPanel.innerHTML = `<div style="margin-top:8px;"><strong>Decision</strong>
      <div>Severity: ${decision.severity}</div>
      <div>Score: ${decision.score}</div>
      <div>Reason: ${decision.reason}</div>
      <div>Action: ${decision.recommendedAction}</div>
    </div>`;
  }

  if (decision.severity !== lastSeverity) {
    lastSeverity = decision.severity;
    if (decision.severity === "LOW") {
      clearAlert();
      log("Severity returned to LOW — cleared alert");
    } else {
      const message = await generateAlertMessage(decision.severity, { aqi, windSpeed }, profile);
      showAlert(decision.severity, message);
      speakIfEnabled(message);
      log(`ALERT: ${message} (${decision.recommendedAction})`);
    }
  } else {
    log("Severity unchanged");
  }
}

/* =========================
   Start/stop logic (start navigation launches Google Maps and agent)
========================= */

startBtn.addEventListener("click", async () => {
  if (!destination) {
    alert("Please set a destination on the map or using search.");
    return;
  }

  // open Google Maps with deep link for navigation (user will get directions in Google Maps)
  const travelMode = (modeSelect && modeSelect.value) || "driving";
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=${encodeURIComponent(travelMode)}`;
  window.open(url, "_blank");
  log("Launched Google Maps navigation");

  // start agent observing environment if not running
  if (!agentRunning) {
    agentRunning = true;
    lastSeverity = "LOW";
    setStatus("Agent running alongside navigation");
    // throttleMs: minimal time between heavy API calls; minDistanceMeters reduces frequency on small moves
    startObservingEnvironment(onObservation, { throttleMs: 4000, minDistanceMeters: 6 });
    // and announce start (user click allows speech)
    speakIfEnabled("Safe navigation started. I will alert you if air quality deteriorates.");
    log("Agent started (observing environment)");
  }
});

/* Cleanup on unload */
window.addEventListener("beforeunload", () => {
  try { stopObservingEnvironment(); } catch (e) { /* ignore */ }
});

/* =========================
   Init everything
========================= */

(async function bootstrap() {
  try {
    // wire search (tries Google Places -> fallback to Nominatim)
    await initSearch();
  } catch (err) {
    console.error("Search init error", err);
    // still continue
  }
  log("App bootstrap complete");
})();
