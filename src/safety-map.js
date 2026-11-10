import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY;
const mapTilerAttribution = '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
const TILE_LAYERS = {
  street: {
    url: mapTilerKey
      ? `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${encodeURIComponent(mapTilerKey)}`
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: mapTilerKey ? mapTilerAttribution : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  },
  dark: {
    url: mapTilerKey
      ? `https://api.maptiler.com/maps/streets-v4-dark/256/{z}/{x}/{y}.png?key=${encodeURIComponent(mapTilerKey)}`
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      maxZoom: 20,
      attribution: mapTilerKey ? mapTilerAttribution : '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
};

const LOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };

let map;
let tileLayer;
let userMarker;
let accuracyCircle;
let destinationMarker;
let routeLayer;
let trustedLocationLayer;
let locationWatchId = null;
let currentLocation = null;
let currentDestination = null;
let currentRoute = null;
let currentLayer = 'dark';
let nextPlaceSearchTime = 0;
let placeSearchQueue = Promise.resolve();
const placeSearchCache = new Map();
let locationCallback = () => {};
let statusCallback = () => {};

function coordinatesFromPosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Your device returned invalid GPS coordinates.');
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}

function userIcon() {
  return L.divIcon({
    className: 'safety-user-marker',
    html: '<span></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function destinationIcon() {
  return L.divIcon({
    className: 'safety-destination-marker',
    html: '<span>⌖</span>',
    iconSize: [32, 38],
    iconAnchor: [16, 34],
  });
}

function setLocation(position, shouldCenter = false) {
  currentLocation = coordinatesFromPosition(position);
  if (map) {
    const latLng = [currentLocation.latitude, currentLocation.longitude];
    if (!userMarker) userMarker = L.marker(latLng, { icon: userIcon(), title: 'Your current location' }).addTo(map);
    else userMarker.setLatLng(latLng);
    userMarker.bindTooltip('Your device location', { direction: 'top', offset: [0, -12] });

    if (currentLocation.accuracy !== null) {
      if (!accuracyCircle) accuracyCircle = L.circle(latLng, {
        radius: currentLocation.accuracy,
        className: 'safety-accuracy-circle',
        weight: 1,
      }).addTo(map);
      else accuracyCircle.setLatLng(latLng).setRadius(currentLocation.accuracy);
    }

    if (shouldCenter) map.setView(latLng, Math.max(map.getZoom(), 15));
  }
  locationCallback({ ...currentLocation, tracking: locationWatchId !== null });
  return currentLocation;
}

function reportGeolocationError(error) {
  const descriptions = {
    1: 'Location permission was denied. Allow location access in your browser settings to try again.',
    2: 'Your device could not determine a location. Check GPS and network availability, then retry.',
    3: 'The location request timed out. Try again where your device has a clearer GPS signal.',
  };
  const message = descriptions[error?.code] || 'Unable to access your device location.';
  statusCallback({ kind: 'error', message, code: error?.code ?? null });
}

export function mountSafetyMap(element, callbacks = {}) {
  if (!element) throw new Error('The safety map element was not found.');
  unmountSafetyMap();
  locationCallback = callbacks.onLocation ?? (() => {});
  statusCallback = callbacks.onStatus ?? (() => {});
  currentLayer = callbacks.layer === 'street' ? 'street' : 'dark';

  map = L.map(element, { zoomControl: false, preferCanvas: true }).setView(
    currentLocation ? [currentLocation.latitude, currentLocation.longitude] : [0, 0],
    currentLocation ? 15 : 2,
  );
  L.control.zoom({ position: 'topright' }).addTo(map);
  tileLayer = L.tileLayer(TILE_LAYERS[currentLayer].url, TILE_LAYERS[currentLayer].options).addTo(map);

  if (currentLocation) setLocation({
    coords: {
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      accuracy: currentLocation.accuracy,
    },
    timestamp: Date.parse(currentLocation.capturedAt),
  });
  if (currentDestination) showDestination(currentDestination);
  if (currentRoute) drawRoute(currentRoute.geometry);
  requestAnimationFrame(() => map?.invalidateSize());
}

export function unmountSafetyMap() {
  if (map) {
    map.remove();
    map = null;
  }
  tileLayer = null;
  userMarker = null;
  accuracyCircle = null;
  destinationMarker = null;
  routeLayer = null;
  trustedLocationLayer = null;
}

export function getCurrentLocation() {
  return currentLocation ? { ...currentLocation } : null;
}

export function isTrackingLocation() {
  return locationWatchId !== null;
}

export function clearMapSession() {
  stopLocationTracking();
  currentLocation = null;
  currentDestination = null;
  currentRoute = null;
  userMarker?.remove();
  accuracyCircle?.remove();
  destinationMarker?.remove();
  routeLayer?.remove();
  userMarker = null;
  accuracyCircle = null;
  destinationMarker = null;
  routeLayer = null;
}

export function clearPlannedRoute() {
  currentDestination = null;
  currentRoute = null;
  destinationMarker?.remove();
  routeLayer?.remove();
  destinationMarker = null;
  routeLayer = null;
}

export function requestCurrentLocation() {
  if (!navigator.geolocation) {
    const error = new Error('This browser does not support device geolocation.');
    statusCallback({ kind: 'error', message: error.message, code: null });
    return Promise.reject(error);
  }
  statusCallback({ kind: 'locating', message: 'Waiting for your device location permission…' });
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(setLocation(position, true));
          statusCallback({ kind: 'ready', message: 'Current device location acquired.' });
        } catch (error) {
          statusCallback({ kind: 'error', message: error.message, code: null });
          reject(error);
        }
      },
      (error) => {
        reportGeolocationError(error);
        reject(new Error(error?.message || 'Unable to access your device location.'));
      },
      LOCATION_OPTIONS,
    );
  });
}

