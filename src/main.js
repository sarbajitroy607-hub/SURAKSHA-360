import './style.css';
import './footer.css';
import { renderFooter, renderLegalPage } from './footer.js';
import {
  calculateRoute,
  clearMapSession,
  clearPlannedRoute,
  getCurrentLocation,
  getMapLayer,
  isTrackingLocation,
  mountSafetyMap,
  recenterMapOnCurrentLocation,
  requestCurrentLocation,
  searchPlaces,
  setMapLayer,
  setSharedContactLocations,
  startLocationTracking,
  stopLocationTracking,
  unmountSafetyMap,
} from './safety-map.js';
const backendConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
let backendApi;
let unsubscribeMapLocations;
let unsubscribeSosAlerts;
let sosRealtimeUserId;
let locationCleanupUserId;
let mapDataRequest = 0;
let mapLocationUploadPending = false;

const icons = {
  dashboard: '◫', map: '⌖', sos: '✳', contacts: '♧', journey: '⌁',
  notifications: '♧', offline: '◉', settings: '⚙', shield: '◇',
  battery: '▣', signal: '▥', route: '⌁', check: '✓', plus: '+',
  close: '×', pin: '●', share: '↗', bell: '♧', lock: '▣',
};

const legacyContactNames = new Set(['Aarav Sharma', 'Priya Mehta', 'Neha Kapoor']);
const legacyNotificationTitles = new Set([
  'Sample check-in',
  'Sample journey',
  'Safety interface preview',
  'SOS alert simulated',
]);

const readStored = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Unable to read ${key} from local storage`, error);
    return fallback;
  }
};

const state = {
  user: null,
  authenticated: false,
  screen: 'landing',
  demoMode: false,
  authError: '',
  authMode: 'signin',
  legalPage: null,
  landingTab: 'journey',
  workflowStep: 1,
  landingLayers: { zones: true, contacts: true, route: true },
  landingMapTracking: false,
  page: 'dashboard',
  contacts: readStored('suraksha-contacts', []),
  preferences: readStored('suraksha-preferences', {
    shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true,
  }),
  notifications: readStored('suraksha-notifications', []),
  map: {
    location: null,
    gpsStatus: 'idle',
    gpsMessage: 'Location is off until you request it.',
    destination: null,
    places: [],
    route: null,
    layer: 'dark',
    trustedContacts: [],
    contactsLoaded: false,
    contactsError: '',
    liveLocationStatus: 'disconnected',
    sosRealtimeStatus: 'not connected',
    selectedContactIds: [],
    activeShares: [],
    isSharing: false,
    receivedLocations: [],
    journeyId: null,
    lastLocationUpload: 0,
    locationChannel: null,
    sosAlerts: [],
    incomingSos: [],
    incomingAlert: null,
  },
};

const navItems = [
  ['dashboard', 'Overview'], ['map', 'Live map'], ['sos', 'Emergency SOS'],
  ['contacts', 'Trusted contacts'], ['journey', 'Journey guardian'],
  ['notifications', 'Notifications'], ['offline', 'Offline mode'], ['settings', 'Privacy & settings'],
];

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key} to local storage`, error);
    toast('Could not save your changes on this device.');
  }
  if (backendConfigured && state.authenticated) {
    backendApi.saveUserData({
      contacts: state.contacts, preferences: state.preferences,
      notifications: state.notifications,
    }).catch((error) => {
      console.error('Unable to sync safety data with Supabase', error);
      toast('Saved on this device; cloud sync failed. Check your connection.');
    });
  }
}

function removeLegacyPreviewData({ persistChanges = true } = {}) {
  const contactsChanged = state.contacts.some((contact) =>
    legacyContactNames.has(contact.name) && contact.relation?.startsWith('Sample contact') && contact.phone === 'Sample only',
  );
  const notificationsChanged = state.notifications.some((item) => legacyNotificationTitles.has(item.title));
  const contacts = state.contacts.filter((contact) =>
    !(legacyContactNames.has(contact.name) && contact.relation?.startsWith('Sample contact') && contact.phone === 'Sample only'),
  );
  const notifications = state.notifications.filter((item) => !legacyNotificationTitles.has(item.title));
  if (contacts.length !== state.contacts.length) {
    state.contacts = contacts;
    if (persistChanges) persist('suraksha-contacts', contacts);
  }
  if (notifications.length !== state.notifications.length) {
    state.notifications = notifications;
    if (persistChanges) persist('suraksha-notifications', notifications);
  }
  return contactsChanged || notificationsChanged;
}

removeLegacyPreviewData();
try {
  localStorage.removeItem('suraksha-offline');
} catch (error) {
  console.error('Unable to remove the obsolete offline preview setting', error);
}

function toast(message) {
  const region = document.querySelector('#toast-region');
  if (!region) return;
  region.textContent = message;
  region.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => region.classList.remove('visible'), 2800);
}

function navButton([key, label]) {
  return `<button class="nav-link ${state.page === key ? 'active' : ''}" data-page="${key}">
    <span class="nav-icon">${icons[key]}</span><span>${label}</span>
    ${key === 'notifications' && state.notifications.some((item) => item.unread) ? '<i class="nav-dot"></i>' : ''}
  </button>`;
}

function shell(content) {
  const unread = state.notifications.filter((item) => item.unread).length;
  const displayName = state.user?.user_metadata?.full_name || state.user?.user_metadata?.name || state.user?.firstName || state.user?.email?.split('@')[0] || 'Personal account';
  return `<aside class="sidebar">
    <a class="brand" href="#" data-page="dashboard" aria-label="Suraksha 360 home">
      <img class="brand-mark-image" src="/suraksha-360-mark.webp" alt="" />
      <span class="brand-copy"><b>SURAKSHA 360</b><small>PERSONAL SAFETY GRID</small></span>
    </a>
    <div class="sidebar-caption">YOUR SPACE</div>
    <nav class="primary-nav">${navItems.map(navButton).join('')}</nav>
    <div class="sidebar-bottom">
      <div class="network-card"><span class="network-indicator"></span><div><b>Location</b><small>${state.map.location ? 'Available on this device' : 'Off until requested'}</small></div></div>
      <div class="profile"><div class="avatar avatar-user">${escapeHtml(displayName[0] || 'U')}</div><div class="profile-copy"><b>${escapeHtml(displayName)}</b><small>${escapeHtml(state.user?.primaryEmailAddress?.emailAddress || 'Personal account')}</small></div><button class="icon-button" data-action="profile-menu" aria-label="Profile options">···</button></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <button class="mobile-menu icon-button" data-action="menu" aria-label="Open menu">☰</button>
      <div class="breadcrumb"><span>Suraksha 360</span><span class="crumb-sep">/</span><b>${pageTitle()}</b></div>
      <div class="top-actions">
        <div class="secure-pill"><span class="network-indicator"></span> ${state.authenticated && !state.demoMode ? 'Private account' : 'Local preview'}</div>
        <button class="icon-button notification-button" data-page="notifications" aria-label="Notifications">♧${unread ? `<i>${unread}</i>` : ''}</button>
        <button class="top-sos" data-action="sos"><span>✳</span> Emergency SOS</button>
      </div>
    </header>
    <section class="page-content">${content}</section>
  </main>
  ${renderFooter('app')}
  <div id="toast-region" role="status" aria-live="polite"></div>
  <div id="modal-root"></div>`;
}

function pageTitle() {
  return navItems.find(([key]) => key === state.page)?.[1] || 'Overview';
}

function statusCard(icon, label, value, note, extra = '') {
  return `<article class="status-card"><div class="status-icon">${icon}</div><div class="status-copy"><span>${label}</span><b>${value}</b><small>${note}</small></div>${extra}</article>`;
}

function dashboard() {
  const liveReady = state.authenticated && !state.demoMode;
  const trustedContacts = liveReady
    ? state.map.trustedContacts.filter((contact) => contact.owner_id === state.user?.id && contact.status === 'accepted' && contact.contact_user_id).length
    : state.contacts.length;
  const journey = state.map.isSharing
    ? `<div class="journey-topline"><span class="eyebrow"><i class="live-pulse"></i> LOCATION SHARING ACTIVE</span></div>
      <h2>Your journey is being shared</h2><p class="muted">Live location is shared only with the contacts selected for this journey.</p>
      <div class="journey-actions"><button class="button button-quiet" data-page="map">View live map</button><button class="button button-danger-quiet" data-action="stop-location-sharing">Stop sharing</button></div>`
    : `<div class="empty-journey"><div class="empty-icon">⌁</div><h2>No active journey</h2><p class="muted">Plan a route on the live map. Location is shared only after you explicitly select trusted contacts and start a journey.</p><button class="button button-primary" data-page="map">Open live map <span>→</span></button></div>`;
  const recentActivity = state.notifications.length
    ? state.notifications.slice(0, 3).map((item, index) => activityRow(item.icon, item.title, item.detail, item.time, index % 2 ? 'activity-violet' : 'activity-green')).join('')
    : '<div class="empty-state"><h3>No recent activity</h3><p class="muted">Updates will appear here when available.</p></div>';

  return `<div class="welcome-row"><div><div class="eyebrow">PERSONAL SAFETY DASHBOARD</div><h1>Welcome${state.user?.firstName ? `, ${escapeHtml(state.user.firstName)}` : ''} <span>✦</span></h1><p class="muted">Your location stays off until you request it. Sharing requires an explicit action.</p></div><button class="button button-quiet date-button" data-action="refresh">⌁ <span>Refresh status</span></button></div>
    <div class="status-grid">
      ${statusCard('⌁', 'JOURNEY', state.map.isSharing ? 'Sharing active' : 'No active journey', state.map.isSharing ? 'Location is being shared' : 'No location is being shared')}
      ${statusCard('⌖', 'LOCATION', state.map.location ? 'Available' : 'Off', state.map.location ? 'Current device location acquired' : 'Request location from the live map')}
      ${statusCard('♧', 'TRUSTED CONTACTS', String(trustedContacts), liveReady ? 'Accepted contacts' : 'Saved on this device')}
    </div>
    <div class="dashboard-grid">
      <article class="card sos-card"><div class="card-heading"><div><span class="eyebrow danger-text">EMERGENCY OVERRIDE</span><h2>Need help?</h2></div><span class="alert-icon">!</span></div>
        <p class="muted">In-app alerts require sign-in and accepted trusted contacts. Emergency services are not contacted.</p>
        <button class="sos-orb" data-page="sos" aria-label="Open emergency SOS options"><span>✳</span><b>SOS</b><small>${liveReady ? 'IN-APP ONLY' : 'SIGN IN REQUIRED'}</small></button>
        <div class="sos-secure"><span>▣</span> No emergency-service dispatch</div>
      </article>
      <article class="card journey-card">${journey}</article>
    </div>
    <div class="lower-grid">
      <article class="card quick-card"><div class="section-heading"><div><h2>Quick actions</h2><p class="muted">Your safety tools, one tap away.</p></div></div>
        <button class="quick-link" data-page="contacts"><span class="quick-icon violet-icon">♧</span><span><b>Trusted contacts</b><small>Manage your saved contacts</small></span><i>›</i></button>
        <button class="quick-link" data-page="map"><span class="quick-icon blue-icon">⌖</span><span><b>Interactive map</b><small>Request GPS or plan a route</small></span><i>›</i></button>
        <button class="quick-link" data-page="settings"><span class="quick-icon pink-icon">⚙</span><span><b>Privacy controls</b><small>Review your preferences</small></span><i>›</i></button>
      </article>
      <article class="card activity-card"><div class="section-heading"><div><h2>Recent activity</h2><p class="muted">Your latest safety updates.</p></div><button class="text-button" data-page="notifications">See all <span>→</span></button></div>
        <div class="activity-list">${recentActivity}</div>
      </article>
    </div>`;
}

function activityRow(icon, title, detail, time, style) {
  return `<div class="activity-row"><span class="activity-icon ${style}">${icon}</span><div class="activity-copy"><b>${title}</b><small>${detail}</small></div><time>${time}</time></div>`;
}

function mapContactOptions(contacts) {
  if (!contacts.length) {
    return `<p class="map-message">${state.authenticated && !state.demoMode ? 'No accepted contacts yet. Invite someone in Trusted contacts and have them accept your invite.' : 'Sign in and add an accepted trusted contact to enable secure location sharing.'}</p>`;
  }
  return `<div class="journey-contact-list">${contacts.map((contact) => `<label><input type="checkbox" data-map-contact="${escapeHtml(contact.id)}" ${state.map.selectedContactIds.includes(contact.id) ? 'checked' : ''} ${state.map.isSharing ? 'disabled' : ''}/><span><b>${escapeHtml(contact.display_name)}</b><small>Accepted · ${escapeHtml(contact.contact_email)}</small></span></label>`).join('')}</div>${state.map.isSharing ? '<small class="privacy-inline">Stop the active share before changing its recipients.</small>' : ''}`;
}

function receivedLocationMarkup(locations) {
  if (!locations.length) return '<p class="map-message">No contacts are currently sharing their location with you.</p>';
  return `<div class="shared-contact-list">${locations.map((contact) => `<div><span class="avatar avatar-violet">${escapeHtml((contact.owner_label || 'C').slice(0, 1).toUpperCase())}</span><span><b>${escapeHtml(contact.owner_label || 'Trusted contact')}</b><small>Updated ${escapeHtml(new Date(contact.captured_at).toLocaleString())}${contact.accuracy == null ? '' : ` · ±${Math.round(contact.accuracy)} m`}</small></span></div>`).join('')}</div>`;
}

