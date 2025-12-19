// src/agent/act.js
/**
 * Act utilities: generateAlertMessage (Gemini optional) and speak()
 *
 * NOTE: Replace the GENERATIVE API endpoint if your org uses another.
 */

function _fetchWithTimeout(url, opts = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

function _sanitizeText(s) {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

export async function generateAlertMessage(severity, context = {}, profile = "general") {
  const key = import.meta.env.VITE_GEMINI_KEY;
  // simple templated fallback
  const fallback = (() => {
    const aqi = context.aqi ?? "unknown";
    if (severity === "HIGH") return `High pollution ahead (AQI ${aqi}). Sensitive users should avoid stops.`;
    if (severity === "MODERATE") return `Moderate pollution (AQI ${aqi}). Consider reducing outdoor exposure.`;
    return `Air quality is good (AQI ${aqi}).`;
  })();

  if (!key) return fallback;

  // Build short instruction prompt
  const prompt = `You are a concise health assistant. Output ONE short sentence (8-14 words) advising a person in transit.
Severity: ${severity}
AQI: ${context.aqi ?? "unknown"}
Wind(m/s): ${context.windSpeed ?? "unknown"}
Profile: ${profile}
Output only the advisory sentence.`;

  try {
    // NOTE: update endpoint according to your Gemini API shape.
    const resp = await _fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // conservative params
          temperature: 0.1,
          candidateCount: 1,
          prompt: { text: prompt }
        })
      },
      6000
    );

    if (!resp.ok) {
      console.warn("Gemini API responded non-OK", resp.status);
      return fallback;
    }

    const data = await resp.json();
    // try the likely shapes:
    const candidates = data?.candidates ?? data?.output ?? null;
    let text = null;
    if (candidates && Array.isArray(candidates) && candidates.length) {
      // explore a few possible fields
      text =
        candidates[0]?.content?.[0]?.text
        ?? candidates[0]?.content?.parts?.[0]?.text
        ?? candidates[0]?.output?.[0]?.content?.text
        ?? candidates[0]?.text;
    } else if (data?.outputText) {
      text = data.outputText;
    }

    if (text) return _sanitizeText(text);

    return fallback;
  } catch (err) {
    console.warn("generateAlertMessage error:", err);
    return fallback;
  }
}

export function speak(text, { lang = "en-US", rate = 1.0 } = {}) {
  if (!("speechSynthesis" in window)) {
    console.warn("Speech synthesis not supported");
    return;
  }
  if (!text) return;
  // cancel previous utterances to avoid overlapping
  try {
    speechSynthesis.cancel();
  } catch (e) {/*ignore*/}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  speechSynthesis.speak(u);
}