export function startLocationTracking() {
  if (!navigator.geolocation) {
    const error = new Error('This browser does not support device geolocation.');
    statusCallback({ kind: 'error', message: error.message, code: null });
    return Promise.reject(error);
  }
  if (locationWatchId !== null) return Promise.resolve(getCurrentLocation());

  statusCallback({ kind: 'locating', message: 'Requesting permission to follow your device location…' });
  return new Promise((resolve, reject) => {
    let firstPosition = true;
    let watchId;
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        try {
          const location = setLocation(position, firstPosition);
          if (firstPosition) {
            firstPosition = false;
            resolve(location);
          }
          statusCallback({ kind: 'tracking', message: 'Live GPS updates are active on this device.' });
        } catch (error) {
          stopLocationTracking();
          statusCallback({ kind: 'error', message: error.message, code: null });
          if (firstPosition) reject(error);
        }
      },
      (error) => {
        reportGeolocationError(error);
        if (firstPosition) {
          navigator.geolocation.clearWatch(watchId);
          locationWatchId = null;
          reject(new Error(error?.message || 'Unable to access your device location.'));
        } else {
          stopLocationTracking();
        }
      },
      LOCATION_OPTIONS,
    );
    watchId = locationWatchId = watchId;
  });
}

export function stopLocationTracking() {
  if (locationWatchId !== null) navigator.geolocation?.clearWatch(locationWatchId);
  locationWatchId = null;
  statusCallback({ kind: currentLocation ? 'ready' : 'stopped', message: 'Live GPS tracking stopped.' });
}

function showDestination(destination) {
  if (!map) return;
  const latLng = [destination.latitude, destination.longitude];
  if (!destinationMarker) destinationMarker = L.marker(latLng, { icon: destinationIcon(), title: destination.label }).addTo(map);
  else destinationMarker.setLatLng(latLng);
  destinationMarker.bindTooltip(destination.label, { direction: 'top', offset: [0, -25] });
}