function sosDeliveryMarkup(alerts) {
  if (!alerts.length) return '<p class="map-message">No SOS alerts have been created.</p>';
  return alerts.map((alert) => {
    const active = alert.status === 'active' && Date.parse(alert.expires_at) > Date.now();
    const status = active ? 'ACTIVE' : alert.status === 'cancelled' ? 'CANCELLED' : 'EXPIRED';
    return `<article class="sos-delivery-row"><div><b>Alert ${escapeHtml(alert.id.slice(0, 8))}</b><small>${escapeHtml(new Date(alert.created_at).toLocaleString())} · ${status.toLowerCase()}</small></div><span class="status-badge">${status}</span><div class="sos-recipient-status">${(alert.recipients ?? []).map((recipient) => `<span>${escapeHtml(recipient.name)}: ${recipient.status === 'acknowledged' ? 'acknowledged' : recipient.status === 'cancelled' ? 'cancelled' : active ? 'pending' : 'expired'}</span>`).join('')}</div>${active ? `<button class="button button-danger-quiet" data-action="cancel-sos-alert" data-alert-id="${escapeHtml(alert.id)}">Cancel alert</button>` : ''}</article>`;
  }).join('');
}

function incomingSosMarkup(alerts) {
  if (!alerts.length) return '<p class="map-message">No unacknowledged SOS alerts from trusted contacts.</p>';
  return alerts.map((alert) => `<article class="sos-delivery-row incoming-sos-row"><div><b>Incoming SOS · Trusted contact</b><small>${escapeHtml(new Date(alert.created_at).toLocaleString())} · Acknowledgement required</small></div>${Number.isFinite(alert.latitude) && Number.isFinite(alert.longitude) ? `<a href="https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=16/${alert.latitude}/${alert.longitude}" target="_blank" rel="noopener noreferrer">Open alert location ↗</a>` : '<span class="map-message">No location attached</span>'}<button class="button button-danger-quiet" data-action="acknowledge-incoming-sos" data-alert-id="${escapeHtml(alert.id)}">Acknowledge alert</button></article>`).join('');
}

function mapPage() {
  const location = state.map.location;
  const acceptedContacts = state.map.trustedContacts.filter((contact) =>
    contact.owner_id === state.user?.id && contact.status === 'accepted' && contact.contact_user_id,
  );
  const results = state.map.places.map((place, index) => `<button class="place-result" data-place-index="${index}" type="button"><b>${escapeHtml(place.label.split(',')[0])}</b><small>${escapeHtml(place.label)}</small></button>`).join('');
  const activeShares = state.map.activeShares;
  const received = state.map.receivedLocations;
  const liveMapAvailable = state.authenticated && !state.demoMode;
  const selectedContactCount = acceptedContacts.filter((contact) => state.map.selectedContactIds.includes(contact.id)).length;
  const deliveryRows = sosDeliveryMarkup(state.map.sosAlerts);
  return `<div class="page-intro"><div><div class="eyebrow">OPENSTREETMAP · DEVICE GPS</div><h1>Interactive safety map</h1><p class="muted">GPS is requested only when you choose. Location is shared only after selecting accepted contacts and starting a journey.</p></div><span class="gps-status-pill ${state.map.gpsStatus === 'tracking' ? 'is-tracking' : ''}" id="map-gps-pill">${escapeHtml(state.map.gpsStatus === 'tracking' ? 'GPS TRACKING' : state.map.location ? 'GPS READY' : 'GPS OFF')}</span></div>
    ${state.map.isSharing ? `<div class="sharing-banner" role="status"><span><i class="live-pulse"></i> Your latest location is being shared with ${activeShares.length} trusted ${activeShares.length === 1 ? 'contact' : 'contacts'} until ${escapeHtml(activeShares[0] ? new Date(activeShares[0].expires_at).toLocaleTimeString() : 'the session expires')}.</span><button class="button button-danger-quiet" data-action="stop-location-sharing">Stop sharing now</button></div>` : ''}
    <div class="safety-map-layout"><section class="card safety-map-card"><div class="safety-map-toolbar"><div><b>Live map</b><small id="map-status-text">${escapeHtml(state.map.gpsMessage)}</small></div><div class="map-toolbar-actions"><label class="map-layer-select">Map layer <select id="map-layer-select"><option value="dark" ${state.map.layer === 'dark' ? 'selected' : ''}>Dark</option><option value="street" ${state.map.layer === 'street' ? 'selected' : ''}>Street</option></select></label><button class="button button-quiet" data-action="locate">⌖ <span>My location</span></button><button class="button button-quiet" data-action="refresh-map-data">Refresh contacts</button></div></div>
      <div id="safety-map" class="safety-map-canvas" role="application" aria-label="Interactive OpenStreetMap safety map"></div>
      <div class="map-realtime-status" id="map-realtime-status">Location updates: ${escapeHtml(state.map.liveLocationStatus)} · SOS alerts: ${escapeHtml(state.map.sosRealtimeStatus)}</div>
      <div class="safety-map-legend"><span><i class="legend-dot you"></i> Your device</span><span><i class="legend-dot contact"></i> Authorized contacts</span><span><i class="legend-route"></i> Planned route</span><span>© MapTiler · © OpenStreetMap</span></div>
    </section><aside class="safety-map-side">
      <article class="card map-control-card"><div class="map-card-heading"><span class="quick-icon blue-icon">⌖</span><div><b>Device location</b><small id="gps-accuracy">${location?.accuracy != null ? `Accuracy ±${Math.round(location.accuracy)} m` : 'Location has not been requested'}</small></div></div><p id="gps-message" class="map-message ${state.map.gpsStatus === 'error' ? 'error-message' : ''}">${escapeHtml(state.map.gpsMessage)}</p><div class="map-action-row"><button class="button button-quiet" data-action="start-gps-tracking" ${isTrackingLocation() ? 'hidden' : ''}>Start GPS tracking</button><button class="button button-danger-quiet" data-action="stop-gps-tracking" ${isTrackingLocation() ? '' : 'hidden'}>Stop tracking</button></div><small class="privacy-inline">Tracking stays on this device unless you start a journey and select trusted contacts.</small></article>
      <article class="card map-control-card"><div class="map-card-heading"><span class="quick-icon violet-icon">⌁</span><div><b>Plan a route</b><small>OSRM driving directions</small></div></div><form id="place-search-form" class="place-search-form"><label for="destination-query">Destination</label><div><input id="destination-query" name="query" type="search" minlength="3" maxlength="160" placeholder="Search a place or address" required value="${escapeHtml(state.map.destination?.label ?? '')}"/><button class="button button-primary" type="submit">Search</button></div></form><div id="place-search-error" class="map-message error-message" role="status"></div><div id="place-results" class="place-results">${results}</div><div id="selected-destination" class="selected-destination">${state.map.destination ? `<b>Selected destination</b><small>${escapeHtml(state.map.destination.label)}</small><button class="button button-quiet" data-action="calculate-map-route" ${location ? '' : 'disabled'}>Calculate route</button>` : '<span>Choose a search result to set your destination.</span>'}</div><div id="route-summary" class="route-summary">${state.map.route ? `<b>${(state.map.route.distanceMeters / 1000).toFixed(1)} km</b><span>About ${Math.max(1, Math.round(state.map.route.durationSeconds / 60))} min by car</span>` : '<span>Route distance and travel time will appear here.</span>'}</div></article>
      <article class="card map-control-card"><div class="section-heading"><div><h2>Share this journey</h2><p class="muted">Only accepted contacts can receive live updates.</p></div></div><div id="map-contact-options">${mapContactOptions(acceptedContacts)}</div><label class="share-duration">Share for <select id="share-duration" ${liveMapAvailable && !state.map.isSharing ? '' : 'disabled'}><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="120">2 hours</option></select></label><button class="button button-primary full-button" data-action="start-safety-journey" ${state.map.route && liveMapAvailable && selectedContactCount && !state.map.isSharing ? '' : 'disabled'}>${state.map.isSharing ? 'Journey already active' : liveMapAvailable ? 'Start journey & share' : 'Sign in to share a journey'}</button><small class="privacy-inline">The database keeps only your latest position. Sharing expires automatically and can be stopped here.</small></article>
      <article class="card map-control-card"><div class="section-heading"><div><h2>${liveMapAvailable ? 'Emergency SOS' : 'SOS preview'}</h2><p class="muted">${liveMapAvailable ? 'Creates an in-app alert for selected accepted contacts.' : 'Demo only. No alert or location is sent.'}</p></div></div><button class="button button-danger-quiet full-button" data-action="confirm-sos" ${liveMapAvailable && selectedContactCount ? '' : liveMapAvailable ? 'disabled' : ''}>✳ &nbsp; ${liveMapAvailable ? 'Create in-app SOS alert' : 'Preview SOS flow'}</button><small class="privacy-inline">${liveMapAvailable ? 'No SMS or emergency-service dispatch is configured. Delivery remains pending until a contact acknowledges in the app.' : 'Sign in and select accepted contacts to enable in-app alerts. Emergency services are not contacted.'}</small><div id="sos-delivery-list">${deliveryRows}</div></article>
      <article class="card map-control-card"><div class="section-heading"><div><h2>Incoming SOS alerts</h2><p class="muted">Acknowledge alerts you have reviewed.</p></div></div><div id="incoming-sos-list">${incomingSosMarkup(state.map.incomingSos)}</div></article>
      <article class="card map-control-card"><div class="section-heading"><div><h2>Shared with you</h2><p class="muted">Only active, authorized shares appear.</p></div></div><div id="received-location-list">${receivedLocationMarkup(received)}</div></article>
    </aside></div>
    <p id="map-data-error" class="map-message error-message" role="status" ${state.map.contactsError ? '' : 'hidden'}>${escapeHtml(state.map.contactsError)}</p>
    <div id="map-live-announcements" class="sr-only" aria-live="polite"></div>`;
}

function journeyPage() {
  const active = state.map.isSharing;
  return `<div class="page-intro"><div><div class="eyebrow">LIVE JOURNEY</div><h1>Journey guardian</h1><p class="muted">Plan routes and explicitly choose who can see your live location.</p></div><button class="button button-primary" data-page="map">⌖ <span>${active ? 'View active journey' : 'Plan a journey'}</span></button></div>
    <div class="journey-page-grid"><section class="card journey-detail-card">${active
    ? `<div class="journey-topline"><span class="live-pill"><i class="live-pulse"></i> LOCATION SHARING ACTIVE</span></div><h2>Your journey is active</h2><p class="muted">Your latest location is shared with the selected trusted contacts. You can stop sharing at any time.</p><div class="journey-actions"><button class="button button-primary" data-page="map">View live map</button><button class="button button-danger-quiet" data-action="stop-location-sharing">Stop sharing</button></div>`
    : `<div class="empty-journey"><div class="empty-icon">⌁</div><h2>No active journey</h2><p class="muted">No location is being shared. Use the live map to request GPS, find a destination, and start an explicitly selected share.</p><button class="button button-primary" data-page="map">Open live map</button></div>`}</section>
    <aside class="journey-sidebar"><article class="card"><div class="section-heading"><div><h2>Journey controls</h2><p class="muted">Location sharing is always visible and revocable.</p></div></div><div class="safety-list"><div><span class="quick-icon violet-icon">⌖</span><span><b>Device location</b><small>${state.map.location ? 'Location acquired on this device' : 'Off until you request it'}</small></span></div><div><span class="quick-icon blue-icon">♧</span><span><b>Trusted contacts</b><small>Only accepted accounts can receive live shares</small></span></div><div><span class="quick-icon pink-icon">✓</span><span><b>Sharing status</b><small>${active ? 'Active' : 'Not sharing'}</small></span></div></div></article></aside></div>`;
}

