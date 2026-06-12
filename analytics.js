/* ════════════════════════════════════════════════════════════════
   📊 ANALYTICS TRACKER — Site web theworldofqueen.com
   ════════════════════════════════════════════════════════════════
   Tracker maison Supabase — Source: 'website'
   RGPD-friendly : pas de cookie, visitor_id anonyme en localStorage
   Endpoint : table analytics_events (Supabase OMP)

   USAGE :
   Ajouter dans chaque page HTML, juste avant </body> :
     <script src="analytics.js" defer></script>

   TRACKING AUTO :
   ✅ Pageview à chaque chargement de page
   ✅ Session start (avec referrer)
   ✅ Détection device (mobile / tablet / desktop)
   ✅ Conversions :
      - Inscription newsletter (subscribeNewsletter)
      - Soumission formulaire contact
      - Clic billetterie (Ticketmaster, Fnac, etc.)
      - Clic réseaux sociaux (FB, IG, YT, TikTok, X)
      - Clic vers PWA app.theworldofqueen.com
      - Clic boutons ESPACE PRO / PRESSE / CONTACT PROD
   ════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ⚙️ Config Supabase OMP (clé anon publique — safe pour le front)
  var SUPABASE_URL      = 'https://nhxqcavianozskxgfcbt.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeHFjYXZpYW5venNreGdmY2J0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyOTE0NjMsImV4cCI6MjA5MDg2NzQ2M30.sul93O7NFiIni3VnTkSld9HM6J73dnAYrnOT8PqFFW4';

  var STORAGE_VISITOR = 'twoq_web_visitor_id';
  var STORAGE_SESSION = 'twoq_web_session';
  var SESSION_TIMEOUT = 30 * 60 * 1000; // 30 min

  // --- Helpers ---
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function detectDevice() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/ipad|tablet/i.test(ua) ||
        (window.innerWidth >= 768 && window.innerWidth < 1024 && /mobile|android/i.test(ua))) {
      return 'tablet';
    }
    if (/mobi|iphone|android/i.test(ua)) return 'mobile';
    if (window.innerWidth >= 1024) return 'desktop';
    return 'unknown';
  }

  function getVisitorId() {
    var id = null;
    try { id = localStorage.getItem(STORAGE_VISITOR); } catch(_) {}
    if (!id) {
      id = uuid();
      try { localStorage.setItem(STORAGE_VISITOR, id); } catch(_) {}
    }
    return id;
  }

  function getSession() {
    var session = null;
    try {
      var raw = sessionStorage.getItem(STORAGE_SESSION) || localStorage.getItem(STORAGE_SESSION);
      if (raw) session = JSON.parse(raw);
    } catch(_) {}
    var now = Date.now();
    if (!session || (now - (session.last || 0)) > SESSION_TIMEOUT) {
      session = { id: uuid(), start: now, last: now, isNew: true };
    } else {
      session.last = now;
      session.isNew = false;
    }
    try {
      var ser = JSON.stringify({ id: session.id, start: session.start, last: session.last });
      sessionStorage.setItem(STORAGE_SESSION, ser);
      localStorage.setItem(STORAGE_SESSION, ser);
    } catch(_) {}
    return session;
  }

  // --- Envoi événement (fire-and-forget, silent fail) ---
  function sendEvent(eventType, options) {
    try {
      options = options || {};
      var session = getSession();
      var basePayload = {
        source: 'website',
        page_path: options.page_path || (location.pathname || '/'),
        session_id: session.id,
        visitor_id: getVisitorId(),
        referrer: document.referrer || null,
        user_agent: (navigator.userAgent || '').substring(0, 300),
        device_type: detectDevice(),
        conversion_type: options.conversion_type || null
      };

      // Si nouvelle session, on envoie aussi un session_start avant l'event
      if (session.isNew && eventType !== 'session_start') {
        var startPayload = Object.assign({}, basePayload, { event_type: 'session_start' });
        fetch(SUPABASE_URL + '/rest/v1/analytics_events', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(startPayload),
          keepalive: true
        }).catch(function() {});
      }

      // Event principal
      var eventPayload = Object.assign({}, basePayload, { event_type: eventType });
      fetch(SUPABASE_URL + '/rest/v1/analytics_events', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(eventPayload),
        keepalive: true // important pour ne pas annuler la requête si la page change
      }).catch(function() {});
    } catch(e) {
      // Ne jamais faire planter la page
      if (window.console) console.debug('[Analytics] error:', e);
    }
  }

  // --- API publique exposée sur window ---
  window.OMP_ANALYTICS = {
    pageview: function(page) { sendEvent('pageview', { page_path: page || (location.pathname || '/') }); },
    conversion: function(type) { sendEvent('conversion', { conversion_type: type, page_path: location.pathname || '/' }); }
  };

  // ════════════════════════════════════════════════════════════════
  // 🚀 INIT
  // ════════════════════════════════════════════════════════════════

  // 1) Pageview au chargement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      window.OMP_ANALYTICS.pageview();
    });
  } else {
    window.OMP_ANALYTICS.pageview();
  }

  // 2) Intercepteur global window.open()
  var _originalOpen = window.open;
  window.open = function(url, target, features) {
    try {
      if (typeof url === 'string' && url.indexOf('http') === 0) {
        var convType = classifyUrl(url);
        if (convType) window.OMP_ANALYTICS.conversion(convType);
      }
    } catch(_) {}
    return _originalOpen.call(window, url, target, features);
  };

  // 3) Délégation clics sur <a href="http*"> (réseaux sociaux, billetterie, etc.)
  document.addEventListener('click', function(e) {
    try {
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('http') !== 0) return;
      var convType = classifyUrl(href);
      if (convType) window.OMP_ANALYTICS.conversion(convType);
    } catch(_) {}
  }, true);

  // 4) Classifier URL → type de conversion
  function classifyUrl(url) {
    var u = url.toLowerCase();
    // Billetterie (priorité haute)
    if (u.indexOf('ticketmaster') !== -1) return 'billetterie_ticketmaster';
    if (u.indexOf('fnac') !== -1 || u.indexOf('francebillet') !== -1) return 'billetterie_fnac';
    if (u.indexOf('seetickets') !== -1 || u.indexOf('see-tickets') !== -1) return 'billetterie_seetickets';
    if (u.indexOf('digitick') !== -1) return 'billetterie_digitick';
    if (u.indexOf('ohmyprod') !== -1 && u.indexOf('billet') !== -1) return 'billetterie_omp';
    // PWA TWOQ
    if (u.indexOf('app.theworldofqueen.com') !== -1) return 'click_to_pwa';
    // Réseaux sociaux
    if (u.indexOf('facebook.com') !== -1)  return 'social_facebook';
    if (u.indexOf('instagram.com') !== -1) return 'social_instagram';
    if (u.indexOf('youtube.com') !== -1 || u.indexOf('youtu.be') !== -1) return 'social_youtube';
    if (u.indexOf('tiktok.com') !== -1)    return 'social_tiktok';
    if (u.indexOf('x.com') !== -1 || u.indexOf('twitter.com') !== -1) return 'social_twitter';
    return null;
  }

  // 5) Tracker spécifique : pages "PRO" en interne (contact-prod, espace-presse, espace-pro)
  //    Détecte si l'URL actuelle est une page pro et marque ça comme conversion
  (function trackProPages() {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('contact-prod') !== -1) {
      // Léger délai pour laisser le 1er pageview partir avant la conversion
      setTimeout(function() { window.OMP_ANALYTICS.conversion('page_contact_prod'); }, 500);
    } else if (path.indexOf('espace-presse') !== -1) {
      setTimeout(function() { window.OMP_ANALYTICS.conversion('page_espace_presse'); }, 500);
    } else if (path.indexOf('espace-pro') !== -1) {
      setTimeout(function() { window.OMP_ANALYTICS.conversion('page_espace_pro'); }, 500);
    }
  })();

  // 6) Tracker submit formulaires (newsletter, contact)
  document.addEventListener('submit', function(e) {
    try {
      var form = e.target;
      if (!form || !form.tagName || form.tagName.toLowerCase() !== 'form') return;
      var formClass = (form.className || '').toLowerCase();
      var formId    = (form.id || '').toLowerCase();

      if (formClass.indexOf('newsletter') !== -1 || formId.indexOf('newsletter') !== -1) {
        window.OMP_ANALYTICS.conversion('newsletter');
      } else if (formClass.indexOf('contact') !== -1 || formId.indexOf('contact') !== -1) {
        window.OMP_ANALYTICS.conversion('form_contact');
      } else if (formClass.indexOf('presse') !== -1 || formId.indexOf('presse') !== -1) {
        window.OMP_ANALYTICS.conversion('form_presse');
      } else if (formClass.indexOf('pro') !== -1 || formId.indexOf('pro') !== -1) {
        window.OMP_ANALYTICS.conversion('form_pro');
      } else {
        // Formulaire générique → on track quand même
        window.OMP_ANALYTICS.conversion('form_generic');
      }
    } catch(_) {}
  }, true);

  // Tag console pour vérifier que le tracker est bien chargé
  if (window.console) console.log('%c📊 OMP Analytics ON','color:#D4AF37;font-weight:700');

})();


/* ════════════════════════════════════════════════════════════════
   📈 GOOGLE ADS — Conversion « Clic billetterie » (AW-17179539275)
   Déclenche la conversion Google Ads sur tout clic SORTANT vers une
   billetterie (Ticketmaster, Fnac, See Tickets, Digitick, etc.).
   Additif : n'interfère pas avec le tracker OMP ci-dessus.
   ════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';
  var AW_ID   = 'AW-17179539275';
  var SEND_TO = 'AW-17179539275/VoIMCIDH7L0cEMvu6_8_';

  // 1) Charger la balise Google (gtag.js) si absente
  if (typeof window.gtag !== 'function') {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', AW_ID);
  }

  // 2) Domaines / motifs de billetterie (clic sortant)
  function isBilletterie(url) {
    url = (url || '').toLowerCase();
    return /ticketmaster|fnac\.com|francebillet|seetickets|see-tickets|digitick|weezevent|placeminute|ticketnet|nuitdartistes|nuit-d-artistes|lesderniers|derniers-couches|\/billet|billetterie/.test(url);
  }

  // 3) Au clic sur un lien sortant de billetterie → conversion Google Ads
  document.addEventListener('click', function(e) {
    try {
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('http') !== 0) return;
      if (new URL(href).host === location.host) return; // uniquement les clics SORTANTS
      if (isBilletterie(href) && typeof window.gtag === 'function') {
        window.gtag('event', 'conversion', { 'send_to': SEND_TO, 'value': 1.0, 'currency': 'EUR' });
        if (window.console) console.log('%c📈 Google Ads — conversion Clic billetterie envoyée', 'color:#1E7A3D;font-weight:700');
      }
    } catch (_) {}
  }, true);
})();
/* AJOUT widget dates : conversion billetterie via postMessage (iframe app.ohmyprod.com) */ (function(){'use strict';var SEND_TO='AW-17179539275/VoIMCIDH7L0cEMvu6_8_';window.addEventListener('message',function(e){try{var host='';try{host=new URL(e.origin).host;}catch(_){return;}if(host!=='ohmyprod.com'&&host!=='app.ohmyprod.com'&&host.indexOf('.ohmyprod.com')===-1)return;var d=e.data;if(d&&d.type==='twoq-billetterie-click'){if(typeof window.gtag==='function'){window.gtag('event','conversion',{'send_to':SEND_TO,'value':1.0,'currency':'EUR'});}if(window.OMP_ANALYTICS){window.OMP_ANALYTICS.conversion('billetterie_widget');}}}catch(_){}});})();
