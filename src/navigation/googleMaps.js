export function startNavigationDeepLink(destLat, destLng, travelMode = "driving") {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}&travelmode=${encodeURIComponent(travelMode)}`;
  window.open(url, "_blank");
}