function contactsPage() {
  const myId = state.user?.id;
  const myRelationships = state.map.trustedContacts.filter((contact) => contact.owner_id === myId);
  const accepted = myRelationships.filter((contact) => contact.status === 'accepted');
  const pending = myRelationships.filter((contact) => contact.status === 'pending' && new Date(contact.expires_at) > new Date());
  const inbound = state.map.trustedContacts.filter((contact) => contact.contact_user_id === myId && contact.status === 'accepted');
  const trustManagement = state.authenticated && !state.demoMode
    ? `<section class="card trust-management"><div class="section-heading"><div><span class="eyebrow">AUTHENTICATED CONTACTS</span><h2>Trusted circle access</h2><p class="muted">Invite by email and share the invite code directly. Location is shared only after acceptance and explicit journey selection.</p></div></div>
      <form id="contact-invite-form" class="trust-invite-form"><label>Contact name<input name="displayName" maxlength="80" required placeholder="Name you recognize" /></label><label>Contact email<input name="email" type="email" maxlength="254" required placeholder="name@example.com" /></label><button class="button button-primary" type="submit">Generate invite</button></form>
      <div id="trusted-contact-list" class="trusted-contact-list">${accepted.map((contact) => `<article class="trusted-contact-row"><div><b>${escapeHtml(contact.display_name)}</b><small>${escapeHtml(contact.contact_email)} · Accepted</small></div><button class="button button-danger-quiet" data-action="revoke-trusted-contact" data-contact-id="${escapeHtml(contact.id)}">Revoke access</button></article>`).join('') || '<p class="map-message">No accepted contacts yet.</p>'}${pending.map((contact) => `<article class="trusted-contact-row invite-row"><div><b>${escapeHtml(contact.display_name)} · Invite pending</b><small>Expires ${escapeHtml(new Date(contact.expires_at).toLocaleString())}. Share this code with the invited person:</small><code>${escapeHtml(contact.invitation_code)}</code></div><button class="button button-quiet" data-action="copy-invite" data-invite-code="${escapeHtml(contact.invitation_code)}">Copy invite code</button></article>`).join('')}${inbound.map((contact) => `<article class="trusted-contact-row"><div><b>Accepted invitation</b><small>From ${escapeHtml(contact.contact_email)}</small></div><button class="button button-danger-quiet" data-action="revoke-trusted-contact" data-contact-id="${escapeHtml(contact.id)}">Revoke access</button></article>`).join('')}</div>
      <form id="contact-accept-form" class="trust-accept-form"><label>Accept an invitation code<input name="invitationCode" required pattern="[0-9a-fA-F-]{36}" maxlength="36" placeholder="Paste the code shared with you" /></label><button class="button button-quiet" type="submit">Accept invitation</button></form>
      <p class="privacy-inline">The app does not send email or SMS invitations. Share codes yourself with the intended person. Only an account using the invited email can accept.</p>
    </section>`
    : `<section class="card trust-management"><h2>Trusted circle access</h2><p class="muted">Sign in to invite accounts, accept contact relationships, and enable secure location sharing.</p><button class="button button-primary" data-action="get-started">Sign in to manage trusted contacts</button></section>`;
  return `<div class="page-intro"><div><div class="eyebrow">${state.authenticated && !state.demoMode ? 'ACCOUNT CONTACTS' : 'LOCAL CONTACTS'}</div><h1>Trusted contacts</h1><p class="muted">${state.authenticated && !state.demoMode ? 'Invite accounts to establish an authorized trusted-contact relationship.' : 'Contacts added here are saved only in this browser and are not connected to location sharing.'}</p></div><button class="button button-primary" data-action="add-contact">＋ <span>Add a contact</span></button></div>
    ${trustManagement}
    ${state.contacts.length ? `<div class="contact-summary"><div class="summary-icon">♧</div><div><b>Saved contacts</b><small>${state.contacts.length} ${state.contacts.length === 1 ? 'person' : 'people'} saved in this browser.</small></div></div>
    <div class="contact-grid">${state.contacts.map((person, index) => `<article class="card contact-card"><div class="contact-card-top"><div class="avatar avatar-large avatar-${person.color}">${escapeHtml(person.initials)}</div><button class="icon-button" data-action="contact-menu" data-index="${index}" aria-label="Contact options">···</button></div><h2>${escapeHtml(person.name)}</h2><p class="muted">${escapeHtml(person.relation)}</p><a class="contact-phone" href="tel:${escapeHtml(person.phone.replace(/[^\d+]/g, ''))}">☎ &nbsp;${escapeHtml(person.phone)}</a><div class="contact-card-bottom"><span>Saved locally</span><button class="text-button" data-action="contact-menu" data-index="${index}">Manage ↗</button></div></article>`).join('')}
      <button class="card add-contact-card" data-action="add-contact"><span class="add-contact-icon">＋</span><b>Add someone you trust</b><small>Save your own contact details.</small></button>
    </div>` : `<section class="card empty-state"><span>♧</span><h2>No local contacts saved</h2><p class="muted">Account contacts appear above when accepted. Add local contact details here if needed.</p><button class="button button-primary" data-action="add-contact">Add a contact</button></section>`}`;
}

function notificationsPage() {
  return `<div class="page-intro"><div><div class="eyebrow">ACTIVITY</div><h1>Notifications</h1><p class="muted">Only available updates are shown here. This app does not send SMS, calls, or push notifications.</p></div>${state.notifications.some((item) => item.unread) ? '<button class="button button-quiet" data-action="mark-read">✓ <span>Mark all as read</span></button>' : ''}</div>
    <div class="notification-filters"><button class="filter-chip selected" data-filter="all">All activity</button><button class="filter-chip" data-filter="unread">Unread <span>${state.notifications.filter((item) => item.unread).length}</span></button></div>
    <section class="card notification-list">${state.notifications.length ? state.notifications.map((item, index) => `<article class="notification-row ${item.unread ? 'unread' : ''}" data-notification="${index}"><span class="activity-icon ${index % 2 ? 'activity-violet' : 'activity-green'}">${item.icon}</span><div class="notification-copy"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.time)}</small></div>${item.unread ? '<i class="notification-unread-dot"></i>' : ''}</article>`).join('') : '<div class="empty-state"><span>✓</span><h2>No notifications</h2><p class="muted">SMS, calls, and push notifications are not configured.</p></div>'}</section>`;
}

function offlinePage() {
  return `<div class="page-intro"><div><div class="eyebrow">NOT AVAILABLE</div><h1>Offline readiness</h1><p class="muted">Bluetooth, mesh networking, and background messaging are not implemented.</p></div><span class="large-status"><i></i>INACTIVE</span></div>
    <section class="card offline-hero"><div class="offline-visual"><div class="mesh-ring ring-one"></div><div class="mesh-ring ring-two"></div><div class="mesh-core">⌁</div></div>
      <div class="offline-copy"><span class="eyebrow">CONCEPT PREVIEW</span><h2>Offline networking is unavailable</h2><p class="muted">Bluetooth, background beacons, and offline messaging are not implemented. This page does not simulate connected devices.</p><div class="offline-metrics"><span><b>Unavailable</b><small>Nearby devices</small></span><span><b>Inactive</b><small>Beacon status</small></span><span><b>Not connected</b><small>Offline network</small></span></div></div>
    </section><div class="offline-info-grid"><article class="card"><span class="quick-icon violet-icon">▣</span><h3>Security concept</h3><p class="muted">Encryption is not implemented by this interface preview.</p></article><article class="card"><span class="quick-icon blue-icon">⌁</span><h3>Network status</h3><p class="muted">No Bluetooth or offline messaging is connected.</p></article><article class="card"><span class="quick-icon pink-icon">◇</span><h3>Your controls</h3><p class="muted">Explore the local demo state without sending data.</p></article></div>`;
}

function settingsPage() {
  const options = [
    ['shareLocation', 'Location sharing preference', 'This saved preference does not start or stop GPS or an active share.', '⌖'],
    ['journeyAlerts', 'Journey alert preference', 'This saved preference does not create alerts or monitor a route.', '⌁'],
    ['discreetMode', 'Discreet mode', 'Keep safety alerts quiet and hide notification previews on your screen.', '◉'],
    ['soundAlerts', 'Sound and haptic alerts', 'Use sound and vibration for important safety check-ins.', '♧'],
  ];
  return `<div class="page-intro"><div><div class="eyebrow">YOUR SAFETY, YOUR CHOICES</div><h1>Privacy & settings</h1><p class="muted">Manage preferences saved locally or to your configured account. Location sharing is controlled from the live map.</p></div><button class="button button-quiet" data-action="reset-settings">↺ <span>Reset preferences</span></button></div>
    <div class="settings-layout"><section class="card settings-card"><div class="section-heading"><div><h2>Safety preferences</h2><p class="muted">${backendConfigured ? 'Changes sync to your private account.' : 'Changes are saved on this device.'}</p></div></div>
      ${options.map(([key, title, description, icon]) => `<div class="setting-row"><span class="setting-icon">${icon}</span><div class="setting-copy"><b>${title}</b><small>${description}</small></div><button class="switch ${state.preferences[key] ? 'on' : ''}" data-pref="${key}" role="switch" aria-checked="${state.preferences[key]}" aria-label="${title}"><i></i></button></div>`).join('')}
      <div class="setting-row"><span class="setting-icon">♧</span><div class="setting-copy"><b>Saved contact details</b><small>${state.contacts.length} saved in this browser.</small></div><button class="text-button" data-page="contacts">Manage →</button></div>
    </section><aside class="settings-aside"><article class="card privacy-card"><span class="privacy-shield">◇</span><h2>Your privacy matters</h2><p class="muted">Your location and safety data stay yours. You decide when to share and who can see it.</p><button class="text-button" data-action="privacy-info">Learn about privacy →</button></article><article class="card settings-account"><span class="eyebrow">ACCOUNT</span><h3>${escapeHtml(state.user?.user_metadata?.full_name || state.user?.user_metadata?.name || state.user?.firstName || state.user?.email?.split('@')[0] || 'Not signed in')}</h3>${state.user?.primaryEmailAddress?.emailAddress || state.user?.email ? `<p class="muted">${escapeHtml(state.user?.primaryEmailAddress?.emailAddress || state.user.email)}</p>` : ''}${state.authenticated ? '<button class="button button-quiet full-button" data-action="signout">Sign out</button>' : '<button class="button button-primary full-button" data-action="get-started">Sign in</button>'}</article></aside></div>`;
}

