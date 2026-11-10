const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || 'support@your-domain.com';

const landingLinks = [
  ['Platform Home', 'top'],
  ['Core Capabilities', 'features'],
  ['Protocol Workflow', 'how-it-works'],
  ['Mission Architecture', 'technology'],
  ['Live Telemetry Map', 'interactive-map'],
  ['Safety Intelligence & FAQ', 'faq'],
];

const appLinks = [
  ['Platform Home', 'dashboard'],
  ['Core Capabilities', 'map'],
  ['Protocol Workflow', 'journey'],
  ['Mission Architecture', 'settings'],
  ['Live Telemetry Map', 'map'],
  ['Safety Intelligence & FAQ', 'sos'],
];

const technologies = [
  ['⌖', 'OpenStreetMap data', 'Map tiles and place search'],
  ['◫', 'Leaflet map renderer', 'Interactive map and overlays'],
  ['◎', 'Browser Geolocation API', 'Permission-based GPS'],
  ['✳', 'In-app SOS alerts', 'Supabase authenticated delivery'],
  ['◌', 'Offline messaging', 'Not implemented'],
  ['＋', 'Emergency dispatch', 'Not integrated'],
];

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function renderNavigation(context) {
  const appMode = context === 'app' || context === 'legal-app';
  const links = appMode ? appLinks : landingLinks;
  return links.map(([label, target]) => appMode
    ? `<a href="#app/${target}" data-page="${target}">${label}</a>`
    : `<a href="#${target}" ${context === 'legal' || context === 'auth' ? `data-footer-section="${target}"` : ''}>${label}</a>`).join('');
}

export function renderFooter(context = 'landing') {
  const appMode = context === 'app' || context === 'legal-app';
  const homeLink = appMode
    ? '<a class="site-footer-brand" href="#app/dashboard" data-page="dashboard" aria-label="SURAKSHA 360 platform home">'
    : '<a class="site-footer-brand" href="#top" data-footer-section="top" aria-label="SURAKSHA 360 platform home">';
  const legalLink = (name, label) => `<a href="#${name}" data-footer-legal="${name}">${label}</a>`;
  const email = esc(supportEmail);
  const emailConfigured = Boolean(import.meta.env.VITE_SUPPORT_EMAIL && !import.meta.env.VITE_SUPPORT_EMAIL.includes('your-domain'));
  const year = new Date().getFullYear();

  return `<footer class="site-footer ${context === 'app' ? 'site-footer-app' : ''}" aria-label="SURAKSHA 360 site footer">
    <div class="site-footer-inner">
      <div class="site-footer-grid">
        <section class="footer-brand-column" aria-labelledby="footer-brand-title">
          ${homeLink}<img src="/suraksha-360-logo.webp" alt="SURAKSHA 360" /></a>
          <h2 id="footer-brand-title" class="sr-only">About SURAKSHA 360</h2>
          <p class="footer-description">A personal safety platform for permission-based location sharing, trusted circles, and in-app emergency alerts.</p>
          <div class="footer-network-status" aria-live="polite"><span class="footer-status-dot ${navigator.onLine ? '' : 'is-offline'}" aria-hidden="true"></span><span><b>Device network</b><small data-footer-network-status>${navigator.onLine ? 'Online' : 'Offline'}</small></span></div>
          <p class="footer-tagline">Safety, connected. Control stays with you.</p>
        </section>

        <nav class="footer-nav-column" aria-label="Platform navigation">
          <h2>Explore the platform</h2>
          <ul>${renderNavigation(context)}</ul>
        </nav>

        <section class="footer-tech-column" aria-labelledby="footer-tech-title">
          <h2 id="footer-tech-title">Technology & availability</h2>
          <ul class="footer-tech-list">${technologies.map(([icon, label, detail]) => `<li><span class="footer-tech-icon" aria-hidden="true">${icon}</span><span><b>${label}</b><small>${detail}</small></span></li>`).join('')}</ul>
        </section>

        <section class="footer-contact-column" aria-labelledby="footer-contact-title">
          <h2 id="footer-contact-title">Helpline & duty care</h2>
          <div class="footer-emergency-card"><span class="footer-emergency-kicker">INDIA · EMERGENCY ASSISTANCE</span><a class="footer-emergency-number" href="tel:112" aria-label="Call India's emergency number 112">112</a><p>Call India’s emergency response number directly for urgent help.</p><a class="footer-call-button" href="tel:112" aria-label="Call emergency services at 112">Call 112 <span aria-hidden="true">↗</span></a></div>
          <div class="footer-email-block"><span>PROJECT SUPPORT</span><a href="mailto:${email}?subject=Suraksha%20360%20Project%20Support" aria-label="Email SURAKSHA 360 project support at ${email}">${email}</a>${emailConfigured ? '' : '<small class="footer-email-note">Placeholder · set VITE_SUPPORT_EMAIL before launch</small>'}</div>
          <p class="footer-contact-note">SURAKSHA 360 does not dispatch emergency services. Call 112 directly in an emergency.</p>
        </section>
      </div>

      <aside class="footer-disclaimer" aria-label="Safety and legal disclaimer">
        <span class="footer-disclaimer-icon" aria-hidden="true">!</span>
        <p><b>Safety &amp; Legal Disclaimer:</b> SURAKSHA 360 is designed to support personal safety awareness, location sharing and emergency communication. Actual emergency response depends on network availability, device permissions and emergency service availability. This platform does not replace official emergency services.</p>
      </aside>

      <div class="site-footer-bottom"><p>© ${year} <b>SURAKSHA 360</b>. Built for safer connections.</p><nav aria-label="Legal and safety information">${legalLink('privacy', 'Privacy Policy')}${legalLink('terms', 'Terms of Service')}${legalLink('safety', 'Safety Information')}</nav></div>
    </div>
  </footer>`;
}

