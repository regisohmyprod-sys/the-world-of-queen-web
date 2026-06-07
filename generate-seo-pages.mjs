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

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* ============================================================
   CONFIG — vérifie/ajuste selon ta vraie installation
   ============================================================ */
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://nhxqcavianozskxgfcbt.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';      // clé "anon" publique (déjà présente dans le JS de ton site)
const SOURCE_VIEW   = process.env.SOURCE_VIEW   || 'public_dates_twoq'; // vue publique des dates
const SITE_ORIGIN   = 'https://www.theworldofqueen.com';
const OUTPUT_DIR    = 'concerts';                              // dossier de sortie (relatif à la racine du repo site)
const TOUR_NAME     = "THE WORLD OF QUEEN \u2013 L'\u00c9ternelle L\u00e9gende";
const PERFORMER     = 'Fred Caramia';
const ORG_NAME      = 'Oh My Prod';
const ORG_URL       = 'https://www.ohmyprod.com';
const OG_IMAGE      = 'https://regisohmyprod-sys.github.io/twoq-pwa/assets/banner-twoq.jpg';
const LOGO          = 'https://regisohmyprod-sys.github.io/twoq-pwa/icons/logo-twoq-titre.png';
const DOME_RAPPEL   = 'D\u00f4me de Paris \u2014 28 novembre 2026';
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

/* ============================================================
   Template d'une page de date
   ============================================================ */
function renderPage(ev, others) {
  const title = `THE WORLD OF QUEEN \u00e0 ${esc(ev.ville)} \u2014 ${esc(ev.dt.label)}${ev.salle ? ' \u00b7 ' + esc(ev.salle) : ''}`;
  const desc = `THE WORLD OF QUEEN \u2013 L'\u00c9ternelle L\u00e9gende \u00e0 ${esc(ev.ville)}${ev.salle ? ', ' + esc(ev.salle) : ''}, le ${esc(ev.dt.label)}${ev.dt.heureLabel ? ' \u00e0 ' + esc(ev.dt.heureLabel) : ''}. Le show hommage n\u00b01 \u00e0 Freddie Mercury (1,3M de spectateurs), avec Fred Caramia. R\u00e9servez vos billets.`;
  const canonical = `${SITE_ORIGIN}/${OUTPUT_DIR}/${ev.slug}/`;
  const reserveUrl = ev.url ? withUtm(ev.url, ev.slug) : `${SITE_ORIGIN}/dates.html`;
  const ogImg = ev.photo || OG_IMAGE;

  // JSON-LD MusicEvent
  const offers = ev.url ? {
    '@type': 'Offer',
    url: ev.url,
    priceCurrency: 'EUR',
    ...(ev.prix_min ? { price: String(ev.prix_min).replace(/[^\d.]/g, '') } : {}),
    availability: ev.soldout ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    ...(ev.openMev ? { validFrom: String(ev.openMev).slice(0, 10) } : {}),
  } : undefined;

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

  // Autres dates (maillage interne)
  const othersHtml = others.slice(0, 8).map(o =>
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
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
  :root{--noir:#0A0A0A;--or:#D4AF37;--cramoisi:#8B0000;--creme:#F5F1E8;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--noir);color:var(--creme);font-family:'Manrope',sans-serif;line-height:1.6;
    background-image:radial-gradient(ellipse at 50% -10%,rgba(212,175,55,.10),transparent 55%),
      radial-gradient(ellipse at 50% 110%,rgba(139,0,0,.18),transparent 55%);min-height:100vh}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:760px;margin:0 auto;padding:0 24px}
  header{padding:28px 0;text-align:center;border-bottom:1px solid rgba(212,175,55,.18)}
  header .logo{height:46px;width:auto;opacity:.95}
  nav{display:flex;gap:22px;justify-content:center;margin-top:16px;font-size:.74rem;letter-spacing:.14em;text-transform:uppercase}
  nav a{color:rgba(245,241,232,.6);transition:color .2s}
  nav a:hover{color:var(--or)}
  .hero{text-align:center;padding:64px 0 32px}
  .hero .kicker{font-family:'Cinzel',serif;letter-spacing:.34em;font-size:.78rem;color:var(--or);text-transform:uppercase}
  .hero h1{font-family:'Cinzel',serif;font-weight:900;font-size:clamp(2.6rem,9vw,4.6rem);line-height:1.02;
    margin:14px 0 6px;text-shadow:0 0 38px rgba(212,175,55,.25)}
  .hero h1 .ville{color:var(--or);display:block}
  .hero .sub{font-size:1.05rem;color:rgba(245,241,232,.78);max-width:520px;margin:8px auto 0}
  .visual{margin:6px 0 0}
  .visual img{width:100%;height:auto;display:block;border-radius:16px;border:1px solid rgba(212,175,55,.3);box-shadow:0 18px 50px rgba(0,0,0,.5)}
  .card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
    border:1px solid rgba(212,175,55,.28);border-radius:18px;padding:34px;margin:36px 0;
    box-shadow:0 22px 60px rgba(0,0,0,.45)}
  .infos{display:grid;grid-template-columns:1fr 1fr;gap:20px 28px;margin-bottom:8px}
  .infos .item .lab{font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--or);opacity:.85}
  .infos .item .val{font-family:'Cinzel',serif;font-size:1.28rem;margin-top:4px}
  .cta{display:block;text-align:center;margin-top:26px;padding:18px;border-radius:12px;
    background:linear-gradient(135deg,var(--or),#b8902b);color:#1a1206;font-family:'Cinzel',serif;
    font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:1rem;
    transition:transform .15s,box-shadow .15s;box-shadow:0 10px 30px rgba(212,175,55,.3)}
  .cta:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(212,175,55,.45)}
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
  .dome{text-align:center;font-family:'Cinzel',serif;letter-spacing:.12em;color:var(--or);
    border-top:1px solid rgba(212,175,55,.18);border-bottom:1px solid rgba(212,175,55,.18);padding:18px;margin:40px 0}
  footer{text-align:center;padding:40px 0 60px;border-top:1px solid rgba(212,175,55,.14);
    color:rgba(245,241,232,.5);font-size:.82rem}
  footer .soc{display:flex;gap:18px;justify-content:center;margin-bottom:16px}
  footer .soc a{color:var(--or);letter-spacing:.1em;text-transform:uppercase;font-size:.72rem}
  @media(max-width:560px){.infos{grid-template-columns:1fr}.others ul{grid-template-columns:1fr}}