function sosPage() {
  const liveReady = state.authenticated && !state.demoMode;
  return `<div class="sos-page"><div class="sos-page-heading"><span class="eyebrow danger-text">IN-APP ALERTS · NO DISPATCH</span><h1>Emergency SOS</h1><p class="muted">This app does not contact emergency services. If you’re in immediate danger, contact your local emergency number directly.</p></div><article class="card sos-main-card"><div class="sos-emblem">✳</div><div class="eyebrow danger-text">${liveReady ? 'AUTHENTICATED CONTACT ALERT' : 'SIGN IN REQUIRED'}</div><h2>${liveReady ? 'Create an in-app SOS alert' : 'In-app SOS is unavailable'}</h2><p class="muted">${liveReady ? `Select accepted contacts on the map first. ${state.map.selectedContactIds.length} contact${state.map.selectedContactIds.length === 1 ? '' : 's'} currently selected. Alerts remain pending until acknowledged in the app.` : 'Sign in and connect with accepted trusted contacts to enable in-app alerts.'}</p>${liveReady ? '<button class="sos-confirm-button" data-page="map">✳ &nbsp; CHOOSE CONTACTS ON MAP</button>' : '<button class="sos-confirm-button" data-action="get-started">Sign in to continue</button>'}<div class="sos-disclaimer">No SMS, calls, or emergency-service dispatch</div></article>
      <div class="sos-help-grid"><article class="card"><span class="quick-icon violet-icon">♧</span><div><b>Trusted contacts</b><small>${liveReady ? 'Accepted accounts only' : 'Sign in to manage connections'}</small></div><button class="text-button" data-page="contacts">View →</button></article><article class="card"><span class="quick-icon blue-icon">⌖</span><div><b>Location</b><small>${state.map.location ? 'Available on this device' : 'Off until requested'}</small></div><button class="text-button" data-page="map">Open map →</button></article></div>
    </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function landingPage() {
  const tabs = [
    ['journey', '⌁', 'Live journey'], ['contacts', '♧', 'Trusted circle'],
    ['sos', '✳', 'Emergency SOS'], ['network', '◉', 'Connectivity'],
  ];
  const liveReady = state.authenticated && !state.demoMode;
  const tabContent = {
    journey: `<span class="preview-label">JOURNEY STATUS</span><h3>${state.map.isSharing ? 'Location sharing is active' : 'No active journey'}</h3><p>${state.map.isSharing ? 'Your live location is shared only with selected trusted contacts.' : 'Request your location and plan a route on the interactive map.'}</p><button class="preview-action" data-action="landing-open-map">⌖ &nbsp; Open interactive map</button>`,
    contacts: `<span class="preview-label">TRUSTED CIRCLE</span><h3>Manage your trusted contacts</h3><p>${liveReady ? 'Invite accounts and establish authorized connections in your dashboard.' : 'Sign in to invite accounts for secure location sharing.'}</p><button class="preview-action secondary-preview-action" data-action="${liveReady ? 'landing-open-contacts' : 'get-started'}">${liveReady ? '♧ &nbsp; Manage contacts' : 'Sign in to continue'}</button>`,
    sos: `<span class="preview-label">IN-APP SOS · NO DISPATCH</span><h3>Emergency alerts require setup</h3><p>In-app alerts require sign-in and accepted trusted contacts. Emergency services are not contacted.</p><button class="preview-sos-button" data-action="${liveReady ? 'landing-open-sos' : 'get-started'}">${liveReady ? '✳ &nbsp; View SOS options' : 'Sign in to continue'}</button>`,
    network: `<span class="preview-label">CONNECTION STATUS</span><h3>${navigator.onLine ? 'Browser reports online' : 'Browser reports offline'}</h3><p>This reflects browser connectivity only; it does not confirm that the safety services are reachable.</p><div class="preview-network-stats"><div><span>APP DATA</span><b>${backendConfigured ? 'Supabase configured' : 'Not configured'}</b></div><div><span>GPS</span><b>${state.map.location ? 'Location available' : 'Off'}</b></div><div><span>SHARING</span><b>${state.map.isSharing ? 'Active' : 'Off'}</b></div></div>`,
  };
  const pillars = [
    ['✳', '01', 'Emergency SOS', 'Create in-app alerts for accepted contacts. Emergency services are not contacted.'],
    ['⌖', '02', 'Location sharing', 'Request GPS and choose whether to share location during a journey.'],
    ['♧', '03', 'Trusted contacts', 'Invite accounts and manage accepted contact relationships.'],
    ['⌁', '04', 'Journey planning', 'Search a destination, calculate a route, and explicitly start sharing.'],
    ['◉', '05', 'Offline readiness', 'Offline messaging and mesh networking are not implemented.'],
    ['↗', '06', 'Your control', 'Review the settings and decide how you want the experience to work.'],
  ];
  const features = [
    ['✳', 'Emergency SOS', 'A deliberate confirmation step helps prevent accidental alerts.'],
    ['⌖', 'Location sharing', 'Choose when to share a location with people you trust.'],
    ['♧', 'Trusted circle', 'Add and manage the people you want in your safety circle.'],
    ['⌁', 'Journey planning', 'Calculate a route and explicitly start or stop location sharing.'],
    ['◉', 'Offline readiness', 'Bluetooth and offline messaging are not implemented.'],
    ['⚙', 'Privacy & controls', 'Review your privacy choices and adjust the dashboard preferences.'],
  ];
  const steps = [
    ['01', 'Quick setup', 'Choose how you want to use your safety dashboard.'],
    ['02', 'Add contacts', 'Build a trusted circle with people you know.'],
    ['03', 'Plan a route', 'Search for a destination and review the calculated route.'],
    ['04', 'Choose to share', 'Select accepted contacts and stop sharing whenever you choose.'],
  ];
  const workflow = steps[state.workflowStep - 1];
  const questions = [
    ['What is Suraksha 360?', 'A safety app with browser-based GPS, route planning, and authenticated contact/location-sharing flows. Some integrations, including offline messaging and emergency-service dispatch, are not available.'],
    ['Does the SOS button contact emergency services?', 'No. Signed-in users can create in-app alerts for selected accepted contacts. The app does not contact emergency services. In an emergency, contact your local emergency number directly.'],
    ['Does the map show my live location?', 'Yes, after you choose to request GPS and grant browser permission. On this landing page, location stays on this device and is not shared.'],
    ['Can I add trusted contacts?', 'You can save local contact details in this browser. Secure sharing requires sign-in and an accepted account invitation.'],
    ['What happens in offline mode?', 'Bluetooth, background messaging, and offline dispatch are not implemented.'],
    ['How is my account data stored?', 'Sign-in uses Supabase Auth JWTs, and row-level security keeps account data private to the signed-in user.'],
  ];

  return `<main class="reference-landing" id="top">
    <header class="reference-nav"><a class="reference-brand" href="#top" data-action="landing-home" aria-label="Suraksha 360 home"><img class="brand-wordmark" src="/suraksha-360-logo.webp" alt="Suraksha 360 — Personal Safety Grid" /></a>
      <nav aria-label="Main navigation"><a href="#top">Home</a><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#technology">Safety technology</a><a href="#interactive-map">Interactive map</a><a href="#faq">FAQ</a></nav>
      <div class="reference-nav-actions"><button class="reference-login" data-action="sign-in">Login</button><button class="reference-cta" data-action="get-started">Get started <span>→</span></button><button class="reference-menu" data-action="landing-menu" aria-label="Toggle menu">☰</button></div>
    </header>
    ${state.authError ? `<p class="landing-error reference-error" role="status">${escapeHtml(state.authError)}</p>` : ''}
    <section class="reference-hero">
      <div class="reference-hero-inner">
        <div class="hero-meta"><span>✿ &nbsp; PERSONAL SAFETY PLATFORM · PROGRESSIVE WEB APP (PWA)</span><span>RELEASE 1.0</span><span>⌖ LOCATION IS OFF BY DEFAULT</span></div>
        <div class="reference-hero-grid"><div class="reference-copy"><span class="reference-kicker">✦ &nbsp; YOUR SAFETY, YOUR WAY</span>
          <h1>Your Safety.<br><span>Your Connection.</span><br>Your Control.</h1>
          <p>Stay connected to the people you trust. Plan safer journeys, share your location when needed, and create in-app emergency alerts with Suraksha 360.</p>
          <div class="reference-actions"><button class="reference-cta large-cta" data-action="get-started">Get started <span>→</span></button><a class="reference-secondary" href="#features">⌁ &nbsp; Explore features</a><button class="reference-demo-link" data-action="scroll-preview">▷ &nbsp; Live demo</button></div>
          <div class="reference-metrics"><div><b>Private</b><small>Until you share</small></div><div><b>On-device</b><small>GPS by permission</small></div><div><b>In-app</b><small>Alerts only</small></div></div>
        </div>
        <div class="hud-card"><div class="hud-top"><span><i></i> SURAKSHA 360</span><b>PRIVATE BY DEFAULT</b></div><div class="hud-orb"><div class="hud-ring ring-a"></div><div class="hud-ring ring-b"></div><span class="hud-shield">◇</span><span class="hud-status">YOUR SAFETY CIRCLE</span></div>
          <div class="hud-contacts"><p class="muted">No location is shared until you choose trusted contacts and start a journey.</p></div>
          <div class="hud-foot"><span>⌖ &nbsp; GPS permission required</span><button data-action="scroll-map">Open live map</button></div>
        </div></div>
        <div class="reference-note">Live GPS is available on request. Emergency-service dispatch is not connected.</div>
      </div>
    </section>
    <section class="command-section" id="dashboard-preview"><div class="reference-container"><div class="section-title-row"><div><span class="reference-kicker">SAFETY DASHBOARD</span><h2>Choose what you need</h2><p>Check current browser status or open the dashboard to manage contacts, journeys, and in-app alerts.</p></div><span class="preview-chip"><i></i> No sample records</span></div>
      <div class="command-tabs" role="tablist">${tabs.map(([key, icon, label]) => `<button role="tab" aria-selected="${state.landingTab === key}" class="${state.landingTab === key ? 'selected' : ''}" data-landing-tab="${key}"><span>${icon}</span>${label}</button>`).join('')}</div>
      <div class="command-grid"><article class="command-panel">${tabContent[state.landingTab]}</article><article class="route-preview"><div class="route-preview-head"><span>⌖ &nbsp; LOCATION PRIVACY</span><span><i></i> ${state.map.location ? 'LOCATION AVAILABLE' : 'GPS OFF'}</span></div><div class="route-map"><div class="route-grid"></div><div class="hud-orb"><div class="hud-ring ring-a"></div><div class="hud-ring ring-b"></div><span class="hud-shield">◇</span><span class="hud-status">PRIVATE BY DEFAULT</span></div><p class="route-legend">Your location appears on the map only after you grant permission.</p></div><div class="route-coords"><span>LOCATION <b>${state.map.location ? 'Available' : 'Not requested'}</b></span><span>SHARING <b>${state.map.isSharing ? 'Active' : 'Off'}</b></span></div><button class="preview-action secondary-preview-action" data-action="scroll-map">Open interactive map</button></article></div>
      <div class="command-disclaimer">Location remains on this device unless you explicitly start a signed-in journey with selected accepted contacts.</div>
    </div></section>
    <section class="reference-features" id="features"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">DESIGNED AROUND YOUR PEACE OF MIND</span><h2>Six thoughtful safety tools</h2><p>A clear, connected place to explore everyday safety features.</p></div><div class="pillar-grid">${pillars.map(([icon,n,title,desc], index) => `<article class="pillar-card" data-feature-preview="${['sos','location','contacts','journey','offline','privacy'][index]}" tabindex="0"><div class="pillar-top"><span class="pillar-icon">${icon}</span><b>${n}</b></div><h3>${title}</h3><p>${desc}</p><button data-feature-preview="${['sos','location','contacts','journey','offline','privacy'][index]}">Learn more <span>→</span></button></article>`).join('')}</div></div></section>
    <section class="workflow-section" id="how-it-works"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">A SIMPLE FLOW</span><h2>How Suraksha 360 works</h2><p>Review the steps involved in planning and sharing a journey.</p></div><div class="workflow-tabs">${steps.map(([n,title]) => `<button class="${state.workflowStep === Number(n) ? 'selected' : ''}" data-workflow-step="${n}"><span>STEP ${n}</span><b>${title}</b></button>`).join('')}</div><article class="workflow-detail"><div><span class="reference-kicker">STEP ${workflow[0]}</span><h3>${workflow[1]}</h3><p>${workflow[2]}</p><button class="reference-secondary" data-action="workflow-next">Next step <span>→</span></button></div><div class="workflow-visual"><span class="workflow-mark">${workflow[0]}</span><div><b>${workflow[1]}</b><small>Location sharing remains optional and revocable.</small></div><span class="workflow-lock">◇</span></div></article></div></section>
    <section class="technology-section" id="technology"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">CLEAR ABOUT THE TECHNOLOGY</span><h2>Safety tools without the guesswork</h2><p>Know what is connected before you rely on it.</p></div><div class="technology-grid"><div class="technology-list">${features.map(([icon,title,desc]) => `<article><span>${icon}</span><div><b>${title}</b><small>${desc}</small></div></article>`).join('')}</div><aside class="transparency-card"><span class="reference-kicker">♡ &nbsp; TRANSPARENCY NOTICE</span><h3>What is and isn’t connected</h3><p>The interactive map uses your browser’s GPS only after you grant permission. On this landing page, coordinates remain on your device.</p><ul><li>Signed-in users can share location with selected accepted contacts.</li><li>SOS alerts are in-app only; no SMS, calls, or emergency-service dispatch.</li><li>Offline messaging and background tracking are not implemented.</li></ul><b class="transparency-status">SHARING IS EXPLICIT AND REVOCABLE</b></aside></div></div></section>
    <section class="reference-map-section" id="interactive-map"><div class="reference-container"><div class="section-title-row"><div><span class="reference-kicker">YOUR LOCATION, ONLY WHEN YOU ASK</span><h2>Explore the interactive safety map</h2><p>Start live location to see your device on the map. Your browser will ask permission first; location stays on this device unless you explicitly share it in a signed-in journey.</p></div><span class="preview-chip landing-gps-chip" id="landing-gps-pill"><i></i> GPS off</span></div><div class="map-demo-card"><div class="map-demo-toolbar"><label class="landing-map-layer-label" for="landing-map-layer">Map layer<select id="landing-map-layer"><option value="dark" ${state.map.layer === 'dark' ? 'selected' : ''}>Dark</option><option value="street" ${state.map.layer === 'street' ? 'selected' : ''}>Street</option></select></label><button class="reference-cta landing-location-button" data-action="landing-start-location" ${state.landingMapTracking ? 'hidden' : ''}>⌖ &nbsp; Show my live location</button><button class="reference-sos-small landing-stop-button" data-action="landing-stop-location" ${state.landingMapTracking ? '' : 'hidden'}>Stop live location</button><button class="recenter-button" data-action="landing-recenter-map">⌖ &nbsp; Recenter</button></div><div id="landing-safety-map" class="map-demo-canvas landing-map-canvas" role="application" aria-label="Interactive map showing your device location only after permission"></div><div class="landing-map-status" id="landing-map-status" role="status" aria-live="polite">${escapeHtml(state.map.gpsMessage)}</div><div class="map-demo-footer"><span>DEVICE LOCATION <b id="landing-location-summary">${state.map.location ? `${state.map.location.latitude.toFixed(5)}, ${state.map.location.longitude.toFixed(5)}` : 'Not requested'}</b></span><span>GPS ACCURACY <b id="landing-location-accuracy">${state.map.location?.accuracy == null ? 'Not available' : `±${Math.round(state.map.location.accuracy)} m`}</b></span><span>SHARING <b>Off · stays on this device</b></span><span class="landing-map-attribution">Map data © OpenStreetMap contributors</span></div></div></div></section>
    <section class="privacy-section" id="privacy-controls"><div class="reference-container privacy-grid"><div><span class="reference-kicker">YOUR PRIVACY, YOUR CHOICE</span><h2>Control what you share.</h2><p>The landing map requests GPS only when you choose “Show my live location.” It never starts sharing with contacts.</p><div class="privacy-checks"><span>◇ &nbsp; GPS requires your permission</span><span>◇ &nbsp; Location stays on this device</span><span>◇ &nbsp; Sharing is a separate, explicit action</span></div></div><article class="privacy-action-card"><span class="privacy-card-icon">▣</span><div><b>Preview privacy controls</b><small>Open the dashboard settings to explore sharing preferences.</small></div><button data-action="open-settings">Review settings <span>→</span></button></article></div></section>
    <section class="offline-section"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">CURRENT AVAILABILITY</span><h2>Offline messaging is not available</h2><p>Bluetooth beacons, background messaging, and offline dispatch are not implemented.</p></div><article class="offline-demo-card"><div class="offline-demo-icon">⌁</div><div class="offline-demo-copy"><b>Offline readiness</b><small>No offline network or messages are connected.</small></div><span class="offline-demo-status">UNAVAILABLE</span></article></div></section>
    <section class="faq-section" id="faq"><div class="reference-container faq-container"><div class="centered-heading"><span class="reference-kicker">CLEAR ANSWERS</span><h2>Frequently asked questions</h2><p>What to know about this prototype and its safety features.</p></div><div class="faq-list">${questions.map(([question,answer]) => `<details><summary>${question}<span>＋</span></summary><p>${answer}</p></details>`).join('')}</div></div></section>
    <section class="reference-cta-section"><div class="reference-container reference-cta-inner"><span class="reference-kicker">A LITTLE MORE PEACE OF MIND</span><h2>Protect what matters most.</h2><p>Explore the Suraksha 360 dashboard preview and see how a trusted safety circle can fit into your day.</p><div><button class="reference-cta large-cta" data-action="get-started">Create your account <span>→</span></button><button class="reference-sos-small" data-action="view-demo">Open dashboard preview</button></div><small>Preview only · Emergency services are not contacted</small></div></section>
    ${renderFooter('landing')}
    <div id="toast-region" role="status" aria-live="polite"></div><div id="modal-root"></div>
  </main>`;
}

function render() {
  unmountSafetyMap();
  unsubscribeMapLocations?.();
  unsubscribeMapLocations = null;
  const landingVisible = !state.authenticated && (state.screen !== 'login' || !backendConfigured);
  if ((!landingVisible && state.landingMapTracking) || (!state.authenticated && state.screen === 'login')) {
    stopLocationTracking();
    state.landingMapTracking = false;
    state.map.location = null;
    state.map.gpsStatus = 'idle';
    state.map.gpsMessage = 'Location is off until you request it.';
    clearMapSession();
  }
  if (state.page !== 'map') state.map.liveLocationStatus = 'disconnected';
  if (state.screen === 'legal') {
    document.querySelector('#app').innerHTML = renderLegalPage(state.legalPage, state.authenticated ? 'legal-app' : 'legal');
    return;
  }
  if (!state.authenticated) {
    if (state.screen !== 'login' || !backendConfigured) {
      document.querySelector('#app').innerHTML = landingPage();
      setupLandingEffects();
      mountLandingSafetyMap();
      return;
    }
    const creating = state.authMode === 'signup';
    document.querySelector('#app').innerHTML = `<main class="auth-screen"><section class="auth-card"><button class="back-to-landing" data-action="back-landing">← Back to home</button><a class="brand auth-brand" href="#" data-action="landing-home" aria-label="Suraksha 360 home"><img class="brand-wordmark" src="/suraksha-360-logo.webp" alt="Suraksha 360 — Personal Safety Grid" /></a><div class="eyebrow">YOUR SAFETY, CONNECTED</div><h1>${creating ? 'Create your account' : 'Welcome to Suraksha 360'}</h1><p class="muted">${creating ? 'Create an account to keep your safety data private and in sync.' : 'Sign in to access your personal safety dashboard.'}</p><form id="auth-form" class="auth-form"><label>Email address<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="8" required /></label><button class="button button-primary" type="submit">${creating ? 'Create account' : 'Sign in'}</button></form>${state.authError ? `<p class="landing-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}<p class="auth-switch">${creating ? 'Already have an account?' : 'New to Suraksha 360?'} <button class="text-button" data-action="toggle-auth">${creating ? 'Sign in' : 'Create account'}</button></p></section></main>${renderFooter('auth')}`;
    return;
  }
  const pages = {
    dashboard, map: mapPage, journey: journeyPage, contacts: contactsPage,
    notifications: notificationsPage, offline: offlinePage, settings: settingsPage, sos: sosPage,
  };
  document.querySelector('#app').innerHTML = shell(pages[state.page]());
  if (state.page === 'map') mountCurrentSafetyMap();
  else if (state.authenticated && !state.demoMode && state.page === 'contacts' && !state.map.contactsLoaded) void refreshMapSecurityData();
}