function drawRoute(geometry) {
  if (!map || !geometry?.coordinates?.length) return;
  if (routeLayer) routeLayer.remove();
  routeLayer = L.geoJSON(geometry, {
    style: { color: '#38bdf8', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' },
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
}

export async function searchPlaces(query) {
  const normalizedQuery = String(query ?? '').trim();
  if (normalizedQuery.length < 3) throw new Error('Enter at least 3 characters to search for a place.');
  const cachedResults = placeSearchCache.get(normalizedQuery.toLocaleLowerCase());
  if (cachedResults) return cachedResults.map((item) => ({ ...item }));

  let releaseQueue;
  const queued = new Promise((resolve) => { releaseQueue = resolve; });
  const previous = placeSearchQueue;
  placeSearchQueue = queued;
  await previous;
  const delay = Math.max(0, nextPlaceSearchTime - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  nextPlaceSearchTime = Date.now() + 1000;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: normalizedQuery, format: 'jsonv2', limit: '5' }).toString();
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Place search failed (HTTP ${response.status}). Try again later.`);
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error('The place search returned an invalid response.');
    const places = results.map((item) => ({
      latitude: Number(item.lat),
      longitude: Number(item.lon),
      label: String(item.display_name ?? '').trim().slice(0, 300),
    })).filter((item) =>
      Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
      item.latitude >= -90 && item.latitude <= 90 &&
      item.longitude >= -180 && item.longitude <= 180 && item.label,
    );
    if (placeSearchCache.size >= 50) placeSearchCache.delete(placeSearchCache.keys().next().value);
    placeSearchCache.set(normalizedQuery.toLocaleLowerCase(), places);
    return places.map((item) => ({ ...item }));
  } finally {
    releaseQueue();
  }
}

export async function calculateRoute(destination) {
  if (!currentLocation) throw new Error('Get your current device location before calculating a route.');
  if (!destination || !Number.isFinite(destination.latitude) || destination.latitude < -90 || destination.latitude > 90 ||
      !Number.isFinite(destination.longitude) || destination.longitude < -180 || destination.longitude > 180 ||
      !String(destination.label ?? '').trim()) {
    throw new Error('Select a valid destination before calculating a route.');
  }

  const configuredBase = import.meta.env.VITE_OSRM_BASE_URL || 'https://router.project-osrm.org';
  const base = configuredBase.replace(/\/+$/, '');
  const coordinates = `${currentLocation.longitude},${currentLocation.latitude};${destination.longitude},${destination.latitude}`;
  const response = await fetch(`${base}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
  if (!response.ok) throw new Error(`Route service failed (HTTP ${response.status}). Try another destination.`);
  const data = await response.json();
  const route = data?.routes?.[0];
  if (data?.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
    throw new Error('No drivable route was found for this destination.');
  }
  if (!Number.isFinite(route.distance) || route.distance <= 0 ||
      !Number.isFinite(route.duration) || route.duration <= 0) {
    throw new Error('The routing service returned invalid distance or duration data.');
  }

  currentDestination = destination;
  currentRoute = {
    geometry: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
  showDestination(destination);
  drawRoute(route.geometry);
  return { ...currentRoute, destination: { ...destination } };
}

export function setMapLayer(name) {
  if (!TILE_LAYERS[name]) throw new Error('The requested map layer is unavailable.');
  currentLayer = name;
  if (map) {
    if (tileLayer) tileLayer.remove();
    tileLayer = L.tileLayer(TILE_LAYERS[name].url, TILE_LAYERS[name].options).addTo(map);
  }
  return currentLayer;
}

export function getMapLayer() {
  return currentLayer;
}

export function recenterMapOnCurrentLocation() {
  if (!map) throw new Error('The interactive map is not available.');
  if (!currentLocation) throw new Error('Show your device location first.');
  map.setView([currentLocation.latitude, currentLocation.longitude], Math.max(map.getZoom(), 15), { animate: true });
}

export function setSharedContactLocations(locations) {
  if (!map) return;
  if (!trustedLocationLayer) trustedLocationLayer = L.layerGroup().addTo(map);
  trustedLocationLayer.clearLayers();
  for (const contact of locations) {
    if (!Number.isFinite(contact.latitude) || contact.latitude < -90 || contact.latitude > 90 ||
        !Number.isFinite(contact.longitude) || contact.longitude < -180 || contact.longitude > 180) continue;
    const marker = L.circleMarker([contact.latitude, contact.longitude], {
      radius: 8,
      color: '#dbeafe',
      weight: 2,
      fillColor: '#6366f1',
      fillOpacity: 0.95,
      title: 'Authorized trusted contact',
    });
    const popup = document.createElement('span');
    popup.textContent = `${contact.name} · last updated ${contact.capturedAt ? new Date(contact.capturedAt).toLocaleString() : 'unknown'}`;
    marker.bindPopup(popup).addTo(trustedLocationLayer);
  }
}
