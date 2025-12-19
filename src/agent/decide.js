// src/agent/decide.js
import { AQI_THRESHOLDS, WIND_THRESHOLDS, PROFILES } from "../config/constants";

/**
 * decideRisk(input, options)
 * input: { aqi, windSpeed }
 * options: { profile: 'general'|'asthma'|'elderly', travelMode: 'driving'|'walking'|'cycling' }
 *
 * returns: { severity: 'LOW'|'MODERATE'|'HIGH', score: 0..100, reason, recommendedAction }
 */
export function decideRisk(input = {}, options = {}) {
  const { aqi = null, windSpeed = null } = input;
  const { profile = PROFILES.GENERAL, travelMode = "driving" } = options;

  if (aqi === null || aqi === undefined) {
    return { severity: "UNKNOWN", score: 0, reason: "No AQI data", recommendedAction: "No action" };
  }

  // baseline score based on AQI (map to 0-100)
  const maxAqi = Math.max(aqi, AQI_THRESHOLDS.UNHEALTHY);
  const score = Math.min(100, Math.round((aqi / Math.max(1, AQI_THRESHOLDS.UNHEALTHY)) * 100));

  let severity = "LOW";
  let reason = `AQI ${aqi}`;
  let recommendedAction = "No action";

  if (aqi > AQI_THRESHOLDS.UNHEALTHY) {
    severity = "HIGH";
    reason = `AQI ${aqi} > ${AQI_THRESHOLDS.UNHEALTHY}`;
    recommendedAction = "Avoid outdoor exposure; consider postponing travel.";
  } else if (aqi > AQI_THRESHOLDS.MODERATE) {
    severity = "MODERATE";
    reason = `AQI ${aqi} above moderate`;
    recommendedAction = "Limit outdoor exposure if possible.";
  }

  // wind adjustment: low wind increases risk exposure for particulate matter
  if (windSpeed !== null && windSpeed < WIND_THRESHOLDS.LOW) {
    // nudges severity one level up if near threshold
    if (severity === "LOW" && aqi > AQI_THRESHOLDS.GOOD) {
      severity = "MODERATE";
      reason += `; low wind ${windSpeed} m/s`;
      recommendedAction = "Low wind can trap pollutants; be cautious outdoors.";
    } else if (severity === "MODERATE") {
      reason += `; low wind ${windSpeed} m/s`;
    }
  }

  // profile adjustments (be conservative)
  if (profile === PROFILES.ASTHMA) {
    if (severity === "MODERATE") {
      severity = "HIGH";
      recommendedAction = "Asthma profile: avoid outdoor travel if possible.";
      reason += "; asthma profile";
    }
  } else if (profile === PROFILES.ELDERLY) {
    if (severity === "LOW" && aqi > (AQI_THRESHOLDS.MODERATE - 10)) {
      severity = "MODERATE";
      recommendedAction = "Elderly: reduce exposure when possible.";
      reason += "; elderly profile";
    }
  }

  return { severity, score, reason, recommendedAction };
}