let landingScrollHandlerReady = false;
let landingRevealObserver;
function updateLandingNavigation() {
  const nav = document.querySelector('.reference-nav');
  if (!nav) return;
  nav.classList.toggle('scrolled', window.scrollY > 10);
  const links = [...nav.querySelectorAll('nav a[href^="#"]')];
  let activeHash = '#top';
  links.forEach((link) => {
    const section = document.querySelector(link.hash);
    if (section && section.getBoundingClientRect().top <= 150) activeHash = link.hash;
  });
  links.forEach((link) => {
    const active = link.hash === activeHash;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function setupLandingEffects() {
  const nav = document.querySelector('.reference-nav');
  if (!nav) return;
  updateLandingNavigation();
  nav.addEventListener('click', (event) => {
    if (event.target.closest('nav a[href^="#"]')) nav.classList.remove('menu-open');
  });
  if (!landingScrollHandlerReady) {
    window.addEventListener('scroll', updateLandingNavigation, { passive: true });
    landingScrollHandlerReady = true;
  }

  landingRevealObserver?.disconnect();
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    landingRevealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reference-landing > section:not(.reference-hero), .pillar-card, .technology-list article').forEach((element) => {
      element.classList.add('reveal-on-scroll');
      landingRevealObserver.observe(element);
    });
  }
}

function updateLandingLocation(location) {
  state.map.location = location;
  const coordinates = document.querySelector('#landing-location-summary');
  if (coordinates) coordinates.textContent = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  const accuracy = document.querySelector('#landing-location-accuracy');
  if (accuracy) accuracy.textContent = location.accuracy == null ? 'Not available' : `±${Math.round(location.accuracy)} m`;
  const status = document.querySelector('#landing-map-status');
  if (status) status.textContent = location.tracking
    ? 'Live device location is updating on this map. It is not being shared.'
    : 'Showing your last device location. Tracking is stopped; it is not being shared.';
  const pill = document.querySelector('#landing-gps-pill');
  if (pill) {
    pill.innerHTML = `<i></i> ${location.tracking ? 'Live GPS active' : 'Location available'}`;
    pill.classList.toggle('landing-gps-active', location.tracking);
  }
  const start = document.querySelector('[data-action="landing-start-location"]');
  const stop = document.querySelector('[data-action="landing-stop-location"]');
  if (start) {
    start.hidden = location.tracking;
    start.disabled = false;
    start.textContent = '⌖  Update live location';
  }
  if (stop) stop.hidden = !location.tracking;
}

function mountLandingSafetyMap() {
  const element = document.querySelector('#landing-safety-map');
  if (!element) return;
  try {
    mountSafetyMap(element, {
      layer: state.map.layer,
      onLocation: updateLandingLocation,
      onStatus: ({ kind, message }) => {
        state.map.gpsStatus = kind;
        state.map.gpsMessage = message;
        if (kind === 'error' || kind === 'stopped' || (kind === 'ready' && !isTrackingLocation())) {
          state.landingMapTracking = false;
        }
        const status = document.querySelector('#landing-map-status');
        if (status) status.textContent = message;
        const pill = document.querySelector('#landing-gps-pill');
        if (pill) {
          const label = kind === 'tracking' ? 'Live GPS active'
            : kind === 'locating' ? 'Requesting permission'
              : kind === 'error' ? 'GPS unavailable'
                : kind === 'ready' ? 'Location available' : 'GPS off';
          pill.innerHTML = `<i></i> ${label}`;
          pill.classList.toggle('landing-gps-active', kind === 'tracking');
        }
        const start = document.querySelector('[data-action="landing-start-location"]');
        const stop = document.querySelector('[data-action="landing-stop-location"]');
        if (start) {
          start.disabled = kind === 'locating';
          start.hidden = kind === 'tracking';
          if (kind !== 'locating' && kind !== 'tracking') {
            start.textContent = kind === 'ready' ? '⌖  Update live location' : '⌖  Show my live location';
          }
        }
        if (stop) stop.hidden = kind !== 'tracking';
      },
    });
  } catch (error) {
    console.error('Unable to mount the landing-page safety map', error);
    const status = document.querySelector('#landing-map-status');
    if (status) status.textContent = `The map could not be loaded: ${error.message}`;
  }
}

function contactRowsMarkup(contacts) {
  const myId = state.user?.id;
  const myRelationships = contacts.filter((contact) => contact.owner_id === myId);
  const accepted = myRelationships.filter((contact) => contact.status === 'accepted');
  const pending = myRelationships.filter((contact) => contact.status === 'pending' && new Date(contact.expires_at) > new Date());
  const inbound = contacts.filter((contact) => contact.contact_user_id === myId && contact.status === 'accepted');
  return `${accepted.map((contact) => `<article class="trusted-contact-row"><div><b>${escapeHtml(contact.display_name)}</b><small>${escapeHtml(contact.contact_email)} · Accepted</small></div><button class="button button-danger-quiet" data-action="revoke-trusted-contact" data-contact-id="${escapeHtml(contact.id)}">Revoke access</button></article>`).join('') || '<p class="map-message">No accepted contacts yet.</p>'}${pending.map((contact) => `<article class="trusted-contact-row invite-row"><div><b>${escapeHtml(contact.display_name)} · Invite pending</b><small>Expires ${escapeHtml(new Date(contact.expires_at).toLocaleString())}. Share this code with the invited person:</small><code>${escapeHtml(contact.invitation_code)}</code></div><button class="button button-quiet" data-action="copy-invite" data-invite-code="${escapeHtml(contact.invitation_code)}">Copy invite code</button></article>`).join('')}${inbound.map((contact) => `<article class="trusted-contact-row"><div><b>Accepted invitation</b><small>From ${escapeHtml(contact.contact_email)}</small></div><button class="button button-danger-quiet" data-action="revoke-trusted-contact" data-contact-id="${escapeHtml(contact.id)}">Revoke access</button></article>`).join('')}`;
}

function syncMapPanels() {
  const accepted = state.map.trustedContacts.filter((contact) =>
    contact.owner_id === state.user?.id && contact.status === 'accepted' && contact.contact_user_id,
  );
  const contactOptions = document.querySelector('#map-contact-options');
  if (contactOptions) contactOptions.innerHTML = mapContactOptions(accepted);
  const received = document.querySelector('#received-location-list');
  if (received) received.innerHTML = receivedLocationMarkup(state.map.receivedLocations);
  const delivery = document.querySelector('#sos-delivery-list');
  if (delivery) delivery.innerHTML = sosDeliveryMarkup(state.map.sosAlerts);
  const incoming = document.querySelector('#incoming-sos-list');
  if (incoming) incoming.innerHTML = incomingSosMarkup(state.map.incomingSos);
  const realtime = document.querySelector('#map-realtime-status');
  if (realtime) realtime.textContent = `Location updates: ${state.map.liveLocationStatus} · SOS alerts: ${state.map.sosRealtimeStatus}`;
  const contactList = document.querySelector('#trusted-contact-list');
  if (contactList) contactList.innerHTML = `${state.map.contactsError ? `<p class="map-message error-message">${escapeHtml(state.map.contactsError)}</p>` : ''}${contactRowsMarkup(state.map.trustedContacts)}`;
  const mapError = document.querySelector('#map-data-error');
  if (mapError) {
    mapError.textContent = state.map.contactsError;
    mapError.hidden = !state.map.contactsError;
  }
  if (document.querySelector('#safety-map')) {
    setSharedContactLocations(state.map.receivedLocations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.owner_label,
      capturedAt: location.captured_at,
    })));
  }
  updateRoutePanel();
}

function showMapMessage(message, isError = false) {
  state.map.gpsMessage = message;
  const toolbar = document.querySelector('#map-status-text');
  const detail = document.querySelector('#gps-message');
  if (toolbar) toolbar.textContent = message;
  if (detail) {
    detail.textContent = message;
    detail.classList.toggle('error-message', isError);
  }
}

function updateMapLocation(location) {
  state.map.location = location;
  if (location.tracking) state.map.gpsStatus = 'tracking';
  const accuracy = document.querySelector('#gps-accuracy');
  if (accuracy) accuracy.textContent = location.accuracy == null ? 'GPS accuracy unavailable' : `Accuracy ±${Math.round(location.accuracy)} m`;
  const calculateButton = document.querySelector('[data-action="calculate-map-route"]');
  if (calculateButton) calculateButton.disabled = false;
  const pill = document.querySelector('#map-gps-pill');
  if (pill) {
    pill.textContent = location.tracking ? 'GPS TRACKING' : 'GPS READY';
    pill.classList.toggle('is-tracking', location.tracking);
  }
  const message = location.tracking ? 'Live GPS updates are active on this device.' : 'Current device location acquired.';
  showMapMessage(message);
  document.querySelectorAll('[data-action="start-gps-tracking"]').forEach((button) => { button.hidden = location.tracking; });
  document.querySelectorAll('[data-action="stop-gps-tracking"]').forEach((button) => { button.hidden = !location.tracking; });
  if (location.tracking && state.map.journeyId && state.map.activeShares.length) {
    void uploadSharedLocation(location);
  }
}