const legalPages = {
  privacy: {
    title: 'Privacy Policy',
    updated: 'Last updated November 2026',
    body: `<p>SURAKSHA 360 requests device location only after you choose a location action and grant browser permission. Location stays on your device unless you explicitly start an authenticated journey and select accepted contacts.</p><h2>Information stored</h2><p>When you use an account, Supabase stores account data, trusted contact relationships, journey details, the latest shared location, and in-app SOS alerts needed to operate the features you choose. Location sharing is limited to selected accepted contacts and expires or can be revoked.</p><h2>Your controls</h2><p>You can stop location sharing from the map. Do not add sensitive details you do not want stored or shared. The app does not send SMS, place calls, or dispatch emergency services.</p><h2>Contact</h2><p>For project questions, email <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>. The address is a configurable placeholder until the project owner sets a real support mailbox.</p>`,
  },
  terms: {
    title: 'Terms of Service',
    updated: 'Last updated November 2026',
    body: `<p>SURAKSHA 360 is a personal safety support tool. Use it only with accounts, devices, locations, and contact details you are authorized to use. You are responsible for choosing whether and with whom to share your location.</p><h2>Service limits</h2><p>Location sharing requires network access, device location permission, and compatible services. In-app SOS alerts are delivered only within the app to eligible accepted contacts. The platform does not contact police, ambulance, fire services, or other emergency operators.</p><h2>No emergency guarantee</h2><p>The platform is provided as-is and may be unavailable or delayed. Do not rely on it as your only safety or emergency plan. In immediate danger, contact official emergency services directly.</p>`,
  },
  safety: {
    title: 'Safety Information',
    updated: 'Emergency guidance and feature limits',
    body: `<p><b>India emergency number: <a href="tel:112">112</a>.</b> Call directly when you need urgent help. The SURAKSHA 360 SOS feature creates an in-app alert for selected accepted contacts; it does not call 112 or dispatch emergency services.</p><h2>Using location sharing</h2><p>Grant location access only when you choose. Confirm the people selected before starting a share, and use “Stop sharing now” when you are done. Sharing depends on your device, browser permissions, and network connection.</p><h2>Service availability</h2><p>GPS accuracy varies. Network outages, battery limits, browser suspension, or service downtime can delay or prevent updates. Offline messaging and background tracking are not implemented.</p>`,
  },
};

export function renderLegalPage(page, context = 'legal') {
  const content = legalPages[page] ?? legalPages.safety;
  const appMode = context === 'app' || context === 'legal-app';
  const back = appMode
    ? '<button class="button button-quiet" data-action="footer-home">← Return to dashboard</button>'
    : '<button class="button button-quiet" data-action="footer-home">← Return to platform</button>';
  return `<main class="footer-legal-page"><div class="footer-legal-inner">${back}<p class="footer-legal-eyebrow">SURAKSHA 360 · RESPONSIBLE USE</p><h1>${content.title}</h1><p class="footer-legal-updated">${content.updated}</p><article class="footer-legal-copy">${content.body}</article></div></main>${renderFooter(context)}`;
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  document.querySelectorAll('[data-footer-network-status]').forEach((label) => {
    label.textContent = online ? 'Online' : 'Offline';
    label.closest('.footer-network-status')?.querySelector('.footer-status-dot')?.classList.toggle('is-offline', !online);
  });
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
