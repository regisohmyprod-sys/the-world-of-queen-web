#!/usr/bin/env node
/**
 * TWOQ — Générateur de pages SEO statiques par date de concert
 * ------------------------------------------------------------
 * Lit les dates depuis Supabase (vue publique) et génère :
 *   - une page HTML statique par date  ->  /concerts/<slug>/index.html
 *   - un sitemap.xml à la racine
 *   - un robots.txt à la racine
 *
 * Pourquoi : aujourd'hui dates.html charge les dates en JavaScript,
 * donc Google ne voit NI les villes NI les dates. Ces pages mettent
 * tout le contenu (ville, salle, date, prix, lien) EN DUR dans le HTML,
 * + un schéma JSON-LD MusicEvent => éligible aux résultats "événements".
 *
 * Lancer :   SUPABASE_ANON_KEY="xxx" node generate-seo-pages.mjs
 * Aperçu sans Supabase :   MOCK=1 node generate-seo-pages.mjs
 *
 * Node 18+ requis (fetch natif). Zéro dépendance npm.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ============================================================
   CONFIG — vérifie/ajuste selon ta vraie installation
   ============================================================ */
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://nhxqcavianozskxgfcbt.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';      // clé "anon" publique (déjà présente dans le JS de ton site)
const SOURCE_VIEW   = process.env.SOURCE_VIEW   || 'public_dates_twoq'; // vue publique des dates
const SUPABASE_PUB  = 'sb_publishable_59Pg7368sxCT6y3j9nNw0g_i8ILGRZ3'; // clé publishable (côté navigateur, déjà publique sur le site) pour capter l'email
const JOIN_POPUP = `
<!-- TWOQ — Popup d'accueil : rejoindre les fans (gratuit) -->
<div id="twoqJoin" style="display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.8);align-items:center;justify-content:center;padding:18px;font-family:'Inter',Arial,sans-serif;">
  <div style="position:relative;background:#141414;border:1px solid rgba(212,175,55,.5);border-radius:18px;max-width:420px;width:100%;padding:30px 26px 26px;text-align:center;box-shadow:0 28px 80px rgba(0,0,0,.65);">
    <button onclick="twoqJoinClose()" aria-label="Fermer" style="position:absolute;top:8px;right:14px;background:none;border:none;color:#8B8580;font-size:26px;line-height:1;cursor:pointer;">&times;</button>
    <div style="font-family:'Cinzel',serif;color:#D4AF37;font-size:1.3rem;letter-spacing:.03em;margin-bottom:6px;">&#127915; Rejoins les fans TWOQ</div>
    <div style="color:#F5F1E8;font-size:1rem;font-weight:600;margin-bottom:16px;">Inscription gratuite &mdash; d&eacute;bloque tes avantages&nbsp;:</div>
    <ul style="list-style:none;padding:0;margin:0 auto 20px;text-align:left;display:inline-block;color:#F5F1E8;font-size:.93rem;line-height:1.95;">
      <li>&#9989; <strong style="color:#D4AF37;">&minus;10&nbsp;%</strong> sur tes billets</li>
      <li>&#9989; Jeux concours exclusifs</li>
      <li>&#9989; Pr&eacute;-r&eacute;servation 48&nbsp;h avant tout le monde</li>
      <li>&#9989; Des places &agrave; gagner</li>
      <li>&#9989; &hellip;et plein d'autres avantages</li>
    </ul>
    <a href="https://app.theworldofqueen.com/?utm_source=site&amp;utm_medium=welcome-popup&amp;utm_campaign=join-fan" target="_blank" rel="noopener" style="display:block;text-decoration:none;padding:14px;border-radius:12px;background:linear-gradient(135deg,#F0D77A,#D4AF37 55%,#b8902b);color:#1a1206;font-family:'Cinzel',serif;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.85rem;">Je m'inscris gratuitement</a>
    <button onclick="twoqJoinClose()" style="background:none;border:none;color:#8B8580;font-size:.8rem;margin-top:12px;cursor:pointer;text-decoration:underline;">Plus tard</button>
  </div>
</div>
<script>
(function(){
  var KEY='twoq_join_popup_seen', DAYS=7;
  function seen(){ try{ var t=parseInt(localStorage.getItem(KEY)||'0',10); return t && (Date.now()-t)<DAYS*864e5; }catch(e){ return false; } }
  function mark(){ try{ localStorage.setItem(KEY,String(Date.now())); }catch(e){} }
  function show(){ if(seen()) return; var el=document.getElementById('twoqJoin'); if(!el) return; el.style.display='flex'; mark(); }
  window.twoqJoinClose=function(){ var el=document.getElementById('twoqJoin'); if(el) el.style.display='none'; };
  var bg=document.getElementById('twoqJoin'); if(bg) bg.addEventListener('click',function(e){ if(e.target===this) twoqJoinClose(); });
  if(!seen()) setTimeout(show, 1500);
})();
</script>
`; // popup d'accueil (inscription fan), injecté avant </body>
const SITE_ORIGIN   = 'https://www.theworldofqueen.com';
const OUTPUT_DIR    = 'concerts';                              // dossier de sortie (relatif à la racine du repo site)
const TOUR_NAME     = "THE WORLD OF QUEEN \u2013 L'\u00c9ternelle L\u00e9gende";
const PERFORMER     = 'Fred Caramia';
const ORG_NAME      = 'Oh My Prod';
const ORG_URL       = 'https://www.ohmyprod.com';
const OG_IMAGE      = 'https://regisohmyprod-sys.github.io/twoq-pwa/assets/banner-twoq.jpg';
const LOGO          = 'https://regisohmyprod-sys.github.io/twoq-pwa/icons/logo-twoq-titre.png';
const DOME_RAPPEL   = 'D\u00f4me de Paris \u2014 28 novembre 2026';
const TM_ARTISTE    = 'https://www.ticketmaster.fr/fr/artiste/the-world-of-queen/idartiste/33538'; // billetterie de secours (m\u00eame logique que dates.html)
const APP_URL       = 'https://app.theworldofqueen.com/'; // appli TWOQ : c'est l\u00e0 que le fan OR/PLATINE r\u00e9cup\u00e8re son tarif -10%
const INCLUDE_PAST  = false;  // true = g\u00e9n\u00e8re aussi les dates pass\u00e9es

// Noms de colonnes possibles dans ta vue (on prend le 1er trouv\u00e9). AJUSTE si besoin.
const COLS = {
  ville:    ['ville'],
  salle:    ['nom_salle'],
  date:     ['date_concert'],
  heure:    ['heure_show'],
  url:      ['lien_billetterie_principal'],
  statut:   ['statut_public'],
  photo:    ['photo_url'],
  open_mev: ['date_open_mev'],
  liens:    ['liens_billetterie'],   // objet JSON {ticketmaster, fnac, ...} (secours)
  prix_min: [],   // pas de colonne prix dans la vue -> aucun prix affiche (OK pour Google)
};

/* ============================================================
   Helpers
   ============================================================ */
const MOIS = ['janvier','f\u00e9vrier','mars','avril','mai','juin','juillet','ao\u00fbt','septembre','octobre','novembre','d\u00e9cembre'];

const esc = (s='') => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const pick = (row, keys) => {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
  }
  return null;
};

const slugify = (s='') => s.toString()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // enlève les accents
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// Offset Paris (règle UE) : +02:00 en été, +01:00 en hiver
function lastSundayUTC(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(1, 0, 0, 0);
  return d;
}
function parisOffset(jsDate) {
  const y = jsDate.getUTCFullYear();
  return (jsDate >= lastSundayUTC(y, 2) && jsDate < lastSundayUTC(y, 9)) ? '+02:00' : '+01:00';
}

// "2026-09-19" + "20h30" -> objet normalisé
function parseDate(rawDate, rawHeure) {
  if (!rawDate) return null;
  const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [_, Y, Mo, D] = m;
  let hh = null, mm = '00';
  if (rawHeure) {
    const t = String(rawHeure).match(/(\d{1,2})\s*[h:]\s*(\d{0,2})/);
    if (t) { hh = t[1].padStart(2, '0'); mm = (t[2] || '00').padStart(2, '0'); }
  }
  const y = +Y, mo = +Mo, d = +D;
  const jsDate = new Date(Date.UTC(y, mo - 1, d, 12)); // midi pour déterminer le régime DST
  const offset = parisOffset(jsDate);
  return {
    y, mo, d, hh, mm, offset, jsDate,
    iso: hh ? `${Y}-${Mo}-${D}T${hh}:${mm}:00${offset}` : `${Y}-${Mo}-${D}`,
    label: `${d} ${MOIS[mo - 1]} ${y}`,
    heureLabel: hh ? `${hh}h${mm}` : null,
  };
}