function updateRoutePanel() {
  const selected = document.querySelector('#selected-destination');
  if (selected) {
    selected.innerHTML = state.map.destination
      ? `<b>Selected destination</b><small>${escapeHtml(state.map.destination.label)}</small><button class="button button-quiet" data-action="calculate-map-route" ${state.map.location ? '' : 'disabled'}>Calculate route</button>`
      : '<span>Choose a search result to set your destination.</span>';
  }
  const summary = document.querySelector('#route-summary');
  if (summary) {
    summary.innerHTML = state.map.route
      ? `<b>${(state.map.route.distanceMeters / 1000).toFixed(1)} km</b><span>About ${Math.max(1, Math.round(state.map.route.durationSeconds / 60))} min by car</span>`
      : '<span>Route distance and travel time will appear here.</span>';
  }
  const startButton = document.querySelector('[data-action="start-safety-journey"]');
  const selectedContactCount = state.map.trustedContacts.filter((contact) =>
    state.map.selectedContactIds.includes(contact.id) && contact.owner_id === state.user?.id &&
    contact.status === 'accepted' && contact.contact_user_id,
  ).length;
  if (startButton) {
    startButton.disabled = !state.map.route || !state.authenticated || state.demoMode || !selectedContactCount || state.map.isSharing;
    if (state.map.isSharing) startButton.textContent = 'Journey already active';
    else if (state.authenticated && !state.demoMode) startButton.textContent = 'Start journey & share';
    else startButton.textContent = 'Sign in to share a journey';
  }
  const duration = document.querySelector('#share-duration');
  if (duration) duration.disabled = !state.authenticated || state.demoMode || state.map.isSharing;
  const sosButton = document.querySelector('[data-action="confirm-sos"]');
  if (sosButton && state.authenticated && !state.demoMode) sosButton.disabled = selectedContactCount === 0;
}

async function calculateSelectedMapRoute() {
  if (!state.map.destination) throw new Error('Choose a destination first.');
  const route = await calculateRoute(state.map.destination);
  state.map.route = route;
  updateRoutePanel();
  toast(`Route calculated: ${(route.distanceMeters / 1000).toFixed(1)} km, about ${Math.max(1, Math.round(route.durationSeconds / 60))} minutes by car.`);
}

async function uploadSharedLocation(location) {
  const now = Date.now();
  if (!backendApi || mapLocationUploadPending || now - state.map.lastLocationUpload < 5000) return;
  mapLocationUploadPending = true;
  state.map.lastLocationUpload = now;
  try {
    await backendApi.upsertCurrentLocation(location);
  } catch (error) {
    console.error('Unable to publish the shared location', error);
    stopLocationTracking();
    try {
      await backendApi.stopAllLocationSharing();
      state.map.activeShares = [];
      state.map.isSharing = false;
      state.map.journeyId = null;
      state.map.gpsStatus = 'error';
      showMapMessage(`Location sharing stopped because the latest position could not be saved: ${error.message}`, true);
      if (document.querySelector('#safety-map')) render();
    } catch (stopError) {
      console.error('Unable to revoke location sharing after a publishing failure', stopError);
      showMapMessage(`Location update failed and sharing could not be revoked automatically: ${stopError.message}. Use Stop sharing now and verify the database connection.`, true);
    }
  } finally {
    mapLocationUploadPending = false;
  }
}

async function refreshMapSecurityData() {
  if (!backendApi || !state.authenticated || state.demoMode) return;
  const request = ++mapDataRequest;
  const userId = state.user.id;
  let cleanupError = '';
  if (locationCleanupUserId !== userId) {
    try {
      await backendApi.cleanupExpiredLocationSharing();
    } catch (error) {
      console.error('Unable to clean up expired location-sharing sessions', error);
      cleanupError = `Expired location sharing could not be cleaned up: ${error.message}.`;
    }
    locationCleanupUserId = userId;
  }
  if (request !== mapDataRequest || !state.authenticated) return;
  try {
    const [trustedContacts, shares, locations] = await Promise.all([
      backendApi.loadTrustedContacts(),
      backendApi.loadLocationShares(),
      backendApi.loadAuthorizedLiveLocations(),
    ]);
    if (request !== mapDataRequest || !state.authenticated) return;
    state.map.trustedContacts = trustedContacts;
    state.map.contactsLoaded = true;
    state.map.contactsError = cleanupError;
    const now = Date.now();
    state.map.activeShares = shares.filter((share) =>
      share.owner_id === state.user?.id && !share.revoked_at && Date.parse(share.expires_at) > now,
    );
    state.map.isSharing = state.map.activeShares.length > 0;
    state.map.journeyId = state.map.activeShares[0]?.journey_id ?? null;
    const activeIncoming = shares.filter((share) =>
      share.recipient_user_id === state.user?.id && !share.revoked_at && Date.parse(share.expires_at) > now,
    );
    const ownerLabels = new Map(activeIncoming.map((share) => [share.owner_id, share.owner_label]));
    state.map.receivedLocations = locations
      .filter((location) => ownerLabels.has(location.user_id))
      .map((location) => ({ ...location, owner_label: ownerLabels.get(location.user_id) }));
    syncMapPanels();
  } catch (error) {
    console.error('Unable to load trusted contacts and authorized locations', error);
    state.map.contactsLoaded = true;
    state.map.contactsError = `Trusted-contact or location data could not be loaded: ${error.message}. Confirm that supabase/safety-map.sql has been applied.`;
    syncMapPanels();
  }
  try {
    const alerts = await backendApi.loadOwnSosAlerts();
    const withRecipients = await Promise.all(alerts.map(async (alert) => {
      const recipients = await backendApi.loadSosAlertDelivery(alert.id);
      return {
        ...alert,
        recipients: recipients.map((recipient) => ({
          ...recipient,
          name: state.map.trustedContacts.find((contact) => contact.id === recipient.contact_id)?.display_name ?? 'Trusted contact',
        })),
      };
    }));
    if (request !== mapDataRequest || !state.authenticated) return;
    state.map.sosAlerts = withRecipients;
    syncMapPanels();
  } catch (error) {
    console.error('Unable to load emergency alert status', error);
    state.map.contactsError = `Emergency alert status could not be loaded: ${error.message}.`;
    syncMapPanels();
  }
  try {
    const pending = await backendApi.loadIncomingSosAlerts();
    const incoming = await Promise.all(pending.map((recipient) => backendApi.getSosAlert(recipient.alert_id)));
    if (request !== mapDataRequest || !state.authenticated) return;
    state.map.incomingSos = incoming.filter((alert) =>
      alert?.status === 'active' && Date.parse(alert.expires_at) > Date.now(),
    );
    syncMapPanels();
  } catch (error) {
    console.error('Unable to load incoming SOS alerts', error);
    state.map.contactsError = `Incoming SOS alerts could not be loaded: ${error.message}.`;
    syncMapPanels();
  }
  if (state.page === 'dashboard' || state.page === 'journey') render();
}

function confirmIncomingSosAcknowledgement(alert) {
  if (!alert || alert.status !== 'active') return;
  if (state.map.incomingAlert === alert.id) return;
  if (document.querySelector('#modal-root .modal')) {
    toast('An incoming SOS alert is waiting. Open the interactive map to review it.');
    return;
  }
  state.map.incomingAlert = alert.id;
  const locationLink = Number.isFinite(alert.latitude) && Number.isFinite(alert.longitude)
    ? `<p><a href="https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=16/${alert.latitude}/${alert.longitude}" target="_blank" rel="noopener noreferrer">Open the shared alert location</a></p>`
    : '<p class="muted">No location was attached to this alert.</p>';
  showModal('Emergency alert from a trusted contact', `<div class="modal-warning"><span>!</span><p>A trusted contact requested help at ${escapeHtml(new Date(alert.created_at).toLocaleString())}.</p></div>${locationLink}<p class="muted">Acknowledging records that you saw this in-app alert. It does not contact emergency services.</p>`, async () => {
    const button = document.querySelector('#modal-root [data-action="submit-modal"]');
    if (button) button.disabled = true;
    try {
      await backendApi.acknowledgeSosAlert(alert.id);
      state.map.incomingAlert = null;
      closeModal();
      toast('Your acknowledgement was recorded.');
      await refreshMapSecurityData();
    } catch (error) {
      if (button) button.disabled = false;
      console.error('Unable to acknowledge the emergency alert', error);
      toast(`Acknowledgement failed: ${error.message}`);
    }
  }, 'Acknowledge alert');
}

async function startSosRealtime(userId) {
  if (!backendApi || !userId || sosRealtimeUserId === userId) return;
  unsubscribeSosAlerts?.();
  unsubscribeSosAlerts = null;
  sosRealtimeUserId = userId;
  state.map.sosRealtimeStatus = 'connecting';
  syncMapPanels();
  try {
    unsubscribeSosAlerts = await backendApi.subscribeToSosAlerts({
      onIncomingAlert: async (recipient) => {
        try {
          const alert = await backendApi.getSosAlert(recipient.alert_id);
          if (!alert || alert.status !== 'active' || !state.authenticated || state.user?.id !== userId) return;
          await refreshMapSecurityData();
          confirmIncomingSosAcknowledgement(alert);
        } catch (error) {
          console.error('Unable to load an incoming emergency alert', error);
          toast(`An SOS alert arrived but could not be loaded: ${error.message}`);
        }
      },
      onDeliveryUpdate: () => { void refreshMapSecurityData(); },
      onStatus: ({ status, error }) => {
        if (state.user?.id !== userId) return;
        state.map.sosRealtimeStatus = status === 'SUBSCRIBED' ? 'connected' : 'unavailable';
        if (error) console.error('SOS alert channel status error', error);
        syncMapPanels();
      },
    });
  } catch (error) {
    sosRealtimeUserId = null;
    state.map.sosRealtimeStatus = 'unavailable';
    syncMapPanels();
    console.error('Unable to subscribe to emergency alerts', error);
    toast(`Emergency alert updates are unavailable: ${error.message}`);
  }
}

function mountCurrentSafetyMap() {
  const element = document.querySelector('#safety-map');
  if (!element) return;
  try {
    mountSafetyMap(element, {
      layer: state.map.layer,
      onLocation: updateMapLocation,
      onStatus: ({ kind, message }) => {
        state.map.gpsStatus = kind;
        const pill = document.querySelector('#map-gps-pill');
        if (pill) {
          const labels = {
            locating: 'GPS REQUESTING',
            tracking: 'GPS TRACKING',
            ready: 'GPS READY',
            error: 'GPS ERROR',
            stopped: state.map.location ? 'GPS READY' : 'GPS OFF',
          };
          pill.textContent = labels[kind] ?? 'GPS OFF';
          pill.classList.toggle('is-tracking', kind === 'tracking');
        }
        const tracking = isTrackingLocation();
        document.querySelectorAll('[data-action="start-gps-tracking"]').forEach((button) => {
          button.hidden = tracking;
          button.disabled = kind === 'locating';
        });
        document.querySelectorAll('[data-action="stop-gps-tracking"]').forEach((button) => { button.hidden = !tracking; });
        document.querySelectorAll('[data-action="locate"]').forEach((button) => { button.disabled = kind === 'locating'; });
        showMapMessage(message, kind === 'error');
      },
    });
    setSharedContactLocations(state.map.receivedLocations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.owner_label,
      capturedAt: location.captured_at,
    })));
    if (state.authenticated && !state.demoMode) {
      state.map.liveLocationStatus = 'connecting';
      syncMapPanels();
      unsubscribeMapLocations = backendApi.subscribeToLiveLocations((payload) => {
        if (!document.querySelector('#safety-map')) return;
        if (payload.type === 'SUBSCRIPTION_ERROR') {
          console.error('Live location subscription failed', payload.error);
          state.map.liveLocationStatus = 'unavailable';
          syncMapPanels();
          showMapMessage(`Live location updates are unavailable: ${payload.error.message}`, true);
        } else if (payload.type === 'SUBSCRIPTION_STATUS') {
          state.map.liveLocationStatus = payload.status === 'SUBSCRIBED' ? 'connected' : 'unavailable';
          syncMapPanels();
          if (payload.status !== 'SUBSCRIBED') showMapMessage(`Live location channel status: ${payload.status}.`, true);
        } else {
          void refreshMapSecurityData();
        }
      });
    }
  } catch (error) {
    console.error('Unable to mount the interactive safety map', error);
    state.map.gpsStatus = 'error';
    showMapMessage(`The interactive map could not be initialized: ${error.message}`, true);
  }
  if (state.authenticated && !state.demoMode && !state.map.contactsLoaded) void refreshMapSecurityData();
}