</style>
</head>
<body>
  <header>
    <div class="wrap">
      <a href="${SITE_ORIGIN}/"><img class="logo" src="${LOGO}" alt="The World of Queen \u2013 L'\u00c9ternelle L\u00e9gende"></a>
      <nav>
        <a href="${SITE_ORIGIN}/index.html">Le Show</a>
        <a href="${SITE_ORIGIN}/dates.html">Dates</a>
        <a href="${SITE_ORIGIN}/artistes.html">Artistes</a>
        <a href="https://app.theworldofqueen.com">Appli TWOQ</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <div class="kicker">The World of Queen \u2014 L'\u00c9ternelle L\u00e9gende</div>
      <h1>Concert hommage \u00e0 Queen<span class="ville">\u00e0 ${esc(ev.ville)}</span></h1>
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
      <a class="cta" href="${reserveUrl}" rel="nofollow noopener" target="_blank">R\u00e9server mes billets</a>
    </section>

    <p class="pitch">Plongez pendant plus de deux heures dans le r\u00e9pertoire de Queen \u2014 Bohemian Rhapsody, We Will Rock You, The Show Must Go On, Don't Stop Me Now \u2014 dans une mise en sc\u00e8ne spectaculaire faite d'effets sp\u00e9ciaux et de pyrotechnie.</p>

    <div class="stats">
      <div><div class="n">1,3M</div><div class="l">Spectateurs</div></div>
      <div><div class="n">N\u00b01</div><div class="l">Ventes France</div></div>
      <div><div class="n">N\u00b01</div><div class="l">Hommage Queen</div></div>
    </div>

    <div class="dome">\u2605 Et le grand rendez-vous : ${DOME_RAPPEL} \u2605</div>

    ${others.length ? `<section class="others">
      <h2>Les autres dates de la tourn\u00e9e</h2>
      <ul>
          ${othersHtml}
      </ul>
    </section>` : ''}
  </main>

  <footer>
    <div class="wrap">
      <div class="soc">
        <a href="https://www.facebook.com/theworldofqueen/">Facebook</a>
        <a href="https://www.instagram.com/theworldofqueenofficiel/">Instagram</a>
        <a href="https://www.youtube.com/@THEWORLDOFQUEENOFFICIEL-pn9xl">YouTube</a>
        <a href="https://www.tiktok.com/@theworldofqueenofficiel">TikTok</a>
      </div>
      THE WORLD OF QUEEN \u2014 L'\u00c9ternelle L\u00e9gende \u00b7 Production ${ORG_NAME}<br>
      <a href="${SITE_ORIGIN}/dates.html" style="color:var(--or)">Voir toutes les dates de tourn\u00e9e \u2192</a>
    </div>
  </footer>
</body>
</html>`;
}

/* ============================================================
   Sitemap + robots
   ============================================================ */
function renderSitemap(events) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = ['/', '/dates.html', '/artistes.html', '/fanzone.html', '/medias.html', '/boutique.html', '/contact-prod.html', '/espace-presse.html'];
  const urls = [
    ...staticPages.map(p => ({ loc: SITE_ORIGIN + p, pri: p === '/' ? '1.0' : '0.7' })),
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
    writeFileSync(join(dir, 'index.html'), renderPage(ev, others), 'utf8');
    console.log(`  \u2713 /${OUTPUT_DIR}/${ev.slug}/`);
  });

  writeFileSync('sitemap.xml', renderSitemap(events), 'utf8');
  writeFileSync('robots.txt', ROBOTS, 'utf8');

  console.log(`\n\u2705  ${events.length} page(s) g\u00e9n\u00e9r\u00e9e(s) + sitemap.xml + robots.txt`);
})();