function withUtm(url, slug) {
  if (!url) return null;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}utm_source=site&utm_medium=seo&utm_campaign=${slug}`;
}

// Résout le lien de réservation avec la MÊME cascade que dates.html :
// lien_billetterie_principal -> liens_billetterie.ticketmaster/fnac -> lien artiste Ticketmaster
function resolveBooking(ev) {
  if (ev.url) return ev.url;
  let lb = ev.liens;
  if (typeof lb === 'string') { try { lb = JSON.parse(lb); } catch { lb = null; } }
  if (lb && typeof lb === 'object' && (lb.ticketmaster || lb.fnac)) return lb.ticketmaster || lb.fnac;
  return TM_ARTISTE;
}

// Liste classe des billetteries disponibles pour une date (déduit le nom depuis l'URL)
const TICKET_LABELS = [
  [/ticketmaster/i, 'Ticketmaster'],
  [/fnacspectacles|fnac/i, 'Fnac Spectacles'],
  [/digitick/i, 'Digitick'],
  [/see-?tickets/i, 'See Tickets'],
  [/weezevent/i, 'Weezevent'],
];
function labelFor(url) { for (const [re, l] of TICKET_LABELS) if (re.test(url)) return l; return 'Billetterie'; }
function bookingOptions(ev) {
  const opts = [];
  const add = (url) => {
    if (!url) return;
    const label = labelFor(url);
    if (opts.some(o => o.label === label || o.url === url)) return; // 1 bouton max par plateforme
    opts.push({ url, label });
  };
  add(ev.url);
  let lb = ev.liens;
  if (typeof lb === 'string') { try { lb = JSON.parse(lb); } catch { lb = null; } }
  if (lb && typeof lb === 'object') { add(lb.ticketmaster); add(lb.fnac); add(lb.digitick); add(lb.seetickets); }
  if (!opts.length) opts.push({ url: TM_ARTISTE, label: 'Ticketmaster' });
  return opts;
}

// Lien billetterie "organisateur" (marque blanche -10% fans OR/PLATINE), si pr\u00e9sent pour la date.
// Renvoie l'URL (preuve que la date a un tarif fan) ou null. La PAGE n'affiche que le bouton vers l'appli ;
// le vrai lien -10% est servi dans l'appli au fan connect\u00e9 OR/PLATINE.
function fanOrganisateur(ev) {
  let lb = ev.liens;
  if (typeof lb === 'string') { try { lb = JSON.parse(lb); } catch { lb = null; } }
  if (lb && typeof lb === 'object' && typeof lb.organisateur === 'string' && lb.organisateur.trim()) {
    return lb.organisateur.trim();
  }
  return null;
}

// Popup "tarif fan" : on capte l'email (newsletter_subscribers, source = la date) PUIS on ouvre la billetterie -10%.
function fanGateMarkup(ev, fanUrl) {
  const fanJson = JSON.stringify(fanUrl);
  return `
      <div id="fanGate" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);align-items:center;justify-content:center;padding:20px;">
        <div style="background:#141414;border:1px solid rgba(212,175,55,.45);border-radius:16px;max-width:380px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.6);">
          <div style="font-family:'Cinzel',serif;color:#D4AF37;font-size:1.05rem;letter-spacing:.04em;">\ud83d\udc8e Tarif fan \u221210&nbsp;%</div>
          <p style="color:#F5F1E8;font-size:.9rem;line-height:1.5;margin:12px 0 16px;">Entre ton email pour d\u00e9bloquer la billetterie au tarif fan (\u221210&nbsp;% d\u00e9j\u00e0 d\u00e9duit) pour <strong>${esc(ev.ville)}</strong>.</p>
          <input id="fanGateEmail" type="email" placeholder="ton@email.com" style="width:100%;box-sizing:border-box;background:#0a0a0a;border:1px solid rgba(212,175,55,.4);border-radius:10px;color:#fff;padding:12px 14px;font-size:.95rem;margin-bottom:12px;">
          <button id="fanGateBtn" onclick="twoqFanSubmit()" style="display:block;width:100%;padding:13px;border:none;border-radius:10px;cursor:pointer;background:linear-gradient(135deg,#F0D77A,#D4AF37 55%,#b8902b);color:#1a1206;font-family:'Cinzel',serif;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem;">Acc\u00e9der au tarif \u221210&nbsp;%</button>
          <p style="color:#8B8580;font-size:.72rem;margin-top:12px;line-height:1.4;">En continuant, tu rejoins la communaut\u00e9 fan TWOQ (d\u00e9sinscription possible \u00e0 tout moment).</p>
          <button onclick="twoqFanClose()" style="background:none;border:none;color:#8B8580;font-size:.78rem;margin-top:8px;cursor:pointer;text-decoration:underline;">Plus tard</button>
        </div>
      </div>
      <script>
      (function(){
        var BK=${fanJson};
        var SRC='tarif-fan:${ev.slug}';
        function $(id){return document.getElementById(id);}
        window.twoqFanGate=function(e){if(e)e.preventDefault();var g=$('fanGate');if(g){g.style.display='flex';setTimeout(function(){var i=$('fanGateEmail');if(i)i.focus();},60);}return false;};
        window.twoqFanClose=function(){var g=$('fanGate');if(g)g.style.display='none';};
        window.twoqFanSubmit=function(){
          var i=$('fanGateEmail');var email=((i&&i.value)||'').trim().toLowerCase();
          if(!email||email.indexOf('@')<1||email.lastIndexOf('.')<email.indexOf('@')+2||email.lastIndexOf('.')>=email.length-1){if(i){i.style.borderColor='#8B0000';i.focus();}return;}
          var b=$('fanGateBtn');if(b){b.textContent='Un instant\u2026';b.disabled=true;}
          try{fetch('${SUPABASE_URL}/rest/v1/newsletter_subscribers',{method:'POST',keepalive:true,headers:{'apikey':'${SUPABASE_PUB}','Authorization':'Bearer ${SUPABASE_PUB}','Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({email:email,source:SRC})}).catch(function(){});}catch(err){}
          try{if(window.fbq)fbq('track','Lead',{content_name:SRC});}catch(e){}
          window.location.href=BK;
        };
        var g=$('fanGate');if(g)g.addEventListener('click',function(e){if(e.target===this)twoqFanClose();});
      })();
      </script>`;
}

/* ============================================================
   Template d'une page de date
   ============================================================ */
function renderPage(ev, others) {
  const title = `THE WORLD OF QUEEN \u00e0 ${esc(ev.ville)} \u2014 ${esc(ev.dt.label)}${ev.salle ? ' \u00b7 ' + esc(ev.salle) : ''}`;
  const desc = `THE WORLD OF QUEEN \u2013 L'\u00c9ternelle L\u00e9gende \u00e0 ${esc(ev.ville)}${ev.salle ? ', ' + esc(ev.salle) : ''}, le ${esc(ev.dt.label)}${ev.dt.heureLabel ? ' \u00e0 ' + esc(ev.dt.heureLabel) : ''}. Le show hommage n\u00b01 \u00e0 Freddie Mercury (1,3M de spectateurs), avec Fred Caramia. R\u00e9servez vos billets.`;
  const canonical = `${SITE_ORIGIN}/${OUTPUT_DIR}/${ev.slug}/`;
  const booking = resolveBooking(ev);
  const reserveUrl = withUtm(booking, ev.slug);
  const opts = bookingOptions(ev);
  const fanUrl = fanOrganisateur(ev);
  // Si un tarif fan existe, TOUTES les billetteries classiques passent en secondaire (le bouton fan est le h\u00e9ros).
  const optBtns = opts
    .map((o, i) => `<a class="cta ${(!fanUrl && i === 0) ? '' : 'cta-sec'}" href="${withUtm(o.url, ev.slug)}" rel="nofollow noopener" target="_blank">${esc(o.label)}</a>`)
    .join('\n          ');
  let ctaHtml;
  if (fanUrl) {
    ctaHtml = `<a class="cta fan-cta" href="${esc(fanUrl)}" onclick="return twoqFanGate(event)">
        <span class="fan-badge">\ud83d\udc8e \u221210&nbsp;%</span> Tarif fan TWOQ
      </a>
      <p class="fan-note">Tarif organisateur \u221210&nbsp;% (remise d\u00e9j\u00e0 d\u00e9duite). <strong>Entre ton email</strong> pour d\u00e9bloquer la billetterie au tarif r\u00e9duit \u2014 r\u00e9serv\u00e9 \u00e0 la communaut\u00e9 fan TWOQ.</p>
      <div class="book-wrap">
        <div class="book-lab">Ou r\u00e9server au tarif public</div>
        <div class="book-opts">
          ${optBtns}
        </div>
      </div>
      ${fanGateMarkup(ev, fanUrl)}`;
  } else if (opts.length <= 1) {
    ctaHtml = `<a class="cta" href="${withUtm(opts[0].url, ev.slug)}" rel="nofollow noopener" target="_blank">R\u00e9server mes billets</a>`;
  } else {
    ctaHtml = `<div class="book-wrap">
        <div class="book-lab">R\u00e9server sur</div>
        <div class="book-opts">
          ${optBtns}
        </div>
      </div>`;
  }
  const ogImg = ev.photo || OG_IMAGE;

  // JSON-LD MusicEvent
  const offers = {
    '@type': 'Offer',
    url: booking,
    priceCurrency: 'EUR',
    ...(ev.prix_min ? { price: String(ev.prix_min).replace(/[^\d.]/g, '') } : {}),
    availability: ev.soldout ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    ...(ev.openMev ? { validFrom: String(ev.openMev).slice(0, 10) } : {}),
  };

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: TOUR_NAME,
    startDate: ev.dt.iso,
    eventStatus: ev.cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    image: [ogImg],
    description: `Spectacle hommage \u00e0 Queen et Freddie Mercury, port\u00e9 par Fred Caramia. ${TOUR_NAME}.`,
    location: {
      '@type': 'Place',
      name: ev.salle || ev.ville,
      address: { '@type': 'PostalAddress', addressLocality: ev.ville, addressCountry: 'FR' },
    },
    performer: { '@type': 'MusicGroup', name: 'The World of Queen', member: { '@type': 'Person', name: PERFORMER } },
    organizer: { '@type': 'Organization', name: ORG_NAME, url: ORG_URL },
    ...(offers ? { offers } : {}),
  };

  // Prochaines dates (maillage interne) : on privilégie les dates APRÈS celle consultée
  const after = others.filter(o => o.dt.iso >= ev.dt.iso);
  const before = others.filter(o => o.dt.iso < ev.dt.iso);
  let picked = after.slice(0, 6);
  if (picked.length < 6) picked = picked.concat(before.slice(-(6 - picked.length)));
  const othersHtml = picked.map(o =>
    `<li><a href="${SITE_ORIGIN}/${OUTPUT_DIR}/${o.slug}/"><span class="o-ville">${esc(o.ville)}</span><span class="o-date">${esc(o.dt.label)}</span></a></li>`
  ).join('\n          ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | Billetterie officielle</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="event">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${ogImg}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="The World of Queen">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${ogImg}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;900&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<base href="${SITE_ORIGIN}/">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
  :root{--noir:#0A0A0A;--charcoal:#141414;--gold:#D4AF37;--gold-pale:#F0D77A;--cramoisi:#8B0000;--cream:#F5F1E8;--smoke:#8B8580;--serif:'Cinzel',serif;--sans:'Inter',system-ui,sans-serif;--or:#D4AF37;--creme:#F5F1E8;}
  *{margin:0;padding:0;box-sizing:border-box}
  a{color:inherit;text-decoration:none}
  body{background:var(--noir);color:var(--cream);font-family:var(--sans);line-height:1.6;padding-top:62px;min-height:100vh;
    background-image:radial-gradient(ellipse at 50% -10%,rgba(212,175,55,.10),transparent 55%),
      radial-gradient(ellipse at 50% 110%,rgba(139,0,0,.18),transparent 55%)}
  .wrap{max-width:760px;margin:0 auto;padding:0 24px}

  /* ===== HEADER (identique au site) ===== */
  .site-header{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,10,10,0.96);
    backdrop-filter:blur(12px);border-bottom:1px solid rgba(212,175,55,0.15);transition:background 0.3s}
  .header-inner{position:relative;max-width:1280px;margin:0 auto;padding:14px 24px;display:flex;
    justify-content:flex-start;align-items:center;gap:50px;min-height:60px}
  .brand{font-family:var(--serif);color:var(--gold);font-size:16px;letter-spacing:3px;font-weight:600;
    line-height:1.1;flex-shrink:0;text-decoration:none;transition:filter 0.2s,text-shadow 0.2s;cursor:pointer}
  .brand:hover{filter:brightness(1.15)}
  .brand small{display:block;font-family:var(--sans);color:var(--cream);font-size:9px;letter-spacing:4px;
    font-weight:400;margin-top:2px;opacity:0.8}
  .menu-toggle{display:none;background:transparent;color:var(--gold);border:1px solid var(--gold);
    border-radius:6px;padding:6px 12px;font-size:18px;cursor:pointer}
  nav.main-nav{display:flex;gap:22px;align-items:center}
  nav.main-nav a{color:var(--cream);font-size:12px;letter-spacing:2px;font-weight:600;text-transform:uppercase;
    transition:color 0.2s;padding:6px 0;border-bottom:2px solid transparent}
  nav.main-nav a:hover{color:var(--gold);border-bottom-color:var(--gold)}
  .nav-dropdown{position:relative}
  .nav-dropdown-toggle{color:var(--gold);font-size:12px;letter-spacing:2px;font-weight:600;text-transform:uppercase;
    cursor:pointer;padding:6px 0;border-bottom:2px solid transparent;display:inline-flex;align-items:center;gap:5px;
    user-select:none;background:none;border-top:none;border-left:none;border-right:none;font-family:inherit;transition:border-color 0.2s}
  .nav-dropdown-toggle:hover{border-bottom-color:var(--gold)}
  .nav-dropdown-toggle .chev{font-size:9px;transition:transform 0.2s}
  .nav-dropdown.open .nav-dropdown-toggle .chev{transform:rotate(180deg)}
  .nav-dropdown-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:200px;background:rgba(10,10,10,0.98);
    border:1px solid rgba(212,175,55,0.35);border-radius:12px;padding:6px;display:none;flex-direction:column;gap:2px;
    box-shadow:0 14px 36px rgba(0,0,0,0.7),0 0 30px rgba(212,175,55,0.1);z-index:200}
  .nav-dropdown.open .nav-dropdown-menu,.nav-dropdown:hover .nav-dropdown-menu{display:flex}
  .nav-dropdown-menu a{color:var(--cream)!important;font-size:11px!important;letter-spacing:2px;font-weight:600;
    text-transform:uppercase;padding:10px 14px!important;border-radius:8px;border-bottom:none!important;
    transition:background 0.15s,color 0.15s;white-space:nowrap}
  .nav-dropdown-menu a:hover{background:rgba(212,175,55,0.15);color:var(--gold)!important}
  @media(max-width:980px){
    .header-inner{justify-content:space-between}
    .menu-toggle{display:block}
    nav.main-nav{position:absolute;top:100%;right:0;background:rgba(10,10,10,0.98);flex-direction:column;gap:0;
      padding:14px 20px;border-radius:0 0 0 12px;border-left:1px solid rgba(212,175,55,0.15);
      border-bottom:1px solid rgba(212,175,55,0.15);max-height:0;overflow:hidden;transition:max-height 0.3s ease}
    nav.main-nav.open{max-height:90vh}
    nav.main-nav a{padding:12px 0;width:100%;border-bottom:1px solid rgba(212,175,55,0.10)}
    .nav-dropdown{width:100%}
    .nav-dropdown-toggle{width:100%;justify-content:space-between;padding:12px 0!important;border-bottom:1px solid rgba(212,175,55,0.10)!important}
    .nav-dropdown-menu{position:static;background:rgba(0,0,0,0.4);margin:4px 0 8px;width:100%;border:none;
      border-left:2px solid rgba(212,175,55,0.3);border-radius:0;padding:4px 0 4px 14px;box-shadow:none}
    .nav-dropdown-menu a{padding:8px 0!important}
  }
  .hero{text-align:center;padding:64px 0 32px}
  .hero h1{font-family:'Cinzel',serif;font-weight:900;font-size:clamp(2.6rem,9vw,4.8rem);line-height:1.0;
    margin:0 0 4px;text-shadow:0 0 38px rgba(212,175,55,.3)}
  .hero h1 .legende{display:block;font-size:.40em;color:var(--or);letter-spacing:.18em;margin-top:10px;font-weight:700}
  .hero .hommage{font-family:'Cinzel',serif;font-size:1.02rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;
    color:rgba(245,241,232,.72);margin:20px 0 0}
  .hero .hommage .ville{color:var(--or)}
  .hero .sub{font-size:1.02rem;color:rgba(245,241,232,.78);max-width:520px;margin:14px auto 0}
  .visual{margin:6px 0 0}
  .visual img{width:100%;height:auto;display:block;border-radius:16px;border:1px solid rgba(212,175,55,.3);box-shadow:0 18px 50px rgba(0,0,0,.5)}
  .card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
    border:1px solid rgba(212,175,55,.28);border-radius:18px;padding:34px;margin:36px 0;
    box-shadow:0 22px 60px rgba(0,0,0,.45)}
  .infos{display:grid;grid-template-columns:1fr 1fr;gap:20px 28px;margin-bottom:8px}
  .infos .item .lab{font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--or);opacity:.85}
  .infos .item .val{font-family:'Cinzel',serif;font-size:1.28rem;margin-top:4px}
  .cta{display:block;text-align:center;margin-top:26px;padding:13px;border-radius:12px;
    background:linear-gradient(135deg,var(--or),#b8902b);color:#1a1206;font-family:'Cinzel',serif;
    font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:.72rem;
    transition:transform .15s,box-shadow .15s;box-shadow:0 10px 30px rgba(212,175,55,.3)}
  .cta:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(212,175,55,.45)}
  .book-wrap{margin-top:26px}
  .book-lab{text-align:center;font-size:.66rem;letter-spacing:.18em;text-transform:uppercase;color:var(--or);opacity:.85;margin-bottom:12px}
  .book-opts{display:flex;gap:12px;flex-wrap:wrap}
  .book-opts .cta{flex:1;min-width:105px;margin-top:0}
  .cta-sec{background:transparent;border:1px solid var(--or);color:var(--or);box-shadow:none}
  .cta-sec:hover{background:rgba(212,175,55,.12);box-shadow:0 10px 30px rgba(212,175,55,.2)}
  .fan-cta{position:relative;overflow:hidden;font-size:.8rem;padding:16px;
    background:linear-gradient(135deg,#F0D77A,var(--or) 55%,#b8902b);
    box-shadow:0 12px 36px rgba(212,175,55,.45);border:1px solid rgba(245,241,232,.35)}
  .fan-cta:hover{transform:translateY(-2px);box-shadow:0 18px 48px rgba(212,175,55,.6)}
  .fan-cta::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);
    transform:skewX(-20deg);animation:fanShine 3.2s ease-in-out infinite}
  @keyframes fanShine{0%,60%{left:-60%}100%{left:130%}}
  .fan-badge{display:inline-block;background:rgba(10,10,10,.82);color:var(--gold,#D4AF37);
    font-weight:800;padding:3px 9px;border-radius:999px;margin-right:8px;font-size:.74rem;letter-spacing:.04em;vertical-align:middle}
  .fan-note{text-align:center;color:var(--smoke,#8B8580);font-size:.78rem;line-height:1.45;
    margin:14px auto 0;max-width:420px;font-style:italic}
  .fan-note strong{color:var(--cream,#F5F1E8);font-style:normal}
  .pitch{text-align:center;color:rgba(245,241,232,.82);font-size:1.02rem;margin:8px auto 0;max-width:580px}
  .stats{display:flex;justify-content:center;gap:34px;margin:30px 0;flex-wrap:wrap}
  .stats div{text-align:center}
  .stats .n{font-family:'Cinzel',serif;font-size:1.7rem;color:var(--or)}
  .stats .l{font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;opacity:.7}
  .others{margin:48px 0}
  .others h2{font-family:'Cinzel',serif;text-align:center;font-size:1.1rem;letter-spacing:.18em;
    text-transform:uppercase;color:var(--or);margin-bottom:20px}
  .others ul{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .others li a{display:flex;justify-content:space-between;align-items:center;padding:13px 16px;
    border:1px solid rgba(212,175,55,.16);border-radius:10px;font-size:.9rem;transition:border-color .2s,background .2s}
  .others li a:hover{border-color:var(--or);background:rgba(212,175,55,.06)}
  .others .o-ville{font-weight:700}
  .others .o-date{color:rgba(245,241,232,.6);font-size:.82rem}
  .dome{position:relative;text-align:center;font-family:'Cinzel',serif;letter-spacing:.1em;color:var(--creme);
    background:linear-gradient(180deg,rgba(212,175,55,.12),rgba(212,175,55,.04));
    border:1px solid rgba(212,175,55,.45);border-radius:14px;padding:18px 20px;margin:40px 0;
    animation:domeGlow 2.2s ease-in-out infinite}
  .dome strong{color:var(--or)}
  .dome-star{color:var(--or);display:inline-block;animation:domeBlink 1s steps(2,start) infinite}
  @keyframes domeBlink{0%,100%{opacity:1}50%{opacity:.12}}
  @keyframes domeGlow{0%,100%{box-shadow:0 0 18px rgba(212,175,55,.15)}50%{box-shadow:0 0 32px rgba(212,175,55,.45)}}
  /* ===== FOOTER + NEWSLETTER (identiques au site) ===== */
  footer{background:#050505;border-top:1px solid rgba(212,175,55,0.15);padding:50px 20px 24px;margin-top:60px}
  .footer-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);gap:40px}
  .footer-col h5{color:var(--gold);font-size:12px;letter-spacing:4px;font-weight:700;text-transform:uppercase;margin-bottom:14px}
  .footer-col p,.footer-col a{color:var(--cream);font-size:13px;line-height:1.8;opacity:0.85;display:block}
  .footer-col a:hover{color:var(--gold);opacity:1}
  .footer-bottom{border-top:1px solid rgba(212,175,55,0.1);margin-top:36px;padding-top:20px;text-align:center;
    color:var(--smoke);font-size:11px;letter-spacing:1px}
  .gold-text{color:var(--gold);font-weight:700}
  @media(max-width:768px){.footer-inner{grid-template-columns:1fr 1fr;gap:26px}}
  @media(max-width:500px){.footer-inner{grid-template-columns:1fr;gap:22px}}
  .newsletter-block{position:relative;z-index:3;background:linear-gradient(180deg,#0a0a0a 0%,#050505 100%);
    border-top:1px solid rgba(212,175,55,0.15);border-bottom:1px solid rgba(212,175,55,0.15);padding:50px 20px}
  .newsletter-wrap{max-width:600px;margin:0 auto;text-align:center}
  .newsletter-eyebrow{color:var(--gold);font-size:11px;letter-spacing:5px;font-weight:700;margin-bottom:10px}
  .newsletter-title{font-family:var(--serif);color:var(--cream);font-size:clamp(24px,4vw,32px);font-weight:500;letter-spacing:1px;margin-bottom:8px}
  .newsletter-text{color:var(--cream);font-size:13px;line-height:1.5;opacity:0.85;margin-bottom:22px}
  .newsletter-form{display:flex;gap:10px;max-width:480px;margin:0 auto 12px;flex-wrap:wrap;justify-content:center}
  .newsletter-form input{flex:1;min-width:200px;background:rgba(0,0,0,0.5);border:1px solid rgba(212,175,55,0.3);
    color:var(--cream);padding:12px 18px;border-radius:999px;font-family:inherit;font-size:14px;outline:none;transition:border-color 0.2s}
  .newsletter-form input:focus{border-color:var(--gold)}
  .newsletter-form input::placeholder{color:var(--smoke)}
  .newsletter-form button{display:inline-flex;align-items:center;gap:10px;background:var(--noir);color:var(--gold);
    border:1px solid rgba(212,175,55,0.4);border-left:4px solid var(--gold);border-radius:0;padding:12px 22px;
    font-family:inherit;font-size:12px;letter-spacing:3px;font-weight:800;cursor:pointer;text-transform:uppercase;
    position:relative;overflow:hidden;transition:all 0.3s;animation:royalEcarlate 1.5s ease-in-out infinite}
  .newsletter-form button::before{content:'\u2655';font-size:14px;line-height:1;color:var(--gold);transition:color 0.3s}
  .newsletter-form button:hover{background:var(--gold);color:var(--noir);border-color:var(--gold);transform:translateX(4px);animation:none}
  .newsletter-form button:hover::before{color:var(--noir)}
  .newsletter-helper{color:var(--smoke);font-size:11px;font-style:italic}
  .newsletter-success{color:#10b981;font-size:13px;margin-top:12px;display:none}
  .newsletter-success.show{display:block}
  @keyframes royalEcarlate{0%,100%{background:var(--noir);box-shadow:inset 0 0 0 rgba(139,0,0,0)}
    50%{background:linear-gradient(90deg,var(--noir) 0%,rgba(139,0,0,0.85) 50%,var(--noir) 100%);
      box-shadow:inset 0 0 20px rgba(139,0,0,0.5),0 0 16px rgba(139,0,0,0.3)}}
  footer .soc{display:flex;gap:18px;justify-content:center;margin-bottom:16px}
  footer .soc a{color:var(--or);letter-spacing:.1em;text-transform:uppercase;font-size:.72rem}
  @media(max-width:560px){.infos{grid-template-columns:1fr}.others ul{grid-template-columns:1fr}}
</style>
<!-- Meta Pixel -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','692674530241748');fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=692674530241748&ev=PageView&noscript=1"/></noscript>
<script>document.addEventListener('click',function(e){var a=(e.target&&e.target.closest)?e.target.closest('a[href]'):null;if(!a)return;var h=(a.href||'').toLowerCase();if(h.indexOf('ticketmaster')>-1||h.indexOf('fnac')>-1||h.indexOf('digitick')>-1||h.indexOf('seetickets')>-1||h.indexOf('billetterie')>-1){if(window.fbq)fbq('track','InitiateCheckout');}},true);</script>
<!-- End Meta Pixel -->
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="index.html" class="brand">
        THE WORLD OF QUEEN
        <small>L'\u00c9TERNELLE L\u00c9GENDE</small>
      </a>
      <button class="menu-toggle" onclick="toggleMenu()" aria-label="Menu">\u2630</button>
      <nav class="main-nav" id="mainNav">
        <a href="index.html" onclick="closeMenu()">LE SHOW</a>
        <a href="${SITE_ORIGIN}/${OUTPUT_DIR}/" onclick="closeMenu()" style="color:var(--gold);border-bottom-color:var(--gold);">DATES</a>
        <a href="artistes.html" onclick="closeMenu()">ARTISTES</a>
        <a href="fanzone.html" onclick="closeMenu()">FAN ZONE</a>
        <a href="medias.html" onclick="closeMenu()">M\u00c9DIAS</a>
        <a href="boutique.html" onclick="closeMenu()">\ud83d\udecd\ufe0f BOUTIQUE</a>
        <a href="moi.html" onclick="closeMenu()">MOI</a>
        <a href="contact-prod.html" onclick="closeMenu()">CONTACT PROD</a>
        <div class="nav-dropdown" id="navDropdown">
          <button type="button" class="nav-dropdown-toggle" onclick="toggleDropdown(event)">ESPACE PRO <span class="chev">\u25be</span></button>
          <div class="nav-dropdown-menu">
            <a href="espace-pro.html" onclick="closeMenu(); closeDropdown();">Espace Pro</a>
            <a href="espace-presse.html" onclick="closeMenu(); closeDropdown();">Espace Presse</a>
          </div>
        </div>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <h1>THE WORLD OF QUEEN<span class="legende">L'\u00c9ternelle L\u00e9gende</span></h1>
      <h2 class="hommage">Concert hommage \u00e0 Queen \u00b7 <span class="ville">${esc(ev.ville)}</span></h2>
      <p class="sub">Le show r\u00e9f\u00e9rence en hommage \u00e0 Freddie Mercury et \u00e0 la l\u00e9gende Queen, port\u00e9 par ${PERFORMER}.</p>
    </section>

    ${ev.photo ? `<div class="visual"><img src="${esc(ev.photo)}" alt="THE WORLD OF QUEEN \u00e0 ${esc(ev.ville)} \u2014 ${esc(ev.dt.label)}" loading="lazy"></div>` : ''}

    <section class="card">
      <div class="infos">
        <div class="item"><div class="lab">Ville</div><div class="val">${esc(ev.ville)}</div></div>
        ${ev.salle ? `<div class="item"><div class="lab">Salle</div><div class="val">${esc(ev.salle)}</div></div>` : ''}
        <div class="item"><div class="lab">Date</div><div class="val">${esc(ev.dt.label)}</div></div>
        ${ev.dt.heureLabel ? `<div class="item"><div class="lab">Heure</div><div class="val">${esc(ev.dt.heureLabel)}</div></div>` : ''}
        ${ev.prix_min ? `<div class="item"><div class="lab">\u00c0 partir de</div><div class="val">${esc(String(ev.prix_min).replace(/[^\d.,]/g,''))} \u20ac</div></div>` : ''}
      </div>
      ${ctaHtml}
    </section>

    <p class="pitch">Plongez pendant plus de deux heures dans le r\u00e9pertoire de Queen \u2014 Bohemian Rhapsody, We Will Rock You, The Show Must Go On, Don't Stop Me Now \u2014 dans une mise en sc\u00e8ne spectaculaire faite d'effets sp\u00e9ciaux et de pyrotechnie.</p>

    <div class="stats">
      <div><div class="n">1,3M</div><div class="l">Spectateurs</div></div>
      <div><div class="n">N\u00b01</div><div class="l">Ventes France</div></div>
      <div><div class="n">N\u00b01</div><div class="l">Hommage Queen</div></div>
    </div>

    <div class="dome"><span class="dome-star">\u2605</span> Et le grand rendez-vous : <strong>${DOME_RAPPEL}</strong> <span class="dome-star">\u2605</span></div>

    ${picked.length ? `<section class="others">
      <h2>Les prochaines dates</h2>
      <ul>
          ${othersHtml}
      </ul>
    </section>` : ''}
  </main>

  <section class="newsletter-block">
    <div class="newsletter-wrap">
      <div class="newsletter-eyebrow">RESTE INFORM\u00c9</div>
      <h3 class="newsletter-title">Abonnez-vous \u00e0 la newsletter</h3>
      <p class="newsletter-text">Nouvelles dates, coulisses exclusives, concours &amp; promos \u2014 directement dans ta bo\u00eete mail.</p>
      <form class="newsletter-form" onsubmit="event.preventDefault(); subscribeNewsletter(this);">
        <input type="email" placeholder="ton.email@exemple.com" required />
        <button type="submit">S'abonner</button>
      </form>
      <div class="newsletter-helper">\ud83d\udce7 Tu peux te d\u00e9sabonner \u00e0 tout moment \u00b7 Aucun spam, promis.</div>
      <div class="newsletter-success" id="newsletterSuccess">\u2705 Merci ! Tu es bien inscrit\u00b7e \u00e0 la newsletter TWOQ \ud83c\udfa4</div>
    </div>
  </section>

  <footer>
    <div class="footer-inner">
      <div class="footer-col">
        <h5>THE WORLD OF QUEEN</h5>
        <p>L'\u00c9ternelle L\u00e9gende \u2014 Le show r\u00e9f\u00e9rence en hommage \u00e0 Queen, produit par Oh My Prod.</p>
      </div>
      <div class="footer-col">
        <h5>Navigation</h5>
        <a href="index.html">Le Show</a>
        <a href="${SITE_ORIGIN}/${OUTPUT_DIR}/">Dates Tour</a>
        <a href="artistes.html">Artistes</a>
        <a href="fanzone.html">Fan Zone</a>
        <a href="medias.html">M\u00e9dias</a>
        <a href="moi.html">Mon Espace</a>
      </div>
      <div class="footer-col">
        <h5>Professionnels</h5>
        <a href="contact-prod.html">Contact Prod</a>
        <a href="espace-pro.html">Espace Pro</a>
        <a href="espace-presse.html">Espace Presse</a>
        <a href="https://app.theworldofqueen.com" target="_blank">Appli TWOQ \u2197</a>
      </div>
      <div class="footer-col">
        <h5>Contact</h5>
        <p>SAS OH MY PROD</p>
        <a href="mailto:contact@theworldofqueen.com" class="footer-mail-btn">\u2709\ufe0f Nous \u00e9crire</a>
      </div>
    </div>
    <div class="footer-bottom">
      \u00a9 2026 <span class="gold-text">THE WORLD OF QUEEN</span> \u2014 Production <span class="gold-text">OH MY PROD</span>. Tous droits r\u00e9serv\u00e9s.
    </div>
  </footer>

  <script>
    function toggleMenu(){ var n=document.getElementById('mainNav'); if(n) n.classList.toggle('open'); }
    function closeMenu(){ var n=document.getElementById('mainNav'); if(n) n.classList.remove('open'); }
    function toggleDropdown(e){ if(e) e.stopPropagation(); var dd=document.getElementById('navDropdown'); if(dd) dd.classList.toggle('open'); }
    function closeDropdown(){ var dd=document.getElementById('navDropdown'); if(dd) dd.classList.remove('open'); }
    document.addEventListener('click', function(e){ var dd=document.getElementById('navDropdown'); if(dd && !dd.contains(e.target)) dd.classList.remove('open'); });
    async function subscribeNewsletter(form){
      var input=form.querySelector('input');
      var email=(input.value||'').trim().toLowerCase();
      if(!email) return;
      var success=document.getElementById('newsletterSuccess');
      try{
        var res=await fetch('https://nhxqcavianozskxgfcbt.supabase.co/rest/v1/newsletter_subscribers',{
          method:'POST',
          headers:{'apikey':'sb_publishable_59Pg7368sxCT6y3j9nNw0g_i8ILGRZ3','Authorization':'Bearer sb_publishable_59Pg7368sxCT6y3j9nNw0g_i8ILGRZ3','Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify({email:email, source:window.location.pathname})
        });
        if(!res.ok && res.status!==409) console.warn('[Newsletter] HTTP', res.status);
      }catch(e){ console.warn('[Newsletter]', e); }
      form.style.display='none';
      if(success) success.classList.add('show');
    }
  </script>
</body>
</html>`;
}

/* ============================================================
   Template de la page d'INDEX  ->  /concerts/  (maillage interne)
   ============================================================ */
function renderIndex(events) {
  const canonical = `${SITE_ORIGIN}/${OUTPUT_DIR}/`;
  const title = `Dates de tourn\u00e9e 2026 \u2013 THE WORLD OF QUEEN | Toutes les villes`;
  const villes = [...new Set(events.map(e => e.ville))];
  const desc = `Toutes les dates de THE WORLD OF QUEEN \u2013 L'\u00c9ternelle L\u00e9gende : ${events.length} concerts hommage \u00e0 Queen et Freddie Mercury partout en France, avec ${PERFORMER}. Trouvez votre ville et r\u00e9servez vos billets.`;

  // JSON-LD ItemList (liste des pages de dates)
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Dates de tourn\u00e9e \u2014 The World of Queen',
    itemListElement: events.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_ORIGIN}/${OUTPUT_DIR}/${e.slug}/`,
      name: `${e.ville} \u2014 ${e.dt.label}`,
    })),
  };

  // Groupage par mois
  const groups = []; const idx = {};
  events.forEach(e => {
    const key = `${e.dt.y}-${String(e.dt.mo).padStart(2, '0')}`;
    if (idx[key] === undefined) { idx[key] = groups.length; groups.push({ label: `${MOIS[e.dt.mo - 1]} ${e.dt.y}`, items: [] }); }
    groups[idx[key]].items.push(e);
  });

  const badge = (e) => e.cancelled ? '<span class="badge annul">Annul\u00e9</span>'
    : e.soldout ? '<span class="badge complet">Complet</span>'
    : '<span class="badge vente">En vente</span>';

  const groupsHtml = groups.map(g => `
      <section class="month">
        <h2>${esc(g.label.charAt(0).toUpperCase() + g.label.slice(1))}</h2>
        <ul class="dates">
          ${g.items.map(e => `<li>
            <a class="d-main" href="${SITE_ORIGIN}/${OUTPUT_DIR}/${e.slug}/">
              <div class="d-left">
                <div class="d-ville">${esc(e.ville)}</div>
                ${e.salle ? `<div class="d-salle">${esc(e.salle)}</div>` : ''}
              </div>
              <div class="d-right">
                <div class="d-date">${esc(e.dt.label)}${e.dt.heureLabel ? ' \u00b7 ' + esc(e.dt.heureLabel) : ''}</div>
                ${badge(e)}
              </div>
            </a>
            <a class="d-book" href="${withUtm(resolveBooking(e), e.slug)}" target="_blank" rel="nofollow noopener">\ud83c\udf9f\ufe0f R\u00e9server</a>
          </li>`).join('\n          ')}
        </ul>
      </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="The World of Queen">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(itemList)}</script>
<style>
  :root{--noir:#0A0A0A;--or:#D4AF37;--cramoisi:#8B0000;--creme:#F5F1E8;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--noir);color:var(--creme);font-family:'Manrope',sans-serif;line-height:1.6;
    background-image:radial-gradient(ellipse at 50% -10%,rgba(212,175,55,.10),transparent 55%),
      radial-gradient(ellipse at 50% 110%,rgba(139,0,0,.18),transparent 55%);min-height:100vh}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:860px;margin:0 auto;padding:0 24px}
  header{padding:28px 0;text-align:center;border-bottom:1px solid rgba(212,175,55,.18)}
  header .logo{height:46px;width:auto;opacity:.95}
  nav{display:flex;gap:22px;justify-content:center;margin-top:16px;font-size:.74rem;letter-spacing:.14em;text-transform:uppercase}
  nav a{color:rgba(245,241,232,.6);transition:color .2s}
  nav a:hover,nav a.active{color:var(--or)}
  .hero{text-align:center;padding:60px 0 18px}
  .hero .kicker{font-family:'Cinzel',serif;letter-spacing:.34em;font-size:.78rem;color:var(--or);text-transform:uppercase}
  .hero h1{font-family:'Cinzel',serif;font-weight:900;font-size:clamp(2.2rem,7vw,3.6rem);line-height:1.04;margin:14px 0 6px;text-shadow:0 0 38px rgba(212,175,55,.25)}
  .hero .sub{font-size:1.05rem;color:rgba(245,241,232,.78);max-width:600px;margin:8px auto 0}
  .intro{text-align:center;color:rgba(245,241,232,.78);max-width:680px;margin:18px auto 10px;font-size:.98rem}
  .month{margin:38px 0 0}
  .month h2{font-family:'Cinzel',serif;font-size:1.05rem;letter-spacing:.2em;text-transform:uppercase;color:var(--or);
    padding-bottom:10px;border-bottom:1px solid rgba(212,175,55,.18);margin-bottom:16px}
  ul.dates{list-style:none;display:grid;gap:10px}
  ul.dates li{display:flex;align-items:stretch;gap:10px}
  ul.dates li a.d-main{flex:1;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 20px;
    background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.015));
    border:1px solid rgba(212,175,55,.18);border-radius:12px;transition:border-color .2s,transform .15s,background .2s}
  ul.dates li a.d-main:hover{border-color:var(--or);transform:translateY(-2px);background:rgba(212,175,55,.06)}
  a.d-book{flex-shrink:0;display:flex;align-items:center;padding:0 22px;border-radius:12px;
    background:linear-gradient(135deg,var(--or),#b8902b);color:#1a1206;font-family:'Cinzel',serif;font-weight:700;
    font-size:.74rem;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;transition:transform .15s,box-shadow .15s}
  a.d-book:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(212,175,55,.4)}
  .d-ville{font-family:'Cinzel',serif;font-size:1.3rem;font-weight:700}
  .d-salle{font-size:.82rem;color:rgba(245,241,232,.6);margin-top:2px}
  .d-right{text-align:right;flex-shrink:0}
  .d-date{font-size:.92rem;color:var(--creme)}
  .badge{display:inline-block;margin-top:6px;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;
    padding:3px 9px;border-radius:20px;font-weight:700}
  .badge.vente{background:rgba(212,175,55,.14);color:var(--or);border:1px solid rgba(212,175,55,.4)}
  .badge.complet{background:rgba(139,0,0,.25);color:#ff8a8a;border:1px solid rgba(139,0,0,.6)}
  .badge.annul{background:rgba(120,120,120,.2);color:#bbb;border:1px solid rgba(120,120,120,.4)}
  .dome{text-align:center;font-family:'Cinzel',serif;letter-spacing:.12em;color:var(--or);
    border-top:1px solid rgba(212,175,55,.18);border-bottom:1px solid rgba(212,175,55,.18);padding:18px;margin:46px 0}
  footer{text-align:center;padding:40px 0 60px;border-top:1px solid rgba(212,175,55,.14);color:rgba(245,241,232,.5);font-size:.82rem}
  footer .soc{display:flex;gap:18px;justify-content:center;margin-bottom:16px}
  footer .soc a{color:var(--or);letter-spacing:.1em;text-transform:uppercase;font-size:.72rem}
  @media(max-width:560px){ul.dates li{flex-direction:column}ul.dates li a.d-main{flex-direction:column;align-items:flex-start;gap:8px}.d-right{text-align:left}a.d-book{justify-content:center;padding:13px}}
</style>
<!-- Meta Pixel -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','692674530241748');fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=692674530241748&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel -->
</head>
<body>
  <header>
    <div class="wrap">
      <a href="${SITE_ORIGIN}/"><img class="logo" src="${LOGO}" alt="The World of Queen \u2013 L'\u00c9ternelle L\u00e9gende"></a>
      <nav>
        <a href="${SITE_ORIGIN}/index.html">Le Show</a>
        <a href="${SITE_ORIGIN}/${OUTPUT_DIR}/" class="active">Dates</a>
        <a href="${SITE_ORIGIN}/artistes.html">Artistes</a>
        <a href="https://app.theworldofqueen.com">Appli TWOQ</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <div class="kicker">L'\u00c9ternelle L\u00e9gende \u2014 Tourn\u00e9e 2026</div>
      <h1>Toutes les dates<br>de la tourn\u00e9e</h1>
      <p class="sub">THE WORLD OF QUEEN \u2014 le show hommage n\u00b01 \u00e0 Queen et Freddie Mercury, port\u00e9 par ${PERFORMER}, en concert dans toute la France.</p>
    </section>

    <p class="intro">Retrouvez ci-dessous l'ensemble des concerts de THE WORLD OF QUEEN : ${events.length} dates dans ${villes.length} villes. Cliquez sur votre ville pour les informations pratiques (salle, horaire) et r\u00e9server vos billets.</p>

    ${groupsHtml}

    <div class="dome">\u2605 Le grand rendez-vous : ${DOME_RAPPEL} \u2605</div>
  </main>

  <footer>
    <div class="wrap">
      <div class="soc">
        <a href="https://www.facebook.com/theworldofqueen/">Facebook</a>
        <a href="https://www.instagram.com/theworldofqueenofficiel/">Instagram</a>
        <a href="https://www.youtube.com/@THEWORLDOFQUEENOFFICIEL-pn9xl">YouTube</a>
        <a href="https://www.tiktok.com/@theworldofqueenofficiel">TikTok</a>
      </div>
      THE WORLD OF QUEEN \u2014 L'\u00c9ternelle L\u00e9gende \u00b7 Production ${ORG_NAME}
    </div>
  </footer>
</body>
</html>`;
}

/* ============================================================
   HUB /concerts/ cloné depuis dates.html (look + filtres + étoiles)
   On garde TOUT le code de dates.html, on greffe juste :
   - les cartes en dur (lisibles par Google)
   - les lignes deviennent des liens vers les pages de présentation
   ============================================================ */
const MOIS_COURT = ['JAN', 'F\u00c9V', 'MAR', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AO\u00dbT', 'SEP', 'OCT', 'NOV', 'D\u00c9C'];

const PROMO_BANNER = `<div class="promo-banner promo-banner-inline" onclick="toggleLevelsModal()" role="button" tabindex="0" style="cursor:pointer;">
        <div class="promo-banner-icon">\u26a1</div>
        <div class="promo-banner-content">
          <div class="promo-banner-title">TARIFS R\u00c9DUITS<span class="pct">-10%</span></div>
          <div class="promo-banner-text">R\u00e9serv\u00e9s aux membres \ud83e\udd47 OR &amp; \ud83d\udc8e PLATINE \u00b7 Sur ~90% des dates*</div>
          <span class="promo-banner-link">\u2192 Voir les avantages des niveaux</span>
        </div>
      </div>`;

// Construit les cartes de dates EN DUR (mêmes classes que dates.html), en liens vers /concerts/<slug>/
function bakeCards(events) {
  const groups = []; const idx = {};
  events.forEach(e => {
    const key = `${e.dt.y}-${String(e.dt.mo).padStart(2, '0')}`;
    if (idx[key] === undefined) { idx[key] = groups.length; groups.push({ label: `${MOIS[e.dt.mo - 1]} ${e.dt.y}`, items: [] }); }
    groups[idx[key]].items.push(e);
  });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const rowOf = (e) => {
    const st = (e.statut || '').toUpperCase();
    let badge = '', extra = '';
    if (st === 'COMPLET') { badge = '<span class="status-badge complet">COMPLET</span>'; extra = 'complet'; }
    else if (st === 'BIENTOT' || st === 'BIENT\u00d4T' || st === 'BIENTOT_EN_VENTE') { badge = '<span class="status-badge bientot">BIENT\u00d4T</span>'; extra = 'bientot'; }
    const href = `${SITE_ORIGIN}/${OUTPUT_DIR}/${e.slug}/`;
    return `<a class="date-row ${extra}" href="${href}">
          <div class="date-box"><div class="date-num">${e.dt.d}</div><div class="date-mois">${MOIS_COURT[e.dt.mo - 1]}</div></div>
          <div class="date-info"><div class="date-ville">${esc(e.ville)}${badge}</div><div class="date-salle">${esc(e.salle || '')}</div></div>
          <div class="date-arrow">\u2192</div>
        </a>`;
  };
  let html = '';
  groups.forEach((g, i) => {
    if (i % 3 === 0) html += `\n      ${PROMO_BANNER}`;   // bandeau -10% répété (plusieurs fois)
    html += `
      <div class="month-group">
        <div class="month-title">${cap(g.label)}</div>
        ${g.items.map(rowOf).join('\n        ')}
      </div>`;
  });
  return html;
}

// Transforme le contenu de dates.html en hub /concerts/ crawlable
function buildHubFromTemplate(events, tpl) {
  let html = tpl;

  // 1) <base> + canonical : liens relatifs vers la racine, et URL canonique = /concerts/
  html = html.replace('<head>', `<head>\n<base href="${SITE_ORIGIN}/">\n<link rel="canonical" href="${SITE_ORIGIN}/${OUTPUT_DIR}/">\n<!-- Meta Pixel -->\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','692674530241748');fbq('track','PageView');</script>\n<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=692674530241748&ev=PageView&noscript=1"/></noscript>\n<!-- End Meta Pixel -->`);

  // 2) Nav "DATES" -> pointe vers la page elle-même
  html = html.replace(
    '<a href="dates.html" onclick="closeMenu()" style="color:var(--gold);border-bottom-color:var(--gold);">DATES</a>',
    `<a href="${SITE_ORIGIN}/${OUTPUT_DIR}/" onclick="closeMenu()" style="color:var(--gold);border-bottom-color:var(--gold);">DATES</a>`
  );

  // 2b) Repointe tout autre lien vers dates.html (footer, etc.) vers le hub
  html = html.split('href="dates.html"').join(`href="${SITE_ORIGIN}/${OUTPUT_DIR}/"`);

  // 3) Cartes EN DUR à la place du "Chargement..." (lisibles par Google)
  html = html.replace(
    '<div class="loading-state">\u23f3 Chargement des dates...</div>',
    `<!-- SEO : dates en dur, lisibles par Google. Le JS ci-dessous les rafra\u00eechit pour les visiteurs. -->${bakeCards(events)}`
  );

  // 4) Avant </body> : style des liens-cartes + override JS (lignes = liens vers la page de date)
  const inject = `
<style>a.date-row{color:inherit;text-decoration:none;}</style>
<script>
/* Hub SEO /concerts/ : les lignes de date deviennent des liens vers la page de pr\u00e9sentation */
function _seoConcertUrl(d){
  var MOIS=['janvier','f\u00e9vrier','mars','avril','mai','juin','juillet','ao\u00fbt','septembre','octobre','novembre','d\u00e9cembre'];
  var dt=new Date(d.date_concert+'T00:00:00');
  var v=(d.ville||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return '${SITE_ORIGIN}/${OUTPUT_DIR}/concert-queen-'+v+'-'+dt.getDate()+'-'+MOIS[dt.getMonth()]+'-'+dt.getFullYear()+'/';
}
function renderDateRow(d){
  var dt=new Date(d.date_concert+'T00:00:00');
  var moisCourt=['JAN','F\u00c9V','MAR','AVR','MAI','JUIN','JUIL','AO\u00dbT','SEP','OCT','NOV','D\u00c9C'];
  var statut=(d.statut_public||'').toUpperCase();
  var badge='',extra='';
  if(statut==='COMPLET'){badge='<span class="status-badge complet">COMPLET</span>';extra='complet';}
  else if(statut==='BIENTOT'||statut==='BIENT\u00d4T'||statut==='BIENTOT_EN_VENTE'){badge='<span class="status-badge bientot">BIENT\u00d4T</span>';extra='bientot';}
  return '<a class="date-row '+extra+'" href="'+_seoConcertUrl(d)+'">'
    +'<div class="date-box"><div class="date-num">'+dt.getDate()+'</div><div class="date-mois">'+moisCourt[dt.getMonth()]+'</div></div>'
    +'<div class="date-info"><div class="date-ville">'+escapeHtml(d.ville||'')+badge+'</div><div class="date-salle">'+escapeHtml(d.nom_salle||'')+'</div></div>'
    +'<div class="date-arrow">\u2192</div></a>';
}
function attachRowHandlers(){}
</script>
`;
  html = html.replace('</body>', `${inject}\n</body>`);
  return html;
}

/* ============================================================
   Sitemap + robots
   ============================================================ */
function renderSitemap(events) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = ['/', '/artistes.html', '/fanzone.html', '/medias.html', '/boutique.html', '/contact-prod.html', '/espace-presse.html'];
  const urls = [
    ...staticPages.map(p => ({ loc: SITE_ORIGIN + p, pri: p === '/' ? '1.0' : '0.7' })),
    { loc: `${SITE_ORIGIN}/${OUTPUT_DIR}/`, pri: '0.95' },   // page-hub des dates (maillage interne)
    ...events.map(e => ({ loc: `${SITE_ORIGIN}/${OUTPUT_DIR}/${e.slug}/`, pri: '0.9' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>`;
}

const ROBOTS = `User-agent: *
Allow: /

Sitemap: ${SITE_ORIGIN}/sitemap.xml`;

/* ============================================================
   Données
   ============================================================ */
const MOCK_ROWS = [
  { id: 1, tournee_id: '222', date_concert: '2026-09-19', heure_show: '20h30', ville: 'Narbonne', nom_salle: 'Narbonne Arena', statut_public: 'en_vente', lien_billetterie_principal: 'https://www.ticketmaster.fr/fr/manifestation/the-world-of-queen-billet/idmanif/635440', date_open_mev: '2026-02-01', nom_tournee: "L'\u00c9ternelle L\u00e9gende", photo_url: 'https://regisohmyprod-sys.github.io/twoq-pwa/assets/VISUEL_3.jpeg' },
  { id: 2, tournee_id: '222', date_concert: '2026-11-28', heure_show: '20h00', ville: 'Paris', nom_salle: 'D\u00f4me de Paris', statut_public: 'en_vente', lien_billetterie_principal: 'https://www.ticketmaster.fr/fr/manifestation/the-world-of-queen-billet/idmanif/000000', date_open_mev: '2026-03-15', nom_tournee: "L'\u00c9ternelle L\u00e9gende", photo_url: '' },
  { id: 3, tournee_id: '222', date_concert: '2026-10-10', heure_show: '20h30', ville: 'Bourg-en-Bresse', nom_salle: 'Ainterexpo', statut_public: 'en_vente', lien_billetterie_principal: 'https://www.theworldofqueen.com/dates.html', date_open_mev: null, nom_tournee: "L'\u00c9ternelle L\u00e9gende", photo_url: '' },
];

async function fetchRows() {
  if (process.env.MOCK === '1') {
    console.log('\u26a0\ufe0f  Mode MOCK : 3 dates factices (aucun appel Supabase).');
    return MOCK_ROWS;
  }
  if (!SUPABASE_ANON) {
    console.error('\u274c  SUPABASE_ANON_KEY manquante. Lance avec SUPABASE_ANON_KEY="..." ou MOCK=1 pour un aper\u00e7u.');
    process.exit(1);
  }
  const url = `${SUPABASE_URL}/rest/v1/${SOURCE_VIEW}?select=*`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } });
  if (!res.ok) {
    console.error(`\u274c  Supabase ${res.status} : ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

function normalize(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  rows.forEach((row, i) => {
    const ville = pick(row, COLS.ville);
    const dt = parseDate(pick(row, COLS.date), pick(row, COLS.heure));
    if (!ville || !dt) return; // ligne inexploitable
    if (!INCLUDE_PAST && dt.jsDate < today) return;
    const statut = String(pick(row, COLS.statut) || '').toLowerCase();
    out.push({
      ville,
      salle: pick(row, COLS.salle),
      url: pick(row, COLS.url),
      prix_min: pick(row, COLS.prix_min),
      photo: pick(row, COLS.photo),
      openMev: pick(row, COLS.open_mev),
      liens: row.liens_billetterie ?? null,
      statut,
      soldout: /complet|sold/.test(statut),
      cancelled: /annul|cancel/.test(statut),
      dt,
      slug: `concert-queen-${slugify(ville)}-${dt.d}-${MOIS[dt.mo - 1]}-${dt.y}`,
    });
  });
  // dédoublonne les slugs identiques (2 dates même ville/jour très rare)
  const seen = {};
  out.forEach(e => { if (seen[e.slug]) e.slug += '-' + (++seen[e.slug]); else seen[e.slug] = 1; });
  return out.sort((a, b) => a.dt.jsDate - b.dt.jsDate);
}

/* ============================================================
   Main
   ============================================================ */
(async () => {
  const rows = await fetchRows();
  if (rows[0]) console.log('\u2139\ufe0f  Colonnes d\u00e9tect\u00e9es :', Object.keys(rows[0]).join(', '));

  const events = normalize(rows);
  if (!events.length) { console.error('\u274c  Aucune date exploitable. V\u00e9rifie le mapping COLS.'); process.exit(1); }

  if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  events.forEach(ev => {
    const others = events.filter(o => o.slug !== ev.slug);
    const dir = join(OUTPUT_DIR, ev.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderPage(ev, others).replace('</body>', JOIN_POPUP + '\n</body>'), 'utf8');
    console.log(`  \u2713 /${OUTPUT_DIR}/${ev.slug}/`);
  });

  // Page d'index /concerts/ : clonée depuis dates.html si présent, sinon hub simple
  let datesTpl = null;
  try { datesTpl = readFileSync('dates.html', 'utf8'); } catch { datesTpl = null; }
  if (datesTpl) {
    writeFileSync(join(OUTPUT_DIR, 'index.html'), buildHubFromTemplate(events, datesTpl).replace('</body>', JOIN_POPUP + '\n</body>'), 'utf8');
    console.log(`  \u2713 /${OUTPUT_DIR}/  (hub clon\u00e9 de dates.html \u2014 ${events.length} dates en dur)`);
  } else {
    writeFileSync(join(OUTPUT_DIR, 'index.html'), renderIndex(events), 'utf8');
    console.log(`  \u2713 /${OUTPUT_DIR}/  (hub simple \u2014 dates.html introuvable)`);
  }

  writeFileSync('sitemap.xml', renderSitemap(events), 'utf8');
  writeFileSync('robots.txt', ROBOTS, 'utf8');

  console.log(`\n\u2705  ${events.length} page(s) g\u00e9n\u00e9r\u00e9e(s) + sitemap.xml + robots.txt`);
})();