async function startApp() {
  render();
  if (!backendConfigured) return;
  try {
    backendApi = await import('./backend.js');
    const session = await backendApi.initializeBackend();
    state.user = session.user;
    state.authenticated = Boolean(session.user);
    state.demoMode = false;
    if (state.authenticated) state.screen = 'app';
    let accountDataError;
    if (state.authenticated) {
      try {
        await loadAccountData();
      } catch (error) {
        accountDataError = error;
        console.error('Unable to load account data; authentication remains available', error);
      }
    }
    render();
    if (accountDataError) toast(`Account data is unavailable: ${accountDataError.message}`);
    if (state.authenticated) {
      void startSosRealtime(state.user.id);
      void refreshMapSecurityData();
    }
    backendApi.onAuthStateChange(async (user) => {
      const previousUserId = state.user?.id;
      state.user = user;
      state.authenticated = Boolean(user);
      if (previousUserId !== user?.id) {
        clearMapSession();
        locationCleanupUserId = null;
        state.map.contactsLoaded = false;
        state.map.location = null;
        state.map.destination = null;
        state.map.route = null;
        state.map.gpsStatus = 'idle';
        state.map.gpsMessage = 'Location is off until you request it.';
        state.map.contactsError = '';
        state.map.trustedContacts = [];
        state.map.activeShares = [];
        state.map.receivedLocations = [];
        state.map.sosAlerts = [];
        state.map.incomingSos = [];
        state.map.incomingAlert = null;
        state.map.liveLocationStatus = 'disconnected';
        state.map.sosRealtimeStatus = user ? 'connecting' : 'not connected';
        state.map.isSharing = false;
        state.map.journeyId = null;
        state.map.selectedContactIds = [];
      }
      if (state.authenticated) {
        state.demoMode = false;
        state.screen = 'app';
        void startSosRealtime(user.id);
        void refreshMapSecurityData();
        render();
        void loadAccountData().then(() => {
          if (state.user?.id === user.id) render();
        }).catch((error) => {
          console.error('Unable to load account data', error);
          if (state.user?.id === user.id) toast(`Account data is unavailable: ${error.message}`);
        });
      } else {
        unsubscribeSosAlerts?.();
        unsubscribeSosAlerts = null;
        sosRealtimeUserId = null;
        state.map.sosRealtimeStatus = 'not connected';
        stopLocationTracking();
        state.demoMode = false;
        state.screen = 'landing';
        render();
      }
    });
  } catch (error) {
    console.error('Authentication setup failed', error);
    state.authError = 'Sign-in is temporarily unavailable. Please try again in a moment.';
    state.screen = 'landing';
    render();
  }
}

async function loadAccountData() {
  const remote = await backendApi.loadUserData();
  if (remote) {
    state.contacts = remote.contacts ?? state.contacts;
    state.preferences = remote.preferences ?? state.preferences;
    state.notifications = remote.notifications ?? state.notifications;
    if (removeLegacyPreviewData({ persistChanges: false })) {
      await backendApi.saveUserData({
        contacts: state.contacts,
        preferences: state.preferences,
        notifications: state.notifications,
      });
    }
    return;
  }
  state.contacts = [];
  state.notifications = [];
  state.preferences = { shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true };
  await backendApi.saveUserData({
    contacts: state.contacts,
    preferences: state.preferences,
    notifications: state.notifications,
  });
}

