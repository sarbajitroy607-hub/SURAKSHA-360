import './style.css';
const backendConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
let backendApi;

const icons = {
  dashboard: '◫', map: '⌖', sos: '✳', contacts: '♧', journey: '⌁',
  notifications: '♧', offline: '◉', settings: '⚙', shield: '◇',
  battery: '▣', signal: '▥', route: '⌁', check: '✓', plus: '+',
  close: '×', pin: '●', share: '↗', bell: '♧', lock: '▣',
};

const defaultContacts = [
  { name: 'Aarav Sharma', relation: 'Sample contact · brother', phone: 'Sample only', initials: 'AS', color: 'violet' },
  { name: 'Priya Mehta', relation: 'Sample contact · friend', phone: 'Sample only', initials: 'PM', color: 'pink' },
  { name: 'Neha Kapoor', relation: 'Sample contact · family', phone: 'Sample only', initials: 'NK', color: 'blue' },
];

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
  landingTab: 'journey',
  workflowStep: 1,
  landingLayers: { zones: true, contacts: true, route: true },
  fallbackOffline: false,
  page: 'dashboard',
  contacts: readStored('suraksha-contacts', defaultContacts),
  preferences: readStored('suraksha-preferences', {
    shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true,
  }),
  offline: readStored('suraksha-offline', false),
  notifications: readStored('suraksha-notifications', [
    { title: 'Sample check-in', detail: 'Illustrative check-in entry. No one was notified.', time: 'Demo', icon: '✓', unread: true },
    { title: 'Sample journey', detail: 'Example route only. No contact is monitoring it.', time: 'Demo', icon: '♧', unread: true },
    { title: 'Safety interface preview', detail: 'Contacts and alerts are not connected in this demo.', time: 'Demo', icon: '◇', unread: false },
  ]),
  journeyActive: true,
  journeyProgress: 65,
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
      offline: state.offline, notifications: state.notifications,
    }).catch((error) => {
      console.error('Unable to sync safety data with Supabase', error);
      toast('Saved on this device; cloud sync failed. Check your connection.');
    });
  }
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
  const displayName = state.user?.fullName || state.user?.firstName || 'Personal account';
  return `<aside class="sidebar">
    <a class="brand" href="#" data-page="dashboard" aria-label="Suraksha 360 home">
      <img class="brand-mark-image" src="/suraksha-360-mark.webp" alt="" />
      <span class="brand-copy"><b>SURAKSHA 360</b><small>PERSONAL SAFETY GRID</small></span>
    </a>
    <div class="sidebar-caption">YOUR SPACE</div>
    <nav class="primary-nav">${navItems.map(navButton).join('')}</nav>
    <div class="sidebar-bottom">
      <div class="network-card"><span class="network-indicator"></span><div><b>Safety preview</b><small>${state.offline ? 'Offline UI simulation' : 'Demo mode · no live services'}</small></div></div>
      <div class="profile"><div class="avatar avatar-user">${escapeHtml(displayName[0] || 'U')}</div><div class="profile-copy"><b>${escapeHtml(displayName)}</b><small>${escapeHtml(state.user?.primaryEmailAddress?.emailAddress || 'Personal account')}</small></div><button class="icon-button" data-action="profile-menu" aria-label="Profile options">···</button></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <button class="mobile-menu icon-button" data-action="menu" aria-label="Open menu">☰</button>
      <div class="breadcrumb"><span>Suraksha 360</span><span class="crumb-sep">/</span><b>${pageTitle()}</b></div>
      <div class="top-actions">
        <div class="secure-pill"><span class="network-indicator"></span> Preview mode</div>
        <button class="icon-button notification-button" data-page="notifications" aria-label="Notifications">♧${unread ? `<i>${unread}</i>` : ''}</button>
        <button class="top-sos" data-action="sos"><span>✳</span> Emergency SOS</button>
      </div>
    </header>
    <section class="page-content">${content}</section>
  </main>
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
  const journey = state.journeyActive
    ? `<div class="journey-topline"><span class="eyebrow"><i class="purple-dot"></i> SAMPLE JOURNEY</span><span class="eta-pill">Preview · 18 min</span></div>
      <h2>Sample route to Downtown Metro</h2><p class="muted">Illustrative journey preview. Live GPS and contact notifications are not connected.</p>
      <div class="map-preview"><div class="map-grid"></div><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-road road-three"></div>
        <span class="map-label label-park">RIVERSIDE GARDENS</span><span class="map-label label-street">PARK AVENUE</span>
        <span class="map-pin start-pin">⌂</span><span class="map-pin end-pin">M</span><span class="map-route"></span>
        <span class="map-tag"><i class="purple-dot"></i> Sample route · not live</span>
      </div>
      <div class="journey-footer"><div class="progress-label"><span>Route progress</span><b>${state.journeyProgress}%</b></div><div class="progress-track"><span style="width:${state.journeyProgress}%"></span></div>
        <div class="journey-actions"><button class="button button-quiet" data-action="share-journey">↗ <span>Share preview</span></button><button class="button button-primary" data-action="checkin">✓ <span>Preview check-in</span></button></div>
      </div>`
    : `<div class="empty-journey"><div class="empty-icon">⌁</div><h2>No sample journey active</h2><p class="muted">Create an illustrative journey preview. Live tracking and notifications are not connected.</p><button class="button button-primary" data-page="journey">Plan a safe journey <span>→</span></button></div>`;

  return `<div class="welcome-row"><div><div class="eyebrow"><span class="live-pulse"></span> PERSONAL SAFETY DASHBOARD · PREVIEW</div><h1>Welcome${state.user?.firstName ? `, ${escapeHtml(state.user.firstName)}` : ''} <span>✦</span></h1><p class="muted">Explore your safety tools. Emergency and location services are not connected in this preview.</p></div><button class="button button-quiet date-button" data-action="refresh">⌁ <span>Refresh status</span></button></div>
    <div class="status-grid">
      ${statusCard('◇', 'SAFETY TOOLS', 'Preview mode', `${state.contacts.length} sample contacts`, '<span class="status-badge">DEMO</span>')}
      ${statusCard('▣', 'DEVICE BATTERY', 'Not connected', 'Device status unavailable', '<span class="battery-meter"><i></i></span>')}
      ${statusCard('⌖', 'LOCATION', 'Not connected', 'Live GPS unavailable', '<span class="signal-bars"><i></i><i></i><i></i><i></i></span>')}
    </div>
    <div class="dashboard-grid">
      <article class="card sos-card"><div class="card-heading"><div><span class="eyebrow danger-text">EMERGENCY OVERRIDE</span><h2>Need help?</h2></div><span class="alert-icon">!</span></div>
        <p class="muted">Preview the SOS confirmation flow. No real alert or location is sent.</p>
        <button class="sos-orb" data-action="sos" aria-label="Open emergency SOS demo"><span>✳</span><b>SOS</b><small>DEMO ONLY</small></button>
        <div class="sos-secure"><span>▣</span> Simulation · no dispatch <i class="network-indicator"></i></div>
      </article>
      <article class="card journey-card">${journey}</article>
    </div>
    <div class="lower-grid">
      <article class="card quick-card"><div class="section-heading"><div><h2>Quick actions</h2><p class="muted">Your safety tools, one tap away.</p></div></div>
        <button class="quick-link" data-page="contacts"><span class="quick-icon violet-icon">♧</span><span><b>Trusted contacts</b><small>${state.contacts.length} people in your circle</small></span><i>›</i></button>
        <button class="quick-link" data-page="map"><span class="quick-icon blue-icon">⌖</span><span><b>Safety map preview</b><small>Explore illustrative map layers</small></span><i>›</i></button>
        <button class="quick-link" data-action="audio"><span class="quick-icon pink-icon">◖</span><span><b>Check-in timer preview</b><small>Start a local demo timer</small></span><i>›</i></button>
        <div class="audio-status"><span>Check-in timer</span><b><i class="network-indicator"></i> Demo only</b></div>
      </article>
      <article class="card activity-card"><div class="section-heading"><div><h2>Recent activity</h2><p class="muted">Your latest safety updates.</p></div><button class="text-button" data-page="notifications">See all <span>→</span></button></div>
        <div class="activity-list">
          ${activityRow('✓', 'Sample check-in', 'Illustrative check-in entry · no one was notified.', 'Demo', 'activity-green')}
          ${activityRow('⌁', 'Sample journey', 'Downtown Metro · preview route only.', 'Demo', 'activity-violet')}
          ${activityRow('⌖', 'Location preview', 'Live location is unavailable in this demo.', 'Demo', 'activity-blue')}
        </div>
      </article>
    </div>`;
}

function activityRow(icon, title, detail, time, style) {
  return `<div class="activity-row"><span class="activity-icon ${style}">${icon}</span><div class="activity-copy"><b>${title}</b><small>${detail}</small></div><time>${time}</time></div>`;
}

function mapPage() {
  return `<div class="page-intro"><div><div class="eyebrow">ILLUSTRATIVE MAP · DEMO ONLY</div><h1>Safety map preview</h1><p class="muted">Sample map artwork only. This page does not access or share your location.</p></div><button class="button button-quiet" data-action="locate">⌖ <span>Map preview</span></button></div>
    <div class="map-layout"><section class="card large-map"><div class="map-toolbar"><span class="live-pill"><i class="live-pulse"></i> SAMPLE MAP · NOT LIVE</span><button class="icon-button map-layer" data-action="layers">▤</button></div>
      <div class="map-canvas" id="large-map"><div class="map-grid"></div><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-road road-three"></div><div class="map-road road-four"></div>
        <span class="map-label map-label-a">RIVERSIDE GARDENS</span><span class="map-label map-label-b">PARK AVENUE</span><span class="map-label map-label-c">EAST VILLAGE</span><span class="map-label map-label-d">CENTRAL ST.</span>
        <span class="safe-zone safe-zone-one"></span><span class="safe-zone safe-zone-two"></span><span class="map-pin you-pin">●<small>SAMPLE</small></span><span class="contact-pin contact-pin-one">A</span><span class="contact-pin contact-pin-two">P</span>
        <div class="map-controls"><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button></div><div class="map-attribution">Illustrative map · not for navigation</div>
      </div>      <div class="map-legend"><span><i class="legend-dot you"></i>Sample location</span><span><i class="legend-dot safe"></i>Illustrative zones</span><span><i class="legend-dot contact"></i>Sample contacts</span></div>
    </section><aside class="map-side"><article class="card location-card"><span class="eyebrow">LOCATION STATUS</span><h3>Live location unavailable</h3><p class="muted">The map below is illustrative and does not represent your current position.</p><div class="coordinates">Sample map · no coordinates</div><div class="location-meta"><span>⌖ GPS access</span><b>Not connected</b></div><button class="button button-primary full-button" data-action="share-location">↗ <span>Preview sharing options</span></button></article>
      <article class="card"><div class="section-heading"><div><h2>Sample safety circle</h2><p class="muted">Demo contacts only; nobody can see this map.</p></div><button class="text-button" data-page="contacts">Manage</button></div><div class="mini-contact-list">${state.contacts.slice(0, 3).map((person) => `<div class="mini-contact"><div class="avatar avatar-${person.color}">${escapeHtml(person.initials)}</div><div><b>${escapeHtml(person.name)}</b><small>Saved on this device</small></div><span class="online-dot"></span></div>`).join('')}</div></article>
      <article class="card map-share-card"><span class="map-share-icon">◇</span><div><b>Location sharing preference</b><small>Demo setting only; location is not being accessed.</small></div><button class="switch ${state.preferences.shareLocation ? 'on' : ''}" data-pref="shareLocation" aria-label="Toggle location sharing preference"><i></i></button></article>
    </aside></div>`;
}

function journeyPage() {
  return `<div class="page-intro"><div><div class="eyebrow">SAMPLE JOURNEY · PREVIEW</div><h1>Journey guardian</h1><p class="muted">Explore journey planning and check-in controls. No live tracking or notifications are connected.</p></div><button class="button button-primary" data-action="new-journey">＋ <span>Plan a journey</span></button></div>
    <div class="journey-page-grid"><section class="card journey-detail-card">${state.journeyActive ? `<div class="journey-topline"><span class="live-pill"><i class="live-pulse"></i> SAMPLE JOURNEY</span><span class="eta-pill">Preview · 18 min</span></div><h2>Sample route to Downtown Metro</h2><p class="muted">Illustrative route only. Contacts have not been notified.</p><div class="map-preview journey-large-preview"><div class="map-grid"></div><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-road road-three"></div><span class="map-label label-park">SAMPLE MAP</span><span class="map-pin start-pin">⌂</span><span class="map-pin end-pin">M</span><span class="map-route"></span></div><div class="progress-label"><span>Sample route progress · 2.4 of 3.8 km</span><b>${state.journeyProgress}%</b></div><div class="progress-track"><span style="width:${state.journeyProgress}%"></span></div><div class="journey-actions"><button class="button button-quiet" data-action="share-journey">↗ <span>Share preview</span></button><button class="button button-primary" data-action="checkin">✓ <span>Preview check-in</span></button><button class="button button-danger-quiet" data-action="end-journey">End preview</button></div>` : `<div class="empty-journey"><div class="empty-icon">⌁</div><h2>Ready to preview</h2><p class="muted">Create an illustrative journey and explore its check-in flow.</p><button class="button button-primary" data-action="new-journey">Plan a safe journey</button></div>`}</section>
    <aside class="journey-sidebar"><article class="card"><div class="section-heading"><div><h2>Journey preview</h2><p class="muted">Simulated interface controls.</p></div></div><div class="safety-list"><div><span class="quick-icon violet-icon">⌖</span><span><b>Location sharing</b><small>GPS is not connected</small></span><i class="network-indicator"></i></div><div><span class="quick-icon blue-icon">⌁</span><span><b>Route alerts</b><small>Demo only · no alerts sent</small></span><i class="network-indicator"></i></div><div><span class="quick-icon pink-icon">✓</span><span><b>Arrival check-in</b><small>Local interface simulation</small></span><i class="network-indicator"></i></div></div></article><article class="card"><div class="section-heading"><div><h2>Sample contacts</h2><p class="muted">Saved locally · not notified</p></div><span class="count-pill">${state.contacts.length}</span></div><div class="mini-contact-list">${state.contacts.map((person) => `<div class="mini-contact"><div class="avatar avatar-${person.color}">${escapeHtml(person.initials)}</div><div><b>${escapeHtml(person.name)}</b><small>Not connected</small></div><span class="online-dot"></span></div>`).join('')}</div></article></aside></div>`;
}

function contactsPage() {
  return `<div class="page-intro"><div><div class="eyebrow">LOCAL CONTACT MANAGEMENT</div><h1>Trusted contacts</h1><p class="muted">Manage contact details saved in this browser or your configured account. This demo does not send alerts or pings.</p></div><button class="button button-primary" data-action="add-contact">＋ <span>Add a contact</span></button></div>
    <div class="contact-summary"><div class="summary-icon">♧</div><div><b>Contacts saved for preview</b><small>${state.contacts.length} ${state.contacts.length === 1 ? 'person' : 'people'} saved. Emergency notifications are not connected.</small></div><span class="status-badge">DEMO ONLY</span></div>
    <div class="contact-grid">${state.contacts.map((person, index) => `<article class="card contact-card"><div class="contact-card-top"><div class="avatar avatar-large avatar-${person.color}">${escapeHtml(person.initials)}</div><button class="icon-button" data-action="contact-menu" data-index="${index}" aria-label="Contact options">···</button></div><h2>${escapeHtml(person.name)}</h2><p class="muted">${escapeHtml(person.relation)}</p>${person.phone === 'Sample only' ? '<span class="contact-phone">☎ &nbsp;Sample only · not callable</span>' : `<a class="contact-phone" href="tel:${escapeHtml(person.phone.replace(/[^\d+]/g, ''))}">☎ &nbsp;${escapeHtml(person.phone)}</a>`}<div class="contact-card-bottom"><span><i class="online-dot"></i> Saved locally</span><button class="text-button" data-action="ping-contact" data-index="${index}">Preview ping ↗</button></div></article>`).join('')}
      <button class="card add-contact-card" data-action="add-contact"><span class="add-contact-icon">＋</span><b>Add someone you trust</b><small>Save a contact for your local preview.</small></button>
    </div><p class="privacy-note">Contact details are saved locally or to your configured account. The demo does not use them to deliver alerts.</p>`;
}

function notificationsPage() {
  return `<div class="page-intro"><div><div class="eyebrow">LOCAL DEMO ACTIVITY</div><h1>Notifications</h1><p class="muted">Illustrative entries and locally simulated actions. No external notifications are delivered.</p></div><button class="button button-quiet" data-action="mark-read">✓ <span>Mark all as read</span></button></div>
    <div class="notification-filters"><button class="filter-chip selected" data-filter="all">All activity</button><button class="filter-chip" data-filter="unread">Unread <span>${state.notifications.filter((item) => item.unread).length}</span></button></div>
    <section class="card notification-list">${state.notifications.length ? state.notifications.map((item, index) => `<article class="notification-row ${item.unread ? 'unread' : ''}" data-notification="${index}"><span class="activity-icon ${index % 2 ? 'activity-violet' : 'activity-green'}">${item.icon}</span><div class="notification-copy"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.time)}</small></div>${item.unread ? '<i class="notification-unread-dot"></i>' : ''}</article>`).join('') : '<div class="empty-state"><span>✓</span><h2>You’re all caught up</h2><p class="muted">New safety updates will show up here.</p></div>'}</section>`;
}

function offlinePage() {
  return `<div class="page-intro"><div><div class="eyebrow">OFFLINE INTERFACE SIMULATION</div><h1>Offline readiness preview</h1><p class="muted">Explore a visual concept only. Bluetooth, mesh networking, and background messaging are not implemented.</p></div><span class="large-status ${state.offline ? 'enabled' : ''}"><i></i>${state.offline ? 'DEMO ACTIVE' : 'PREVIEW'}</span></div>
    <section class="card offline-hero"><div class="offline-visual"><div class="mesh-ring ring-one"></div><div class="mesh-ring ring-two"></div><div class="mesh-core">⌁</div><span class="mesh-node node-one">S</span><span class="mesh-node node-two">A</span><span class="mesh-node node-three">P</span></div>
      <div class="offline-copy"><span class="eyebrow">CONCEPT PREVIEW</span><h2>${state.offline ? 'Offline interface demo on.' : 'Explore offline readiness.'}</h2><p class="muted">This button changes the page’s demo state only. It does not activate Bluetooth, send a beacon, or connect nearby devices.</p><div class="offline-metrics"><span><b>${state.offline ? 'Sample' : '—'}</b><small>Nearby devices</small></span><span><b>${state.offline ? 'Demo' : 'Inactive'}</b><small>Beacon status</small></span><span><b>Not connected</b><small>Network type</small></span></div><button class="button ${state.offline ? 'button-quiet' : 'button-primary'}" data-action="toggle-offline">${state.offline ? '◉ <span>End interface simulation</span>' : '⌁ <span>Simulate offline mode</span>'}</button></div>
    </section><div class="offline-info-grid"><article class="card"><span class="quick-icon violet-icon">▣</span><h3>Security concept</h3><p class="muted">Encryption is not implemented by this interface preview.</p></article><article class="card"><span class="quick-icon blue-icon">⌁</span><h3>Network status</h3><p class="muted">No Bluetooth or offline messaging is connected.</p></article><article class="card"><span class="quick-icon pink-icon">◇</span><h3>Your controls</h3><p class="muted">Explore the local demo state without sending data.</p></article></div>`;
}

function settingsPage() {
  const options = [
    ['shareLocation', 'Location sharing preference', 'A saved demo preference only; live location sharing is not connected.', '⌖'],
    ['journeyAlerts', 'Journey alert preference', 'A saved preference only; no alerts or route monitoring are sent.', '⌁'],
    ['discreetMode', 'Discreet mode', 'Keep safety alerts quiet and hide notification previews on your screen.', '◉'],
    ['soundAlerts', 'Sound and haptic alerts', 'Use sound and vibration for important safety check-ins.', '♧'],
  ];
  return `<div class="page-intro"><div><div class="eyebrow">YOUR SAFETY, YOUR CHOICES</div><h1>Privacy & settings</h1><p class="muted">Manage preferences saved locally or to your configured account. Safety integrations remain in preview mode.</p></div><button class="button button-quiet" data-action="reset-settings">↺ <span>Reset preferences</span></button></div>
    <div class="settings-layout"><section class="card settings-card"><div class="section-heading"><div><h2>Safety preferences</h2><p class="muted">${backendConfigured ? 'Changes sync to your private account.' : 'Changes are saved on this device.'}</p></div></div>
      ${options.map(([key, title, description, icon]) => `<div class="setting-row"><span class="setting-icon">${icon}</span><div class="setting-copy"><b>${title}</b><small>${description}</small></div><button class="switch ${state.preferences[key] ? 'on' : ''}" data-pref="${key}" role="switch" aria-checked="${state.preferences[key]}" aria-label="${title}"><i></i></button></div>`).join('')}
      <div class="setting-row"><span class="setting-icon">♧</span><div class="setting-copy"><b>Trusted contacts</b><small>${state.contacts.length} people are in your safety circle.</small></div><button class="text-button" data-page="contacts">Manage →</button></div>
    </section><aside class="settings-aside"><article class="card privacy-card"><span class="privacy-shield">◇</span><h2>Your privacy matters</h2><p class="muted">Your location and safety data stay yours. You decide when to share and who can see it.</p><button class="text-button" data-action="privacy-info">Learn about privacy →</button></article><article class="card settings-account"><span class="eyebrow">ACCOUNT</span><h3>${escapeHtml(state.user?.fullName || state.user?.firstName || 'Samira Khan')}</h3><p class="muted">${escapeHtml(state.user?.primaryEmailAddress?.emailAddress || 'samira.khan@example.com')}</p><button class="button button-quiet full-button" data-action="signout">Sign out</button></article></aside></div>`;
}

function sosPage() {
  return `<div class="sos-page"><div class="sos-page-heading"><span class="eyebrow danger-text">SOS INTERFACE PREVIEW</span><h1>Emergency SOS</h1><p class="muted">This page is a demonstration only. If you’re in immediate danger, contact your local emergency number directly.</p></div><article class="card sos-main-card"><div class="sos-emblem">✳</div><div class="eyebrow danger-text">SIMULATED FLOW · NO DISPATCH</div><h2>Preview an SOS alert</h2><p class="muted">Explore the confirmation flow for ${state.contacts.length} locally saved contacts. This demo will not send an alert or access your location.</p><button class="sos-confirm-button" data-action="confirm-sos">✳ &nbsp; PREVIEW SOS ALERT</button><div class="sos-disclaimer">No alert, location, or message will be sent</div></article>
      <div class="sos-help-grid"><article class="card"><span class="quick-icon violet-icon">♧</span><div><b>Sample contacts</b><small>${state.contacts.length} contacts saved locally</small></div><button class="text-button" data-page="contacts">View →</button></article><article class="card"><span class="quick-icon blue-icon">⌖</span><div><b>Location preference</b><small>${state.preferences.shareLocation ? 'Enabled for demo only' : 'Paused for demo'}</small></div><button class="text-button" data-page="settings">Settings →</button></article></div>
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
  const tabContent = {
    journey: `<span class="preview-label">SAMPLE JOURNEY · PREVIEW</span><h3>Sample destination: Downtown Metro</h3><p>Illustrative route · estimated time: 18 min</p><div class="preview-checkin"><span class="checkin-icon">✓</span><div><b>Sample check-in</b><small>No one is notified</small></div><span class="checkin-time">DEMO</span></div><button class="preview-action" data-action="preview-checkin">✓ &nbsp; Preview safe check-in <span>+15 min</span></button><div class="preview-timeline"><span>✓ &nbsp; Sample journey started <small>Illustrative origin</small></span><span>⌖ &nbsp; Sample route point <small>Preview only</small></span><span>◷ &nbsp; Arrival check-in <small>Not connected</small></span></div>`,
    contacts: `<span class="preview-label">SAMPLE CONTACTS</span><h3>People in your corner</h3><p>Local contact list preview. No one is connected or notified.</p><div class="preview-contacts">${state.contacts.slice(0, 3).map((person) => `<div><span class="preview-avatar">${escapeHtml(person.initials)}</span><b>${escapeHtml(person.name)}</b><small>${escapeHtml(person.relation)}</small><i>●</i></div>`).join('')}</div><button class="preview-action secondary-preview-action" data-action="add-contact">＋ &nbsp; Add a contact</button>`,
    sos: `<span class="preview-label">EMERGENCY SOS · SIMULATION</span><h3>Help is one tap away</h3><p>Preview the alert confirmation. This demo will not contact real people or emergency services.</p><div class="preview-sos-note">✳ &nbsp; No real alert will be sent</div><button class="preview-sos-button" data-action="landing-sos">✳ &nbsp; Preview SOS alert</button>`,
    network: `<span class="preview-label">DEVICE CONNECTIVITY · PREVIEW</span><h3>${state.fallbackOffline ? 'Offline UI simulation on' : 'Connectivity preview'}</h3><p>This does not read your actual network or phone status.</p><div class="preview-network-stats"><div><span>NETWORK</span><b>Not connected</b></div><div><span>QUEUED ITEMS</span><b>${state.fallbackOffline ? 'Sample only' : 'None'}</b></div><div><span>LOCAL UI</span><b>Available</b></div></div><button class="preview-action secondary-preview-action" data-action="offline-simulation">${state.fallbackOffline ? '◉ &nbsp; End UI simulation' : '◉ &nbsp; Simulate offline mode'}</button>`,
  };
  const pillars = [
    ['✳', '01', 'Emergency SOS', 'A clear confirmation flow for alerting your chosen trusted circle.'],
    ['⌖', '02', 'Location sharing', 'A preview of location-sharing controls. Live GPS is not connected in this demo.'],
    ['♧', '03', 'Trusted contacts', 'Keep the people you choose together in one safety circle.'],
    ['⌁', '04', 'Journey check-ins', 'Plan a trip and use check-ins to follow its progress.'],
    ['◉', '05', 'Offline readiness', 'Explore an offline-mode simulation without relying on a real network.'],
    ['↗', '06', 'Your control', 'Review the settings and decide how you want the experience to work.'],
  ];
  const features = [
    ['✳', 'Emergency SOS', 'A deliberate confirmation step helps prevent accidental alerts.'],
    ['⌖', 'Location sharing', 'Choose when to share a location with people you trust.'],
    ['♧', 'Trusted circle', 'Add and manage the people you want in your safety circle.'],
    ['⌁', 'Journey check-ins', 'Plan a trip, view the sample route, and check in along the way.'],
    ['◉', 'Offline readiness', 'Review a local interface simulation for low-connectivity situations.'],
    ['⚙', 'Privacy & controls', 'Review your privacy choices and adjust the dashboard preferences.'],
  ];
  const steps = [
    ['01', 'Quick setup', 'Choose how you want to use your safety dashboard.'],
    ['02', 'Add contacts', 'Build a trusted circle with people you know.'],
    ['03', 'Start a journey', 'Plan a trip and review the sample check-in flow.'],
    ['04', 'Check in', 'Confirm your arrival and close the journey.'],
  ];
  const workflow = steps[state.workflowStep - 1];
  const questions = [
    ['What is Suraksha 360?', 'This project is a front-end preview of a personal safety dashboard, including sample contacts, journeys, privacy controls, and simulated alerts.'],
    ['Does the SOS button contact emergency services?', 'No. The current SOS experience is a simulation only. It does not notify contacts, dispatch emergency services, or send your location. In an emergency, contact your local emergency number directly.'],
    ['Does the map show my live location?', 'No. The map on this landing page is illustrative. Live GPS and real route tracking are not connected in this demo.'],
    ['Can I add trusted contacts?', 'Yes. In the interactive preview you can add sample contacts locally. They are not contacted by the preview.'],
    ['What happens in offline mode?', 'The landing page can show a UI simulation, but background messaging and offline dispatch are not implemented.'],
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
        <div class="hero-meta"><span>✿ &nbsp; PERSONAL SAFETY PLATFORM · PROGRESSIVE WEB APP (PWA)</span><span>RELEASE 1.0 · PREVIEW</span><span>⌖ GPS PREVIEW &nbsp; · &nbsp; BATTERY PREVIEW</span></div>
        <div class="reference-hero-grid"><div class="reference-copy"><span class="reference-kicker">✦ &nbsp; YOUR SAFETY, YOUR WAY</span>
          <h1>Your Safety.<br><span>Your Connection.</span><br>Your Control.</h1>
          <p>Stay connected to the people you trust. Plan safer journeys, share your location when needed, and access emergency support with Suraksha 360.</p>
          <div class="reference-actions"><button class="reference-cta large-cta" data-action="get-started">Get started <span>→</span></button><a class="reference-secondary" href="#features">⌁ &nbsp; Explore features</a><button class="reference-demo-link" data-action="scroll-preview">▷ &nbsp; Live demo</button></div>
          <div class="reference-metrics"><div><b>In-app</b><small>Dashboard preview</small></div><div><b>Your choice</b><small>Privacy settings</small></div><div><b>Simulated</b><small>Safety actions</small></div></div>
        </div>
        <div class="hud-card"><div class="hud-top"><span><i></i> SURAKSHA-OS HUD</span><b>PREVIEW MODE</b></div><div class="hud-orb"><div class="hud-ring ring-a"></div><div class="hud-ring ring-b"></div><span class="hud-shield">◇</span><span class="hud-status">DEMO CIRCLE</span></div>
          <div class="hud-contacts"><div><span class="hud-avatar">AS</span><span><b>Aarav Sharma</b><small>Sample contact</small></span><i></i></div><div><span class="hud-avatar hud-avatar-rose">PM</span><span><b>Priya Mehta</b><small>Sample contact</small></span><i></i></div></div>
          <div class="hud-foot"><span>✳ &nbsp; SOS preview only</span><button data-action="landing-sos">Preview alert</button></div>
        </div></div>
        <div class="reference-note">Preview only: this page does not send emergency alerts or track live location.</div>
      </div>
    </section>
    <section class="command-section" id="dashboard-preview"><div class="reference-container"><div class="section-title-row"><div><span class="reference-kicker">ACTIVE COMMAND INTERFACE</span><h2>Interactive Safety Dashboard</h2><p>Explore sample controls for a journey, trusted circle, emergency flow, and connection status.</p></div><span class="preview-chip"><i></i> Simulated preview · Sample data</span></div>
      <div class="command-tabs" role="tablist">${tabs.map(([key, icon, label]) => `<button role="tab" aria-selected="${state.landingTab === key}" class="${state.landingTab === key ? 'selected' : ''}" data-landing-tab="${key}"><span>${icon}</span>${label}</button>`).join('')}</div>
      <div class="command-grid"><article class="command-panel">${tabContent[state.landingTab]}</article><article class="route-preview"><div class="route-preview-head"><span>⌖ &nbsp; ROUTE PREVIEW</span><span><i></i> SAMPLE MAP</span></div><div class="route-map"><div class="route-grid"></div><span class="route-label">RIVERSIDE PARK</span><span class="route-label route-label-two">DOWNTOWN</span><span class="route-road road-a"></span><span class="route-road road-b"></span><span class="route-road road-c"></span><span class="route-dash"></span><span class="route-point point-a">S</span><span class="route-point point-b">M</span><span class="route-legend"><i></i> Sample route · not live</span></div><div class="route-coords"><span>MAP DATA <b>Illustrative</b></span><span>LIVE GPS <b>Not connected</b></span></div></article></div>
      <div class="command-disclaimer">ⓘ &nbsp; Preview controls are simulations only. They do not dispatch alerts, share live coordinates, or contact services.</div>
    </div></section>
    <section class="reference-features" id="features"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">DESIGNED AROUND YOUR PEACE OF MIND</span><h2>Six thoughtful safety tools</h2><p>A clear, connected place to explore everyday safety features.</p></div><div class="pillar-grid">${pillars.map(([icon,n,title,desc], index) => `<article class="pillar-card" data-feature-preview="${['sos','location','contacts','journey','offline','privacy'][index]}" tabindex="0"><div class="pillar-top"><span class="pillar-icon">${icon}</span><b>${n}</b></div><h3>${title}</h3><p>${desc}</p><button data-feature-preview="${['sos','location','contacts','journey','offline','privacy'][index]}">Learn more <span>→</span></button></article>`).join('')}</div></div></section>
    <section class="workflow-section" id="how-it-works"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">A SIMPLE FLOW</span><h2>How Suraksha 360 works</h2><p>Choose a step to preview how the experience fits together.</p></div><div class="workflow-tabs">${steps.map(([n,title]) => `<button class="${state.workflowStep === Number(n) ? 'selected' : ''}" data-workflow-step="${n}"><span>STEP ${n}</span><b>${title}</b></button>`).join('')}</div><article class="workflow-detail"><div><span class="reference-kicker">STEP ${workflow[0]} · PREVIEW</span><h3>${workflow[1]}</h3><p>${workflow[2]}</p><button class="reference-secondary" data-action="workflow-next">Next step <span>→</span></button></div><div class="workflow-visual"><span class="workflow-mark">${workflow[0]}</span><div><b>${workflow[1]}</b><small>This is a product preview, not an active safety service.</small></div><span class="workflow-lock">◇</span></div></article></div></section>
    <section class="technology-section" id="technology"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">CLEAR ABOUT THE TECHNOLOGY</span><h2>Safety tools without the guesswork</h2><p>See what this preview can do today—and what still needs a real integration.</p></div><div class="technology-grid">    <div class="technology-list">${features.map(([icon,title,desc]) => `<article><span>${icon}</span><div><b>${title}</b><small>${desc}</small></div></article>`).join('')}</div><aside class="transparency-card"><span class="reference-kicker">♡ &nbsp; TRANSPARENCY NOTICE</span><h3>What this demo does—and doesn’t do</h3><p>This website is a front-end prototype. Sample map positions, connection indicators, and safety actions are illustrative.</p><ul><li>Emergency actions do not contact emergency services.</li><li>Live GPS, background tracking, and SMS or WhatsApp delivery are not connected.</li><li>Review authentication and database policies before storing real personal data.</li></ul><b class="transparency-status">PREVIEW STATUS &nbsp;·&nbsp; SIMULATED CONTROLS</b></aside></div></div></section>
    <section class="reference-map-section" id="interactive-map"><div class="reference-container"><div class="section-title-row"><div><span class="reference-kicker">A SPATIAL PREVIEW</span><h2>Explore the sample safety map</h2><p>Toggle map layers to explore the illustrative map interface.</p></div><span class="preview-chip"><i></i> Not live location</span></div><div class="map-demo-card"><div class="map-demo-toolbar">${[['zones','Safe zones'],['contacts','Trusted contacts'],['route','Sample route']].map(([key,title]) => `<button class="map-layer-chip ${state.landingLayers[key] ? 'selected' : ''}" aria-pressed="${state.landingLayers[key]}" data-layer="${key}"><i></i>${title}</button>`).join('')}<button class="recenter-button" data-action="recenter-map">⌖ &nbsp; Recenter</button></div><div class="map-demo-canvas"><div class="route-grid"></div><span class="map-demo-label label-park">RIVERSIDE GARDENS</span><span class="map-demo-label label-main">PARK AVENUE</span><span class="route-road map-road-one"></span><span class="route-road map-road-two"></span><span class="route-road map-road-three"></span>${state.landingLayers.zones ? '<span class="demo-safe-zone"></span><span class="demo-safe-label">SAMPLE SAFE ZONE</span>' : ''}${state.landingLayers.route ? '<span class="demo-route-line"></span>' : ''}<span class="demo-you">S</span>${state.landingLayers.contacts ? '<span class="demo-contact">P</span>' : ''}<span class="demo-destination">M</span><span class="map-demo-legend"><i></i> Illustrative map · not for navigation</span></div><div class="map-demo-footer"><span>LOCATION <b>Sample coordinates only</b></span><span>ROUTE STATUS <b>Preview mode</b></span><button class="reference-sos-small" data-action="landing-sos">✳ &nbsp; Preview SOS</button></div></div></div></section>
    <section class="privacy-section" id="privacy-controls"><div class="reference-container privacy-grid"><div><span class="reference-kicker">YOUR PRIVACY, YOUR CHOICE</span><h2>Control what you share.</h2><p>Review the privacy settings in the app preview. Live location sharing is not active on this landing page.</p><div class="privacy-checks"><span>◇ &nbsp; Demo contacts are not notified</span><span>◇ &nbsp; Sample map is not live GPS</span><span>◇ &nbsp; SOS is not dispatched</span></div></div><article class="privacy-action-card"><span class="privacy-card-icon">▣</span><div><b>Preview privacy controls</b><small>Open the dashboard settings to explore sharing preferences.</small></div><button data-action="open-settings">Review settings <span>→</span></button></article></div></section>
    <section class="offline-section"><div class="reference-container"><div class="centered-heading"><span class="reference-kicker">LOCAL PREVIEW</span><h2>Explore an offline-mode simulation</h2><p>See how the interface might present a connection change. This does not change your device network.</p></div><article class="offline-demo-card"><div class="offline-demo-icon">⌁</div><div class="offline-demo-copy"><b>${state.fallbackOffline ? 'Offline simulation enabled' : 'Connection preview'}</b><small>${state.fallbackOffline ? 'Sample queued item shown · no message is being sent' : 'Preview controls are available · no device status is read'}</small></div><span class="offline-demo-status">${state.fallbackOffline ? 'SIMULATED OFFLINE' : 'PREVIEW'}</span><button class="reference-secondary" data-action="offline-simulation">${state.fallbackOffline ? 'Turn simulation off' : 'Try offline simulation'}</button></article></div></section>
    <section class="faq-section" id="faq"><div class="reference-container faq-container"><div class="centered-heading"><span class="reference-kicker">CLEAR ANSWERS</span><h2>Frequently asked questions</h2><p>What to know about this prototype and its safety features.</p></div><div class="faq-list">${questions.map(([question,answer]) => `<details><summary>${question}<span>＋</span></summary><p>${answer}</p></details>`).join('')}</div></div></section>
    <section class="reference-cta-section"><div class="reference-container reference-cta-inner"><span class="reference-kicker">A LITTLE MORE PEACE OF MIND</span><h2>Protect what matters most.</h2><p>Explore the Suraksha 360 dashboard preview and see how a trusted safety circle can fit into your day.</p><div><button class="reference-cta large-cta" data-action="get-started">Create your account <span>→</span></button><button class="reference-sos-small" data-action="view-demo">Open dashboard preview</button></div><small>Preview only · Emergency services are not contacted</small></div></section>
    <footer class="reference-footer"><div class="reference-container"><div class="footer-main"><a class="reference-brand footer-brand" href="#top" aria-label="Suraksha 360 home"><img class="brand-wordmark" src="/suraksha-360-logo.webp" alt="Suraksha 360 — Personal Safety Grid" /></a><span>Built for a little more peace of mind. ♡</span><span>© 2026 Suraksha 360 · Product preview</span></div><p>Suraksha 360 is a prototype. Sample data is illustrative; do not rely on this preview for emergency response or real-time tracking.</p></div></footer>
    <div id="toast-region" role="status" aria-live="polite"></div><div id="modal-root"></div>
  </main>`;
}

function render() {
  if (!state.authenticated) {
    if (state.screen !== 'login' || !backendConfigured) {
      document.querySelector('#app').innerHTML = landingPage();
      setupLandingEffects();
      return;
    }
    const creating = state.authMode === 'signup';
    document.querySelector('#app').innerHTML = `<main class="auth-screen"><section class="auth-card"><button class="back-to-landing" data-action="back-landing">← Back to home</button><a class="brand auth-brand" href="#" data-action="landing-home" aria-label="Suraksha 360 home"><img class="brand-wordmark" src="/suraksha-360-logo.webp" alt="Suraksha 360 — Personal Safety Grid" /></a><div class="eyebrow">YOUR SAFETY, CONNECTED</div><h1>${creating ? 'Create your account' : 'Welcome to Suraksha 360'}</h1><p class="muted">${creating ? 'Create an account to keep your safety data private and in sync.' : 'Sign in to access your personal safety dashboard.'}</p><form id="auth-form" class="auth-form"><label>Email address<input name="email" type="email" autocomplete="email" required /></label><label>Password<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="8" required /></label><button class="button button-primary" type="submit">${creating ? 'Create account' : 'Sign in'}</button></form>${state.authError ? `<p class="landing-error" role="alert">${escapeHtml(state.authError)}</p>` : ''}<p class="auth-switch">${creating ? 'Already have an account?' : 'New to Suraksha 360?'} <button class="text-button" data-action="toggle-auth">${creating ? 'Sign in' : 'Create account'}</button></p></section></main>`;
    return;
  }
  const pages = {
    dashboard, map: mapPage, journey: journeyPage, contacts: contactsPage,
    notifications: notificationsPage, offline: offlinePage, settings: settingsPage, sos: sosPage,
  };
  document.querySelector('#app').innerHTML = shell(pages[state.page]());
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
    if (state.authenticated) {
      const remote = await backendApi.loadUserData();
      if (remote) {
        state.contacts = remote.contacts ?? state.contacts;
        state.preferences = remote.preferences ?? state.preferences;
        state.offline = remote.offline ?? state.offline;
        state.notifications = remote.notifications ?? state.notifications;
      } else {
        state.contacts = [];
        state.notifications = [];
        state.preferences = { shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true };
        state.offline = false;
        await backendApi.saveUserData({ contacts: state.contacts, preferences: state.preferences, offline: state.offline, notifications: state.notifications });
      }
    }
    render();
    backendApi.onAuthStateChange(async (user) => {
      state.user = user;
      state.authenticated = Boolean(user);
      if (state.authenticated) {
        state.demoMode = false;
        state.screen = 'app';
        backendApi.loadUserData().then((remote) => {
          if (remote) Object.assign(state, { contacts: remote.contacts ?? state.contacts, preferences: remote.preferences ?? state.preferences, offline: remote.offline ?? state.offline, notifications: remote.notifications ?? state.notifications });
          else { state.contacts = []; state.notifications = []; }
          render();
        }).catch((error) => { console.error('Unable to load cloud data', error); render(); });
      } else {
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
  document.querySelector('#modal-root').innerHTML = '';
}

function addContactModal() {
  showModal('Add a trusted contact', `<form id="contact-form" class="modal-form">
    <label>Full name<input name="name" required maxlength="60" placeholder="e.g. Alex Morgan" /></label>
    <label>Relationship<input name="relation" required maxlength="60" placeholder="e.g. Close friend" /></label>
    <label>Phone number<input name="phone" type="tel" required maxlength="24" placeholder="+1 555 0100" /></label>
    <p class="form-hint">Their details are saved to your local preview or configured account. They will not be notified.</p>
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

function confirmSos() {
  showModal('Preview an SOS alert?', `<div class="modal-warning"><span>!</span><p>This is a local interface simulation for <b>${state.contacts.length} saved sample contacts</b>. No alert or location will be sent.</p></div><p class="muted">If you are in immediate danger, contact your local emergency number directly.</p>`, () => {
    state.notifications.unshift({ title: 'SOS alert simulated', detail: 'Demo alert created for your trusted circle. No services were contacted.', time: 'Just now', icon: '!', unread: true });
    persist('suraksha-notifications', state.notifications);
    closeModal(); state.page = 'dashboard'; render(); toast('SOS preview complete. No alert was sent.');
  }, 'Preview SOS');
}

function newJourneyModal() {
  showModal('Create a journey preview', `<form id="journey-form" class="modal-form"><label>Starting point<input name="start" required maxlength="100" placeholder="Enter a sample starting point" /></label><label>Destination<input name="destination" required maxlength="100" placeholder="Enter a sample destination" /></label><label>Estimated arrival<input name="eta" type="time" required /></label><p class="form-hint">This creates a local demo route only. No GPS is accessed and nobody is notified.</p></form>`, (root) => {
    const form = root.querySelector('#journey-form');
    if (!form.reportValidity()) return;
    state.journeyActive = true; state.journeyProgress = 0;
    closeModal(); state.page = 'journey'; render(); toast('Journey preview created. No one was notified.');
  }, 'Create preview');
}

function doAction(action, target) {
  if (action === 'sos') { state.page = 'sos'; render(); }
  else if (action === 'confirm-sos') confirmSos();
  else if (action === 'add-contact') addContactModal();
  else if (action === 'close-modal') closeModal();
  else if (action === 'new-journey') newJourneyModal();
  else if (action === 'checkin') {
    state.journeyProgress = Math.min(100, state.journeyProgress + 15);
    state.notifications.unshift({ title: 'Sample check-in', detail: 'Local demo check-in recorded. No one was notified.', time: 'Just now', icon: '✓', unread: true });
    persist('suraksha-notifications', state.notifications); render(); toast('Preview check-in recorded locally. No one was notified.');
  } else if (action === 'end-journey') {
    state.journeyActive = false; state.journeyProgress = 0; state.page = 'journey'; render(); toast('Journey preview ended.');
  } else if (action === 'share-journey' || action === 'share-location') {
    const text = action === 'share-location'
      ? 'Suraksha 360 demo: This is an illustrative map only. No live location is available.'
      : 'Suraksha 360 demo: This is a sample journey preview, not live tracking.';
    if (navigator.share) navigator.share({ title: 'Suraksha 360', text }).catch((error) => { if (error.name !== 'AbortError') toast('Unable to open the share dialog.'); });
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Demo preview text copied to clipboard.')).catch(() => toast(text));
    else toast(text);
  } else if (action === 'audio') {
    showModal('Preview a discreet check-in?', '<p class="muted">This local interface preview does not record audio, run a background timer, or contact anyone.</p><div class="modal-warning"><span>◖</span><p>Acknowledge to see the simulated check-in confirmation.</p></div>', () => { closeModal(); toast('Check-in preview acknowledged. No timer or alert was started.'); }, 'Show preview');
  } else if (action === 'toggle-offline') {
    state.offline = !state.offline; persist('suraksha-offline', state.offline); render(); toast(state.offline ? 'Offline interface simulation enabled. No mesh network was started.' : 'Offline interface simulation ended.');
  } else if (action === 'mark-read') {
    state.notifications = state.notifications.map((item) => ({ ...item, unread: false }));
    persist('suraksha-notifications', state.notifications); render(); toast('All notifications marked as read.');
  } else if (action === 'refresh') toast('Preview refreshed. Live device and safety services are unavailable.');
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
    if (person) showModal(`Remove ${escapeHtml(person.name)}?`, '<p class="muted">Remove this contact from your saved preview list. No safety updates are delivered by this demo.</p>', () => {
      state.contacts.splice(index, 1); persist('suraksha-contacts', state.contacts); closeModal(); render(); toast('Contact removed from your circle.');
    }, 'Remove contact');
  } else if (action === 'reset-settings') {
    state.preferences = { shareLocation: true, journeyAlerts: true, discreetMode: false, soundAlerts: true };
    persist('suraksha-preferences', state.preferences); render(); toast('Preferences reset to their defaults.');
  } else if (action === 'privacy-info') {
    showModal('Your privacy, in your hands', '<p class="muted">Suraksha 360 keeps your safety choices under your control. This demo stores preferences only in this browser and does not transmit location or alerts.</p><p class="form-hint">You can turn off location sharing and change notification preferences any time.</p>', closeModal, 'Got it');
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
  } else if (action === 'landing-menu') {
    document.querySelector('.reference-nav')?.classList.toggle('menu-open');
  } else if (action === 'landing-sos') {
    showModal('SOS preview only', '<div class="modal-warning"><span>!</span><p>This is a visual simulation. No trusted contacts, emergency services, or external systems will be contacted.</p></div><p class="muted">If you are in immediate danger, call your local emergency number directly.</p>', () => {
      closeModal();
      toast('SOS preview complete. No alert was sent.');
    }, 'Acknowledge');
  } else if (action === 'preview-checkin') {
    toast('Check-in preview complete. No one was notified.');
  } else if (action === 'offline-simulation') {
    state.fallbackOffline = !state.fallbackOffline;
    render();
    toast(state.fallbackOffline ? 'Offline interface simulation enabled.' : 'Offline interface simulation ended.');
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
      state.authenticated = false;
      state.demoMode = false;
      state.screen = 'landing';
      render();
    } else if (backendConfigured) backendApi.signOut().catch((error) => { console.error('Sign out failed', error); toast('Unable to sign out. Please try again.'); });
    else showModal('Sign out of this demo?', '<p class="muted">Your saved contacts and preferences will remain on this device.</p>', () => { closeModal(); toast('You are signed out of the demo.'); }, 'Sign out');
  } else if (action === 'menu') document.querySelector('.sidebar').classList.toggle('mobile-open');
  else if (action === 'profile-menu') toast('Account settings are available from Privacy & settings.');
}

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  if (!backendApi) return;
  const form = event.target;
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
  const pageButton = event.target.closest('[data-page]');
  const actionButton = event.target.closest('[data-action]');
  const preference = event.target.closest('[data-pref]');
  const filter = event.target.closest('[data-filter]');
  const landingTab = event.target.closest('[data-landing-tab]');
  const workflowStep = event.target.closest('[data-workflow-step]');
  const mapLayer = event.target.closest('[data-layer]');
  const featurePreview = event.target.closest('[data-feature-preview]');

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
  if (pageButton) {
    event.preventDefault();
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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
  const feature = event.target.matches?.('.pillar-card[data-feature-preview]') ? event.target : null;
  if (feature && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    doAction('feature-preview', feature);
  }
});

startApp();