function showModal(title, body, onSubmit, submitLabel = 'Confirm') {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="dismiss-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">×</button><span class="eyebrow">SURAKSHA 360</span><h2 id="modal-title">${title}</h2><div class="modal-body">${body}</div><div class="modal-actions"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" data-action="submit-modal">${submitLabel}</button></div></section></div>`;
  root.querySelector('[data-action="submit-modal"]').addEventListener('click', () => onSubmit(root));
  root.querySelectorAll('[data-action="close-modal"]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  root.querySelector('.modal').addEventListener('click', (event) => event.stopPropagation());
  root.querySelector('[data-action="dismiss-modal"]').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
}

function closeModal() {
  state.map.incomingAlert = null;
  document.querySelector('#modal-root').innerHTML = '';
}

function addContactModal() {
  showModal('Add a trusted contact', `<form id="contact-form" class="modal-form">
    <label>Full name<input name="name" required maxlength="60" placeholder="e.g. Alex Morgan" /></label>
    <label>Relationship<input name="relation" required maxlength="60" placeholder="e.g. Close friend" /></label>
    <label>Phone number<input name="phone" type="tel" required maxlength="24" placeholder="+1 555 0100" /></label>
    <p class="form-hint">Their details are saved to this device or your account. No invitation or alert is sent.</p>
  </form>`, (root) => {
    const form = root.querySelector('#contact-form');
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = data.get('name').trim();
    const colors = ['violet', 'pink', 'blue'];
    state.contacts.push({
      name, relation: data.get('relation').trim(), phone: data.get('phone').trim(),
      initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
      color: colors[state.contacts.length % colors.length],
    });
    persist('suraksha-contacts', state.contacts);
    closeModal(); render(); toast(`${name} added to your trusted circle.`);
  }, 'Add contact');
}

function confirmRealSos() {
  const contactIds = state.map.selectedContactIds;
  const selected = state.map.trustedContacts.filter((contact) =>
    contactIds.includes(contact.id) && contact.owner_id === state.user?.id &&
    contact.status === 'accepted' && contact.contact_user_id,
  );
  if (!selected.length) {
    toast('Select at least one accepted trusted contact before creating an SOS alert.');
    return;
  }
  const location = getCurrentLocation();
  const locationText = location
    ? `The alert will include the latest device location captured ${new Date(location.capturedAt).toLocaleString()}${location.accuracy == null ? '' : ` (accuracy ±${Math.round(location.accuracy)} m)`}.`
    : 'No device location is available, so this alert will not include coordinates. Use My location first if safe to do so.';
  showModal('Create an emergency SOS alert?', `<div class="modal-warning"><span>!</span><p>This creates an in-app alert for ${selected.length} selected trusted ${selected.length === 1 ? 'contact' : 'contacts'}.</p></div><p>${locationText}</p><p class="muted">No SMS, phone call, or emergency-service dispatch is configured. The alert stays pending until a recipient acknowledges it.</p>`, async () => {
    const button = document.querySelector('#modal-root [data-action="submit-modal"]');
    if (button) button.disabled = true;
    try {
      await backendApi.createSosAlert(location, selected.map((contact) => contact.id));
      closeModal();
      await refreshMapSecurityData();
      toast(`SOS alert created for ${selected.length} contact${selected.length === 1 ? '' : 's'}. Delivery is pending acknowledgment.`);
    } catch (error) {
      if (button) button.disabled = false;
      console.error('Unable to create the SOS alert', error);
      toast(`SOS alert was not created: ${error.message}`);
    }
  }, 'Create in-app alert');
}

function openDashboardPage(page) {
  state.page = page;
  if (!state.authenticated && backendConfigured) {
    state.authMode = 'signin';
    state.screen = 'login';
    render();
    return;
  }
  if (!state.authenticated) {
    state.authenticated = true;
    state.demoMode = true;
  }
  state.screen = 'app';
  render();
}

async function stopLiveJourney() {
  if (!backendApi || !state.authenticated || state.demoMode) throw new Error('Sign in before managing live location sharing.');
  await backendApi.stopAllLocationSharing();
  stopLocationTracking();
  state.map.journeyId = null;
  state.map.activeShares = [];
  state.map.isSharing = false;
  await refreshMapSecurityData();
  render();
  toast('Journey ended and location sharing revoked.');
}

async function runSafetyMapAction(action, target) {
  if (action === 'locate') {
    await requestCurrentLocation();
    return;
  }
  if (action === 'calculate-map-route') {
    await calculateSelectedMapRoute();
    return;
  }
  if (action === 'refresh-map-data') {
    await refreshMapSecurityData();
    toast('Trusted contacts, active shares, and SOS status refreshed.');
    return;
  }
  if (action === 'start-gps-tracking') {
    await startLocationTracking();
    return;
  }
  if (action === 'stop-gps-tracking') {
    if (state.map.isSharing) await stopLiveJourney();
    else {
      stopLocationTracking();
      state.map.gpsStatus = state.map.location ? 'ready' : 'stopped';
      showMapMessage('Live GPS tracking stopped on this device.');
      const pill = document.querySelector('#map-gps-pill');
      if (pill) {
        pill.textContent = state.map.location ? 'GPS READY' : 'GPS OFF';
        pill.classList.remove('is-tracking');
      }
    }
    return;
  }
  if (action === 'start-safety-journey') {
    if (!backendApi || !state.authenticated || state.demoMode) throw new Error('Sign in to create a private journey.');
    if (!state.map.route || !state.map.destination) throw new Error('Search for a destination and calculate a route first.');
    const contacts = state.map.trustedContacts.filter((contact) =>
      state.map.selectedContactIds.includes(contact.id) && contact.owner_id === state.user?.id &&
      contact.status === 'accepted' && contact.contact_user_id,
    );
    if (!contacts.length) throw new Error('Select at least one accepted trusted contact before starting a shared journey.');
    const wasTracking = isTrackingLocation();
    const previousJourneyId = state.map.journeyId;
    let journeyId;
    try {
      state.map.journeyId = null;
      const location = await startLocationTracking();
      const duration = Number(document.querySelector('#share-duration')?.value ?? 60);
      journeyId = await backendApi.startSafetyJourney({
        ownerLabel: String(state.user.firstName || state.user.email?.split('@')[0] || 'Suraksha 360 user').slice(0, 80),
        origin: location,
        destination: state.map.route.destination,
        distanceMeters: state.map.route.distanceMeters,
        durationSeconds: state.map.route.durationSeconds,
      }, contacts.map((contact) => contact.id), duration);
      state.map.journeyId = journeyId;
      await backendApi.upsertCurrentLocation(location);
      state.map.lastLocationUpload = Date.now();
      await refreshMapSecurityData();
      render();
      toast(`Journey started. Your latest location is shared with ${contacts.length} selected contact${contacts.length === 1 ? '' : 's'} until it expires or you stop sharing.`);
    } catch (error) {
      console.error('Unable to start the safety journey', error);
      if (journeyId) {
        try {
          await backendApi.stopSafetyJourney(journeyId);
          state.map.journeyId = null;
          state.map.activeShares = [];
          state.map.isSharing = false;
          await refreshMapSecurityData();
        } catch (stopError) {
          console.error('Unable to revoke the partially started safety journey', stopError);
          throw new Error(`${error.message} Sharing may still be active; use Stop sharing now. Revocation error: ${stopError.message}`);
        }
      } else {
        state.map.journeyId = previousJourneyId;
      }
      if (!wasTracking) stopLocationTracking();
      throw new Error(`Journey was not fully started: ${error.message}`);
    }
    return;
  }
  if (action === 'stop-location-sharing') {
    await stopLiveJourney();
    return;
  }
  if (action === 'confirm-sos' && state.page === 'map') {
    confirmRealSos();
    return;
  }
  if (action === 'cancel-sos-alert') {
    await backendApi.cancelSosAlert(target.dataset.alertId);
    await refreshMapSecurityData();
    toast('SOS alert cancelled. No further in-app acknowledgement is expected.');
    return;
  }
  if (action === 'acknowledge-incoming-sos') {
    const alert = state.map.incomingSos.find((item) => item.id === target.dataset.alertId);
    if (!alert) throw new Error('This SOS alert is no longer active.');
    confirmIncomingSosAcknowledgement(alert);
    return;
  }
  if (action === 'revoke-trusted-contact') {
    await backendApi.revokeTrustedContact(target.dataset.contactId);
    state.map.selectedContactIds = state.map.selectedContactIds.filter((id) => id !== target.dataset.contactId);
    await refreshMapSecurityData();
    toast('Trusted-contact access revoked.');
    return;
  }
  if (action === 'copy-invite') {
    const code = target.dataset.inviteCode;
    try {
      await navigator.clipboard.writeText(code);
      toast('Invitation code copied. Share it directly with the invited person.');
    } catch (error) {
      console.error('Unable to copy the invitation code', error);
      showModal('Invitation code', `<p>Share this code directly with the invited person:</p><code class="invite-code-display">${escapeHtml(code)}</code>`, closeModal, 'Done');
    }
  }
}

function doAction(action, target) {
  if (action === 'sos') { state.page = 'sos'; render(); }
  else if (['locate', 'calculate-map-route', 'refresh-map-data', 'start-gps-tracking', 'stop-gps-tracking', 'start-safety-journey', 'stop-location-sharing', 'revoke-trusted-contact', 'copy-invite', 'cancel-sos-alert', 'acknowledge-incoming-sos'].includes(action)) {
    void runSafetyMapAction(action, target).catch((error) => {
      console.error(`Safety map action failed (${action})`, error);
      toast(error.message || 'The safety map action failed.');
    });
  } else if (action === 'confirm-sos') {
    if (state.authenticated && !state.demoMode) confirmRealSos();
    else { state.page = 'sos'; render(); }
  } else if (action === 'add-contact') addContactModal();
  else if (action === 'close-modal') closeModal();
  else if (action === 'mark-read') {
    state.notifications = state.notifications.map((item) => ({ ...item, unread: false }));
    persist('suraksha-notifications', state.notifications); render(); toast('All notifications marked as read.');
  } else if (action === 'refresh') {
    if (state.authenticated && !state.demoMode) {
      void refreshMapSecurityData();
      toast('Refreshing your trusted contacts and safety status.');
    } else toast('Sign in to load account and trusted-contact data.');
  }
  else if (action === 'locate') toast('This illustrative map does not access your current location.');
  else if (action === 'layers') toast('This map preview has illustrative layers only.');
  else if (action === 'zoom-in' || action === 'zoom-out') {
    const map = document.querySelector('#large-map');
    if (map) { const zoom = Number(map.dataset.zoom || 1) + (action === 'zoom-in' ? 0.1 : -0.1); map.dataset.zoom = String(Math.max(0.8, Math.min(1.4, zoom))); map.style.setProperty('--map-zoom', map.dataset.zoom); }
  } else if (action === 'ping-contact') {
    const person = state.contacts[Number(target.dataset.index)];
    if (person) toast(`Ping preview for ${person.name}. No message was sent.`);
  } else if (action === 'contact-menu') {
    const index = Number(target.dataset.index);
    const person = state.contacts[index];
    if (person) showModal(`Remove ${escapeHtml(person.name)}?`, '<p class="muted">Remove this contact from the list saved on this device.</p>', () => {
      state.contacts.splice(index, 1); persist('suraksha-contacts', state.contacts); closeModal(); render(); toast('Contact removed from your circle.');
    }, 'Remove contact');
  } else if (action === 'reset-settings') {
    state.preferences = { shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true };
    persist('suraksha-preferences', state.preferences); render(); toast('Preferences reset to their defaults.');
  } else if (action === 'privacy-info') {
    showModal('Your privacy, in your hands', '<p class="muted">Location sharing is off until you start a journey and select accepted contacts. You can stop sharing from the live map.</p><p class="form-hint">Emergency alerts are in-app only. Emergency services are not contacted.</p>', closeModal, 'Got it');
  } else if (action === 'get-started' || action === 'sign-in') {
    if (backendConfigured) {
      state.screen = 'login';
      render();
    } else {
      state.authenticated = true;
      state.demoMode = true;
      state.screen = 'app';
      state.page = 'dashboard';
      render();
      toast('Dashboard preview opened. Add Supabase Auth credentials to enable sign-in.');
    }
  } else if (action === 'toggle-auth') {
    state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
    state.authError = '';
    render();
  } else if (action === 'view-demo') {
    state.authenticated = true;
    state.demoMode = true;
    state.screen = 'app';
    state.page = 'dashboard';
    render();
  } else if (action === 'back-landing' || action === 'landing-home') {
    state.authenticated = false;
    state.demoMode = false;
    state.screen = 'landing';
    render();
  } else if (action === 'footer-home') {
    state.legalPage = null;
    state.screen = state.authenticated ? 'app' : 'landing';
    state.page = 'dashboard';
    render();
  } else if (action === 'landing-menu') {
    document.querySelector('.reference-nav')?.classList.toggle('menu-open');
  } else if (action === 'scroll-map' || action === 'scroll-preview') {
    document.querySelector(action === 'scroll-map' ? '#interactive-map' : '#dashboard-preview')?.scrollIntoView({ behavior: 'smooth' });
  } else if (action === 'landing-open-map' || action === 'landing-open-contacts' || action === 'landing-open-sos') {
    const page = action === 'landing-open-map' ? 'map' : action === 'landing-open-contacts' ? 'contacts' : 'sos';
    openDashboardPage(page);
  } else if (action === 'landing-start-location') {
    state.landingMapTracking = true;
    startLocationTracking().catch((error) => {
      state.landingMapTracking = false;
      console.error('Landing-page GPS request failed', error);
      const start = document.querySelector('[data-action="landing-start-location"]');
      if (start) {
        start.hidden = false;
        start.disabled = false;
        start.textContent = '⌖  Try location again';
      }
      const stop = document.querySelector('[data-action="landing-stop-location"]');
      if (stop) stop.hidden = true;
      const status = document.querySelector('#landing-map-status');
      if (status) status.textContent = error.message || 'Unable to access device location.';
    });
  } else if (action === 'landing-stop-location') {
    stopLocationTracking();
    state.landingMapTracking = false;
    const status = document.querySelector('#landing-map-status');
    if (status) status.textContent = state.map.location
      ? 'Showing your last device location. Tracking is stopped; it is not being shared.'
      : 'Live location tracking stopped.';
    const pill = document.querySelector('#landing-gps-pill');
    if (pill) {
      pill.innerHTML = `<i></i> ${state.map.location ? 'Location available' : 'GPS off'}`;
      pill.classList.remove('landing-gps-active');
    }
    const start = document.querySelector('[data-action="landing-start-location"]');
    if (start) {
      start.hidden = false;
      start.disabled = false;
      start.textContent = '⌖  Update live location';
    }
    const stop = document.querySelector('[data-action="landing-stop-location"]');
    if (stop) stop.hidden = true;
  } else if (action === 'landing-recenter-map') {
    try {
      recenterMapOnCurrentLocation();
    } catch (error) {
      toast(error.message);
    }
  } else if (action === 'recenter-map') {
    toast('Map preview recentered. No live location is available.');
  } else if (action === 'open-settings') {
    state.authenticated = true;
    state.demoMode = true;
    state.screen = 'app';
    state.page = 'settings';
    render();
  } else if (action === 'workflow-next') {
    state.workflowStep = state.workflowStep % 4 + 1;
    render();
  } else if (action === 'scroll-preview') {
    document.querySelector('#dashboard-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'feature-preview') {
    const feature = target?.dataset.featurePreview || target?.closest('[data-feature-preview]')?.dataset.featurePreview;
    if (feature === 'location') {
      document.querySelector('#interactive-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (feature === 'privacy') {
      document.querySelector('#privacy-controls')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const tabByFeature = { sos: 'sos', contacts: 'contacts', journey: 'journey', offline: 'network' };
    if (tabByFeature[feature]) {
      state.landingTab = tabByFeature[feature];
      render();
      requestAnimationFrame(() => document.querySelector('#dashboard-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  } else if (action === 'signout') {
    if (state.demoMode) {
      clearMapSession();
      state.authenticated = false;
      state.demoMode = false;
      state.screen = 'landing';
      render();
    } else if (backendConfigured) {
      void (async () => {
        if (state.map.isSharing) await backendApi.stopAllLocationSharing();
        stopLocationTracking();
        await backendApi.signOut();
      })().catch((error) => {
        console.error('Sign out failed', error);
        toast(`Unable to sign out safely: ${error.message}`);
      });
    }
    else showModal('Sign out of this demo?', '<p class="muted">Your saved contacts and preferences will remain on this device.</p>', () => { closeModal(); toast('You are signed out of the demo.'); }, 'Sign out');
  } else if (action === 'menu') document.querySelector('.sidebar').classList.toggle('mobile-open');
  else if (action === 'profile-menu') toast('Account settings are available from Privacy & settings.');
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'place-search-form') {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorOutput = document.querySelector('#place-search-error');
    const resultsOutput = document.querySelector('#place-results');
    if (submit) submit.disabled = true;
    if (errorOutput) errorOutput.textContent = '';
    try {
      state.map.places = await searchPlaces(new FormData(form).get('query'));
      if (!state.map.places.length) throw new Error('No matching places found. Try a more specific address.');
      clearPlannedRoute();
      state.map.destination = null;
      state.map.route = null;
      if (resultsOutput) resultsOutput.innerHTML = state.map.places.map((place, index) => `<button class="place-result" data-place-index="${index}" type="button"><b>${escapeHtml(place.label.split(',')[0])}</b><small>${escapeHtml(place.label)}</small></button>`).join('');
      updateRoutePanel();
    } catch (error) {
      console.error('Place search failed', error);
      if (errorOutput) errorOutput.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }
  if (form.id === 'contact-invite-form') {
    event.preventDefault();
    const values = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const invite = await backendApi.createTrustedContactInvite(values.get('email'), values.get('displayName'));
      await refreshMapSecurityData();
      toast(`Invite code generated for ${values.get('email')}. Share it directly; no email was sent.`);
      if (invite?.invitation_code) {
        state.map.trustedContacts = await backendApi.loadTrustedContacts();
        syncMapPanels();
      }
      form.reset();
    } catch (error) {
      console.error('Unable to create the trusted-contact invitation', error);
      toast(`Invitation was not created: ${error.message}`);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }
  if (form.id === 'contact-accept-form') {
    event.preventDefault();
    const values = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await backendApi.acceptTrustedContactInvite(values.get('invitationCode').trim());
      await refreshMapSecurityData();
      form.reset();
      toast('Trusted-contact invitation accepted. You can now see shares explicitly sent to you.');
    } catch (error) {
      console.error('Unable to accept the trusted-contact invitation', error);
      toast(`Invitation was not accepted: ${error.message}`);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }
  if (form.id !== 'auth-form') return;
  event.preventDefault();
  if (!backendApi) return;
  const submit = form.querySelector('button[type="submit"]');
  const values = new FormData(form);
  submit.disabled = true;
  state.authError = '';
  try {
    if (state.authMode === 'signup') {
      const result = await backendApi.signUp(values.get('email'), values.get('password'));
      if (!result.session) {
        state.authError = 'Account created. Check your email to confirm your address, then sign in.';
        state.authMode = 'signin';
      } else {
        state.user = result.user;
        state.authenticated = true;
        state.screen = 'app';
      }
    } else {
      state.user = await backendApi.signIn(values.get('email'), values.get('password'));
      state.authenticated = true;
      state.demoMode = false;
      state.screen = 'app';
      state.page = 'dashboard';
    }
    render();
  } catch (error) {
    state.authError = error.message || 'Authentication failed. Please try again.';
    render();
  }
});

document.addEventListener('click', (event) => {
  const legalLink = event.target.closest('[data-footer-legal]');
  if (legalLink) {
    event.preventDefault();
    state.legalPage = legalLink.dataset.footerLegal;
    state.screen = 'legal';
    render();
    window.scrollTo(0, 0);
    return;
  }
  const footerSection = event.target.closest('[data-footer-section]');
  if (footerSection && state.screen !== 'landing') {
    event.preventDefault();
    const section = footerSection.dataset.footerSection;
    state.legalPage = null;
    state.screen = 'landing';
    render();
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return;
  }
  if (footerSection && state.screen === 'landing') {
    const section = document.getElementById(footerSection.dataset.footerSection);
    if (section) {
      event.preventDefault();
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  const pageButton = event.target.closest('[data-page]');
  const actionButton = event.target.closest('[data-action]');
  const preference = event.target.closest('[data-pref]');
  const filter = event.target.closest('[data-filter]');
  const landingTab = event.target.closest('[data-landing-tab]');
  const workflowStep = event.target.closest('[data-workflow-step]');
  const mapLayer = event.target.closest('[data-layer]');
  const featurePreview = event.target.closest('[data-feature-preview]');
  const placeResult = event.target.closest('[data-place-index]');

  if (featurePreview) {
    doAction('feature-preview', featurePreview);
    return;
  }
  if (landingTab) {
    state.landingTab = landingTab.dataset.landingTab;
    render();
    return;
  }
  if (workflowStep) {
    state.workflowStep = Number(workflowStep.dataset.workflowStep);
    render();
    return;
  }
  if (mapLayer) {
    const key = mapLayer.dataset.layer;
    state.landingLayers[key] = !state.landingLayers[key];
    render();
    return;
  }
  if (placeResult) {
    const place = state.map.places[Number(placeResult.dataset.placeIndex)];
    if (!place) return;
    clearPlannedRoute();
    state.map.destination = place;
    state.map.route = null;
    updateRoutePanel();
    if (state.map.location) {
      void calculateSelectedMapRoute().catch((error) => {
        console.error('Unable to calculate the selected route', error);
        const output = document.querySelector('#place-search-error');
        if (output) output.textContent = error.message;
      });
    } else {
      const output = document.querySelector('#place-search-error');
      if (output) output.textContent = 'Get your current location, then select Calculate route.';
    }
    return;
  }
  if (pageButton) {
    event.preventDefault();
    state.screen = 'app';
    state.legalPage = null;
    state.page = pageButton.dataset.page;
    render();
    return;
  }
  if (preference) {
    const key = preference.dataset.pref;
    state.preferences[key] = !state.preferences[key];
    persist('suraksha-preferences', state.preferences); render();
    toast(`${key === 'shareLocation' ? 'Location sharing' : 'Preference'} ${state.preferences[key] ? 'enabled' : 'paused'}.`);
    return;
  }
  if (filter) {
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip === filter));
    document.querySelectorAll('.notification-row').forEach((row) => {
      row.hidden = filter.dataset.filter === 'unread' && !state.notifications[Number(row.dataset.notification)]?.unread;
    });
    return;
  }
  if (actionButton) {
    if (actionButton instanceof HTMLAnchorElement) event.preventDefault();
    doAction(actionButton.dataset.action, actionButton);
    return;
  }
  const notification = event.target.closest('[data-notification]');
  if (notification) {
    const item = state.notifications[Number(notification.dataset.notification)];
    if (item) { item.unread = false; persist('suraksha-notifications', state.notifications); render(); }
  }
});

document.addEventListener('change', (event) => {
  const landingLayerSelect = event.target.closest('#landing-map-layer');
  if (landingLayerSelect) {
    try {
      state.map.layer = setMapLayer(landingLayerSelect.value);
    } catch (error) {
      console.error('Unable to change the landing map layer', error);
      toast(`Map layer could not be changed: ${error.message}`);
    }
    return;
  }
  const layerSelect = event.target.closest('#map-layer-select');
  if (layerSelect) {
    try {
      state.map.layer = setMapLayer(layerSelect.value);
    } catch (error) {
      console.error('Unable to change the map layer', error);
      toast(`Map layer could not be changed: ${error.message}`);
    }
    return;
  }
  const contactChoice = event.target.closest('[data-map-contact]');
  if (contactChoice) {
    const id = contactChoice.dataset.mapContact;
    state.map.selectedContactIds = contactChoice.checked
      ? [...new Set([...state.map.selectedContactIds, id])]
      : state.map.selectedContactIds.filter((contactId) => contactId !== id);
    updateRoutePanel();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
  const feature = event.target.matches?.('.pillar-card[data-feature-preview]') ? event.target : null;
  if (feature && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    doAction('feature-preview', feature);
  }
});

startApp();
