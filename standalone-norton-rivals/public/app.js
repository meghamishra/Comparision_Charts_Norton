'use strict';
/**
 * Norton vs Other Companies — standalone dashboard UI (no build step,
 * no libraries). Mirrors the hosted dashboard's current state:
 *
 * - 5 tabs: Only {company} · Privacy Features · Brokers · Tiers & Cost ·
 *   Proof. Company selection is ONE global picker in the sticky
 *   header: the user picks a company once (Optery by default) and that
 *   selection is reflected on every tab at once.
 * - First page pie ("Products compared") has exactly THREE segments:
 *   "Offered by {company} — not by Norton", "Offered by both —
 *   differently", "Offered by Norton — not by {company}". There is no
 *   same-way "Offered by both" product segment.
 * - DATA BROKERS RULE: on the first page, data brokers count as exactly
 *   ONE item labelled "Data brokers" — never per-broker counts. It sits
 *   in "Offered by both — differently" when the company offers removal,
 *   and in "Offered by Norton — not by {company}" only for companies
 *   with NO removal service (Brave, Firefox, Bitdefender, Proton,
 *   Apple, AdGuard). Per-broker detail lives only on the Brokers tab.
 * - The "Offered by Norton — not by {company}" segment lists the
 *   reverse-matrix items (Norton products the company does not offer),
 *   each with its detail popup. Popups carry no proof and no verbatim
 *   quotes — tags plus a short plain-language description only; quotes
 *   and proof links live only on the Proof tab, and popups end with a
 *   button to that tab.
 * - No win/lose language anywhere; the data's "verdict" field is never
 *   read (it is not even shipped in the data files).
 * - Norton stack = 2 bills totalling $209.98 (Select Plus $99.99 +
 *   Privacy Monitor Assistant add-on $109.99).
 * - Broker-name matching applies the 12 Nov 2026 audit: substring
 *   variant replacements, targeted key overrides, and the 411.ca /
 *   yellowpages.ca splits. Probable merges are flagged on the row.
 *
 * Data comes only from the JSON API (Node version) or from data/*.json
 * next to this file (static version, window.__STATIC__). Nothing is
 * invented here: when a company's data file is missing the UI says so.
 */

const STATIC = !!window.__STATIC__;
const BROKER_ALIASES = { surfshark: 'incogni', nord: 'incogni' };

function apiUrl(path) {
  if (!STATIC) return path;
  if (path === '/api/rivals') return 'data/rivals.json';
  if (path === '/api/norton') return 'data/norton.json';
  if (path === '/api/overview') return 'data/overview.json';
  let m = path.match(/^\/api\/comparison\/(.+)$/);
  if (m) return 'data/comparisons/' + m[1] + '.json';
  m = path.match(/^\/api\/brokers\/(.+)$/);
  if (m) return 'data/brokers/' + (BROKER_ALIASES[m[1]] || m[1]) + '.json';
  return path;
}

const TABS = [
  { id: 'only', label: null }, // label is "Only {company}", built in renderTabs
  { id: 'privacy', label: 'Privacy Features' },
  { id: 'brokers', label: 'Brokers' },
  { id: 'tierscost', label: 'Tiers & Cost' },
  { id: 'proof', label: 'Proof' },
];
const DEFAULT_COMPANY = 'optery';

const JOB_LABELS = {
  scan: 'Broker scan',
  suite: 'Suite (security + identity)',
  tracking: 'Tracking protection',
  removal: 'Broker removal',
};

const JOB_VALUE_LABELS = {
  in: 'Included',
  addon: 'Add-on',
  no: 'Not offered',
  part: 'Partly',
  ns: 'Not stated',
};

const TLD_SUFFIXES = ['.systems', '.network', '.com', '.org', '.net', '.us', '.ca', '.io'];
// Substring variant replacements — applied anywhere in the key, so they
// fire inside compound keys too (e.g. 'massachuesettsstaterecords').
const SUBSTRING_VARIANTS = [
  ['axciom', 'acxiom'],
  ['speedeondata', 'speedeon'],
  ['massachuesetts', 'massachusetts'],
  ['massachusetss', 'massachusetts'],
];
// Whole-key overrides (audit evidence in corrections.json).
const KEY_OVERRIDES = {
  georgiaarrest: 'georgiaarrests',
  rhodeislandcourtrecord: 'rhodeislandcourtrecords',
  arrestfacts: 'rainstreet',
  '18ipselfie': 'selfie',
  searchsystemspublicrecords: 'publicrecordssearchsystems',
  fastpeeplesearch: 'fastpeoplesearch', // probable (DeleteMe typo)
  peoplefindeers: 'peoplefinders', // probable (DeleteMe typo)
};
const PROBABLE_KEYS = new Set(['fastpeeplesearch', 'peoplefindeers']);
// Raw-name overrides — checked before any stripping. Targeted, NOT global:
// a global ccTLD-preserving change would break 53 currently-correct Both
// rows, and a global parenthetical strip would collapse Incogni's distinct
// 'Ekata (EU)' / 'Ekata (US)' entries.
const RAW_OVERRIDES = {
  '411.ca': '411ca', // distinct Canadian company; 411.com stays on '411'
  'yellowpages.ca': 'yellowpagesca', // Yellow Pages Ltd (Canada) vs US site
  'rainstreet.org (arrestfacts)': 'rainstreet',
};
const PROBABLE_RAW = new Set(['yellowpages.ca', 'yellowpagesca.ca']);
// Do NOT add '.me', '.info' or '.co' to TLD_SUFFIXES: companies list both
// backgroundchecks.me AND backgroundchecks.org as separate entries,
// 411.info is distinct from 411.com, and backgroundcheck.co is distinct.
// Doubtful near-matches (27 Nov 2026 rematch audit): each entry below is a
// company list name that closely resembles a Norton name but was NOT
// merged with it — there is no evidence they are the same broker, so the
// row keeps its classification and carries a small "Doubtful" note naming
// the similar Norton entry. Keys are the company's own raw list strings,
// grouped by the company whose list carries them.
const DOUBTFUL_BROKERS = {
  dataseal: {
    'BackgroundChecks': 'backgroundchecks.me',
    'PrivateRecords': 'privatereports.com',
  },
  privacyduck: {
    'backgroundchecks.org': 'backgroundchecks.me',
    'backgroundcheckers.net': 'backgroundchecks.me',
    'oregonarrest.org': 'oregonarrestrecords.org',
  },
  deleteme: {
    'publicrecords.info': 'publicrecords.com',
    'backgroundchecks.org': 'backgroundchecks.me',
  },
  onerep: {
    'publicrecords.info': 'publicrecords.com',
    'fastpeoplesearch.info': 'fastpeoplesearch.com',
    'backgroundchecks.org': 'backgroundchecks.me',
    'oregonarrest.org': 'oregonarrestrecords.org',
  },
  easyoptouts: {
    'backgroundchecks.org': 'backgroundchecks.me',
    'oregonarrest.org': 'oregonarrestrecords.org',
  },
  incogni: {
    'Courtrec': 'courtrecords.us',
    'Backgroundcheckers': 'backgroundchecks.me',
  },
  duckduckgo: {
    'Publicreports.com': 'publicrecords.com',
  },
};
// 411 rows (user-flagged 27 Nov 2026): 411.com and 411.ca are kept as
// their own rows — Norton lists the similar canada411.ca and
// people411.com, but neither 411.com nor 411.ca itself — so each 411
// row carries a full doubtful note instead of the generic sentence
// above. Keys are the company's own raw list strings ('411' is
// Incogni's bare entry for the same row). No classification changes.
const DOUBTFUL_NOTES_FULL = {
  deleteme: {
    '411.com': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not 411.com itself. Kept separate — not counted as Both.',
    '411.ca': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not 411.ca itself. Kept separate — not counted as Both.',
  },
  easyoptouts: {
    '411.com': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not 411.com itself. Kept separate — not counted as Both.',
  },
  onerep: {
    '411.com': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not 411.com itself. Kept separate — not counted as Both.',
  },
  privacyduck: {
    '411.com': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not 411.com itself. Kept separate — not counted as Both.',
  },
  incogni: {
    '411': '⚠ Doubtful — Norton lists similar names (canada411.ca, people411.com) but not this 411 entry itself. Kept separate — not counted as Both.',
  },
};

const state = {
  companies: [],
  norton: null,
  // The ONE global company selection: picked once in the header
  // picker and reflected on every tab. Defaults to Optery at boot.
  selectedCompany: null,
  companyCache: {}, // company id -> { company, dataMissing, loadError }
  // Resolved company for the CURRENT tab (from its pick):
  company: null,
  companyId: null,
  companyMeta: null,
  tab: 'only',
  dataMissing: false,
  loadError: null,
  brokersNorton: null,
  brokersByCompany: {}, // company id -> broker payload | 'missing'
  brokersCompany: null,
  brokersCompanyMissing: false,
  brokerFilter: 'all',
  brokersLoading: false,
};

const pieRegistry = {}; // pieId -> { title, segments: [...] }

// ---------------------------------------------------------------- helpers

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  return '$' + Number(n).toFixed(2);
}

function trunc(text, max) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function fetchJson(url) {
  const res = await fetch(apiUrl(url));
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------- classification

const NS_PREFIX = 'not stated on official site';

/**
 * A side "states" a feature unless its text starts with
 * "Not stated on official site" AND contains no quoted claim after that
 * prefix. A quoted '...' or "..." claim after the prefix counts as stating
 * (e.g. Aura's rescan text states "resubmits removal requests as needed").
 */
function statesFeature(text) {
  if (text == null) return false;
  const t = String(text).trim();
  if (!t.toLowerCase().startsWith(NS_PREFIX)) return true;
  const rest = t.slice(NS_PREFIX.length);
  if (/["“][^"”]{2,}["”]/.test(rest)) return true; // "..." quoted claim
  if (/(?:^|[\s(])'[^']{3,}'/.test(rest)) return true; // '...' quoted claim
  return false;
}

/** Mark for one side of a feature row: ✓ stated/included, ✗ not offered,
 *  ◐ partly/different, – not stated. */
function markFor(text) {
  if (!statesFeature(text)) return { mark: '–', cls: 'ns' };
  const t = String(text).trim();
  if (/^no\s*—/i.test(t) && !/add-on|addon|alternative/i.test(t)) return { mark: '✗', cls: 'no' };
  if (/add-on|addon|\bonly\b|limit|partly/i.test(t)) return { mark: '◐', cls: 'part' };
  return { mark: '✓', cls: 'yes' };
}

function refsHtml(refs) {
  const list = refs || [];
  if (!list.length) return '<p class="note">No proof links in the data for this company.</p>';
  return '<ul class="ref-list">' + list.map((ref) => {
    const url = safeUrl(ref.url);
    return '<li><div class="ref-label">' + esc(ref.label) + '</div>' +
      (ref.proves ? '<div class="ref-proves">' + esc(ref.proves) + '</div>' : '') +
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>' : '') +
      '</li>';
  }).join('') + '</ul>';
}

/** Popups carry no proof and no verbatim quotes: quotes and proof
 *  links live only on the Proof tab. This is the one neutral line
 *  popups show instead, with a button that switches to that tab
 *  (no external URL). */
function proofTabNote() {
  return '<p class="tap-hint">Proof is on the Proof tab. ' +
    '<button type="button" class="chip" data-action="goto-proof">Open the Proof tab</button></p>';
}

// ---------------------------------------------------------------- modal

function openModal(title, bodyHtml) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalRoot').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#modalRoot').hidden = true;
  document.body.style.overflow = '';
}

function featurePopup(feature) {
  const n = markFor(feature.norton);
  const r = markFor(feature.rival);
  let html =
    '<div class="side-block norton"><div class="side-who">Norton LifeLock</div>' +
    '<p><span class="mark ' + n.cls + '">' + n.mark + '</span> ' + esc(feature.norton) + '</p></div>' +
    '<div class="side-block company"><div class="side-who">' + esc(state.company.name) + '</div>' +
    '<p><span class="mark ' + r.cls + '">' + r.mark + '</span> ' + esc(feature.rival) + '</p></div>';
  if (feature.note) html += '<h3>Note</h3><p>' + esc(feature.note) + '</p>';
  html += proofTabNote();
  openModal(feature.label, html);
}

// ------------------------------------------------- first page: segments

/** True when the company sells a data-broker removal service. The six
 *  companies whose brokerList kind is "none" (Brave, Firefox,
 *  Bitdefender, Proton, Apple, AdGuard) offer no removal at all. */
function removalOffered(company) {
  const bl = company.detail && company.detail.brokerList;
  return !!bl && bl.kind !== 'none';
}

/**
 * The three first-page segments for the selected company. Items are
 * { kind: 'gap'|'partial'|'nortononly'|'brokers', item } — 'brokers' is
 * the single "Data brokers" item required by the data brokers rule.
 */
function segData() {
  const c = state.company;
  const brokersItem = { kind: 'brokers', item: { name: 'Data brokers' } };
  const companyItems = (c.gaps || []).map((g) => ({ kind: 'gap', item: g }));
  const diffItems = (c.partials || []).map((g) => ({ kind: 'partial', item: g }));
  const nortonItems = (c.nortonOnly || []).map((g) => ({ kind: 'nortononly', item: g }));
  if (removalOffered(c)) diffItems.push(brokersItem);
  else nortonItems.push(brokersItem);
  return [
    { key: 'company', label: 'Offered by ' + c.name + ' — not by Norton', color: '#d97706', items: companyItems },
    { key: 'both', label: 'Offered by both — differently', color: '#0d9488', items: diffItems },
    { key: 'norton', label: 'Offered by Norton — not by ' + c.name, color: '#2563eb', items: nortonItems },
  ];
}

function segTotal(segments) {
  return segments.reduce((n, s) => n + s.items.length, 0);
}

function productPopup(item) {
  const c = state.company;
  const isGap = item.state === 'gap';
  let html = '<p><strong>' + (isGap ? 'Offered by ' + esc(c.name) + ' — not by Norton'
    : 'Offered by both — differently') + '</strong>' +
    (item.biz ? ' · Business product' : '') + '</p>';
  if (item.detail) html += '<p>' + esc(item.detail) + '</p>';
  html += '<div class="side-block company"><div class="side-who">' + esc(c.name) + '</div>';
  // No verbatim quotes in popups: the company's exact wording lives
  // only on the Proof tab. How-sold / price lines are plain facts.
  if (item.rivalHowSold) html += '<p>' + esc(item.rivalHowSold) + '</p>';
  if (item.rivalPrice) html += '<p>' + esc(item.rivalPrice) + '</p>';
  html += '</div>';
  const ev = item.nortonEvidence || [];
  if (ev.length) {
    html += '<div class="side-block norton"><div class="side-who">Norton LifeLock</div>';
    for (const e of ev) {
      // Norton product NAMES only — the evidence quotes live only on
      // the Proof tab; the plain-language note stays.
      html += '<p><strong>' + esc(e.product || '') + '</strong>' +
        (e.note ? '<br>' + esc(e.note) : '') + '</p>';
    }
    html += '</div>';
  }
  html += proofTabNote();
  openModal(item.name, html);
}

function nortonOnlyPopup(item) {
  const c = state.company;
  // Norton product names only — the Norton quote lives only on the
  // Proof tab, never in this popup.
  let html = '<p><strong>Offered by Norton — not by ' + esc(c.name) + '</strong></p>' +
    '<div class="side-block norton"><div class="side-who">Norton LifeLock</div>' +
    '<p><strong>' + esc((item.nortonProducts || []).join(' · ')) + '</strong></p>' +
    '</div>' +
    '<div class="side-block company"><div class="side-who">' + esc(c.name) + '</div>' +
    '<p>' + esc(item.absenceBasis || '') + '</p></div>';
  if (item.overlapNote) html += '<h3>Note</h3><p>' + esc(item.overlapNote) + '</p>';
  html += proofTabNote();
  openModal(item.name, html);
}

async function openSegItem(segKey, index) {
  const pie = pieRegistry['products'];
  if (!pie) return;
  const seg = pie.segments.find((s) => s.key === segKey);
  if (!seg) return;
  const entry = seg.items[index];
  if (!entry) return;
  if (entry.kind === 'brokers') {
    // The "Data brokers" item jumps to the Brokers tab — the company
    // is the globally selected one by definition.
    closeModal();
    state.tab = 'brokers';
    await syncTab();
    return;
  }
  if (entry.kind === 'nortononly') nortonOnlyPopup(entry.item);
  else productPopup(entry.item);
}

function pieSegmentPopup(segKey) {
  const pie = pieRegistry['products'];
  if (!pie) return;
  const seg = pie.segments.find((s) => s.key === segKey);
  if (!seg) return;
  let html = '<p>' + esc(pie.title) + ' — ' + esc(seg.label) + ' (' + seg.items.length + ')</p>';
  if (!seg.items.length) {
    html += '<p class="note">No products in this segment for ' + esc(state.company.name) + '.</p>';
  } else {
    html += '<div class="chips">';
    seg.items.forEach((entry, i) => {
      html += '<button type="button" class="chip ' +
        (entry.kind === 'gap' ? 'chip-gap' : entry.kind === 'partial' ? 'chip-partial'
          : entry.kind === 'nortononly' ? 'chip-norton' : 'chip-partial') +
        '" data-action="seg-item" data-seg="' + seg.key + '" data-index="' + i + '">' +
        esc(entry.item.name) + (entry.item.biz ? ' <span class="chip-tag">business</span>' : '') + '</button>';
    });
    html += '</div><p class="tap-hint">Tap a product for its detail. ' +
      '“Data brokers” opens the Brokers tab, where the two named lists are compared name by name.</p>';
  }
  html += proofTabNote();
  openModal(seg.label, html);
}

// ---------------------------------------------------------------- pie

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function productPieBlock() {
  const segments = segData();
  const total = segTotal(segments);
  pieRegistry['products'] = { title: 'Products compared', segments };
  const R = 90, CX = 100, CY = 100;
  let paths = '';
  let start = -90;
  for (const seg of segments) {
    const n = seg.items.length;
    if (!n) continue;
    const frac = n / total;
    if (frac >= 1) {
      paths += '<circle data-action="pie-seg" data-seg="' + seg.key +
        '" cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="' + seg.color + '"><title>' +
        esc(seg.label) + ': ' + n + '</title></circle>';
      continue;
    }
    const end = start + frac * 360;
    const large = frac > 0.5 ? 1 : 0;
    const [x1, y1] = polar(CX, CY, R, start);
    const [x2, y2] = polar(CX, CY, R, end);
    paths += '<path data-action="pie-seg" data-seg="' + seg.key +
      '" d="M ' + CX + ' ' + CY + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
      ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) +
      ' Z" fill="' + seg.color + '"><title>' + esc(seg.label) + ': ' + n + '</title></path>';
    start = end;
  }
  const svg = '<svg class="pie-svg" viewBox="0 0 200 200" width="220" height="220" role="img" aria-label="Products compared">' +
    paths +
    '<circle cx="100" cy="100" r="58" fill="#fff"></circle>' +
    '<text class="pie-center" x="100" y="97">VS</text>' +
    '<text class="pie-center-sub" x="100" y="114">Tap a slice</text>' +
    '<text class="pie-center-sub" x="100" y="127">for its summary</text></svg>';
  const legend = '<ul class="pie-legend">' + segments.map((seg) =>
    '<li data-action="pie-seg" data-seg="' + seg.key + '">' +
    '<span class="swatch" style="background:' + seg.color + '"></span>' +
    '<span class="lbl">' + esc(seg.label) + '</span>' +
    '<span class="cnt">' + seg.items.length + '</span></li>'
  ).join('') + '</ul>';
  return '<div class="pie-wrap">' + svg + legend + '</div>' +
    '<p class="tap-hint">Tap a segment to see the products it holds, with the detail on both sides.</p>' +
    '<p class="note">“Offered by both — differently” = both companies offer it, but not the same way ' +
    '(a paid add-on instead of included, covering less, or more steps). ' +
    'Data brokers count as one item here — the full named lists are compared on the Brokers tab.</p>';
}

// ---------------------------------------------------------------- shared bits

function missingDataHtml() {
  const name = state.companyMeta ? state.companyMeta.name : state.companyId;
  return '<div class="data-missing"><strong>Data not loaded for ' + esc(name) + '.</strong><br>' +
    'Its data file has not been added yet, so no figures, names or quotes can be shown for it. ' +
    'Pick another company from the dropdown, or run a refresh once its data lands.</div>';
}

function chipFor(entry, segKey, index) {
  const cls = entry.kind === 'gap' ? 'chip-gap' : entry.kind === 'partial' ? 'chip-partial'
    : entry.kind === 'nortononly' ? 'chip-norton' : 'chip-partial';
  return '<button type="button" class="chip ' + cls + '" data-action="seg-item" data-seg="' +
    segKey + '" data-index="' + index + '">' + esc(entry.item.name) +
    (entry.item.biz ? ' <span class="chip-tag">business</span>' : '') + '</button>';
}

// ---------------------------------------------------------------- first page

function renderOnly() {
  const c = state.company;
  if (state.dataMissing || !c) return missingDataHtml();
  const segments = segData();
  const total = segTotal(segments);
  let html = '<section class="section accent-overview"><h2><span class="dot">●</span> Products compared</h2>' +
    '<p class="lede">Norton LifeLock vs ' + esc(c.name) + ' (' + esc(c.kind) + '), from each company’s official site — ' +
    total + ' products compared for ' + esc(c.name) + '.</p>' +
    productPieBlock() + '</section>';
  for (const seg of segments) {
    html += '<section class="section accent-overview"><h2><span class="dot">●</span> ' +
      esc(seg.label) + ' · ' + seg.items.length + '</h2>';
    if (!seg.items.length) {
      html += '<p class="note">None</p>';
    } else {
      html += '<div class="chips">' +
        seg.items.map((entry, i) => chipFor(entry, seg.key, i)).join('') + '</div>' +
        '<p class="tap-hint">Tap a product for its detail.</p>';
    }
    html += '</section>';
  }
  return html;
}

// ---------------------------------------------------------------- privacy features

function featureTableHtml(rows, prefix) {
  let html = '<table class="cmp"><thead><tr><th>Feature</th><th>Norton LifeLock</th>' +
    '<th>' + esc(state.company.name) + '</th></tr></thead><tbody>';
  rows.forEach((f, i) => {
    const n = markFor(f.norton);
    const r = markFor(f.rival);
    html += '<tr class="feat-row" tabindex="0" data-action="feature" data-idx="' + prefix + i + '">' +
      '<td class="feat-name">' + esc(f.icon || '') + ' ' + esc(f.label) + '</td>' +
      '<td><span class="mark ' + n.cls + '">' + n.mark + '</span> <span class="cell-text">' + esc(trunc(f.norton, 90)) + '</span></td>' +
      '<td><span class="mark ' + r.cls + '">' + r.mark + '</span> <span class="cell-text">' + esc(trunc(f.rival, 90)) + '</span></td></tr>';
  });
  return html + '</tbody></table>';
}

function renderPrivacy() {
  if (state.dataMissing || !state.company) return missingDataHtml();
  const features = (state.company.features || []).filter((f) => f.group === 'Privacy');
  let html = '<section class="section accent-features"><h2><span class="dot">●</span> Privacy Features — Norton vs ' +
    esc(state.company.name) + '</h2>' +
    '<p class="tap-hint">Tap a row for the full wording on both sides.</p>' +
    featureTableHtml(features, 'p') +
    '<p class="note">Official sites only. Where a site does not state a feature, the table says so — nothing is inferred.</p></section>';
  return html;
}

// ---------------------------------------------------------------- brokers

function normKey(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RAW_OVERRIDES, raw)) {
    return { key: RAW_OVERRIDES[raw], probable: PROBABLE_RAW.has(raw) };
  }
  let k = raw.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  k = k.replace(/https?www/, '');
  for (const suffix of TLD_SUFFIXES) {
    if (k.endsWith(suffix.replace('.', ''))) { k = k.slice(0, -(suffix.length - 1)); break; }
  }
  for (const [from, to] of SUBSTRING_VARIANTS) k = k.split(from).join(to);
  if (Object.prototype.hasOwnProperty.call(KEY_OVERRIDES, k)) {
    return { key: KEY_OVERRIDES[k], probable: PROBABLE_KEYS.has(k) || PROBABLE_RAW.has(raw) };
  }
  return { key: k, probable: PROBABLE_RAW.has(raw) };
}

function buildBrokerRows(nortonList, companyList) {
  const nortonByKey = new Map();
  for (const name of nortonList.brokers || []) {
    const { key, probable } = normKey(name);
    if (!nortonByKey.has(key)) nortonByKey.set(key, { name, probable });
  }
  const guideKeys = new Set();
  for (const name of nortonList.guide_names || []) guideKeys.add(normKey(name).key);
  const companyByKey = new Map();
  for (const name of companyList.brokers || []) {
    let { key, probable } = normKey(name);
    // Audit special case: Optery's directory lists a bare "BackgroundChecks"
    // entry, which is backgroundchecks.me on Norton's list.
    if (companyList.company === 'optery' && key === 'backgroundchecks') {
      key = 'backgroundchecksme';
    }
    if (!companyByKey.has(key)) companyByKey.set(key, { name, probable });
  }
  const rows = [];
  const seen = new Set();
  for (const [key, entry] of nortonByKey) {
    seen.add(key);
    const c = companyByKey.get(key);
    rows.push({
      key,
      nortonName: entry.name,
      companyName: c ? c.name : null,
      both: !!c,
      probable: !!(entry.probable || (c && c.probable)),
      source: guideKeys.has(key) ? 'opt-out guide' : 'supported list',
    });
  }
  const doubtfulFor = DOUBTFUL_BROKERS[companyList.company] || {};
  const doubtfulFullFor = DOUBTFUL_NOTES_FULL[companyList.company] || {};
  for (const [key, entry] of companyByKey) {
    if (seen.has(key)) continue;
    rows.push({ key, nortonName: null, companyName: entry.name, both: false, probable: !!entry.probable, source: null, doubtful: doubtfulFor[entry.name] || null, doubtfulFull: doubtfulFullFor[entry.name] || null });
  }
  return rows;
}

/** Short stated-count label for the Brokers tab chips: the first segment
 *  of the company's stated-count wording only. The full per-page wording
 *  stays in the data (and on the Proof tab); no figure is altered — the
 *  segment is the company's own headline figure, verbatim. */
function shortCountLabel() {
  const c = state.company;
  const label = c.brokerCountLabel || '';
  if (label) {
    const seg = label.split(/\s+—\s+|\s+·\s+|\s+•\s+|;\s+|\.\s+/)[0].trim();
    if (seg) return seg.length > 64 ? seg.slice(0, 64).trim() : seg;
  }
  if (c.brokerCount != null) return String(c.brokerCount) + ' data brokers';
  return '';
}

/** Compact count chips at the top of the Brokers tab — numbers only,
 *  no prose. */
function brokerCountChips() {
  const c = state.company;
  const bl = c.detail && c.detail.brokerList;
  const chips = ['<span class="count-chip">Norton LifeLock · ' +
    (state.brokersNorton ? state.brokersNorton.brokers.length : '374') + ' named</span>'];
  const stated = shortCountLabel();
  if (stated && !(bl && bl.kind === 'none')) {
    // "Not stated on official site" segments stand alone; anything else
    // is the company's stated figure and gets the "states" prefix.
    const prefix = /^Not stated/i.test(stated) ? '' : 'states ';
    chips.push('<span class="count-chip">' + esc(c.name) + ' · ' + prefix + esc(stated) + '</span>');
  }
  if (bl && bl.kind === 'named' && state.brokersCompany) {
    chips.push('<span class="count-chip">' + esc(c.name) + ' · ' +
      state.brokersCompany.brokers.length + ' named sites listed</span>');
  } else if (bl && bl.kind === 'none') {
    chips.push('<span class="count-chip">' + esc(c.name) + ' · no broker removal service</span>');
  } else if (bl && bl.kind === 'count') {
    chips.push('<span class="count-chip">' + esc(c.name) + ' · no named list published</span>');
  }
  return '<div class="count-chips">' + chips.join('') + '</div>';
}

function brokerTableHtml(rows) {
  const name = esc(state.company.name);
  let html = '<table class="brokers"><thead><tr><th>Data broker</th><th>Norton LifeLock</th><th>' + name + '</th></tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr><td class="name">' + esc(row.both ? row.companyName : (row.nortonName || row.companyName)) +
      (row.probable ? ' <span class="row-tag probable">probable match</span>' : '') +
      (row.both && row.companyName !== row.nortonName
        ? ' <span class="both-spellings">Norton: ' + esc(row.nortonName) + ' · ' + name + ': ' + esc(row.companyName) + '</span>'
        : '') +
      (row.doubtfulFull
        ? ' <span class="doubtful-note">' + esc(row.doubtfulFull) + '</span>'
        : row.doubtful
          ? ' <span class="doubtful-note">Doubtful: a similar name is on Norton’s list (' + esc(row.doubtful) + ') — counted as listed here.</span>'
          : '') + '</td>';
    if (row.nortonName) {
      html += '<td class="yes">✓ <span class="row-tag">' + esc(row.source) + '</span></td>';
    } else {
      html += '<td class="no">✗ not supported</td>';
    }
    html += row.companyName ? '<td class="yes">✓</td>' : '<td class="no">✗</td>';
    html += '</tr>';
  }
  if (!rows.length) html += '<tr><td colspan="3">No brokers match this filter.</td></tr>';
  return html + '</tbody></table>';
}

function renderBrokers() {
  if (state.dataMissing || !state.company) return missingDataHtml();
  const c = state.company;
  const bl = c.detail && c.detail.brokerList;
  let html = '<section class="section accent-brokers"><h2><span class="dot">●</span> ' +
    'Supported data brokers — ' + esc(c.name) + '</h2>' +
    '<p class="broker-count-line">Named data brokers from each company’s own official list. ' +
    'Norton lists ' + (state.brokersNorton ? state.brokersNorton.brokers.length : '374') + '.</p>' +
    brokerCountChips();

  if (state.brokersLoading) {
    html += '<p class="loading">Loading the named broker lists…</p></section>';
    return html;
  }

  if (!state.brokersNorton) {
    html += '<div class="data-missing">Norton’s named broker list could not be loaded, so the name-by-name table cannot be built.</div></section>';
    return html;
  }

  if (bl && bl.kind === 'named' && !state.brokersCompany) {
    html += '<div class="data-missing">The named broker list for ' + esc(c.name) +
      ' could not be loaded, so the name-by-name table cannot be built.</div></section>';
    return html;
  }

  if (bl && bl.kind === 'named' && state.brokersCompany) {
    const rows = buildBrokerRows(state.brokersNorton, state.brokersCompany);
    const both = rows.filter((r) => r.both).length;
    const onlyNorton = rows.filter((r) => r.nortonName && !r.companyName).length;
    const onlyCompany = rows.filter((r) => !r.nortonName).length;
    html += '<div class="filters" role="group" aria-label="Broker table filter">' +
      [['all', 'All (' + rows.length + ')'],
       ['norton', 'Only Norton (' + onlyNorton + ')'],
       ['both', 'Both (' + both + ')'],
       ['company', 'Only ' + c.name + ' (' + onlyCompany + ')']]
        .map(([key, label]) => '<button type="button" class="filter-btn' + (state.brokerFilter === key ? ' active' : '') +
          '" data-action="filter" data-filter="' + key + '">' + esc(label) + '</button>').join('') +
      '</div>';
    let visible = rows;
    if (state.brokerFilter === 'norton') visible = rows.filter((r) => r.nortonName && !r.companyName);
    else if (state.brokerFilter === 'both') visible = rows.filter((r) => r.both);
    else if (state.brokerFilter === 'company') visible = rows.filter((r) => !r.nortonName);
    // Not-by-Norton first, then Both, then Only Norton.
    visible = visible.slice().sort((a, b) => {
      const rank = (r) => (!r.nortonName ? 0 : r.both ? 1 : 2);
      return rank(a) - rank(b) || String(a.companyName || a.nortonName).localeCompare(String(b.companyName || b.nortonName));
    });
    html += brokerTableHtml(visible);
  } else {
    html += '<div class="gap-box"><div class="gap-rival"><strong>Brokers supported by Norton and not listed by ' +
      esc(c.name) + '</strong><br>All ' + state.brokersNorton.brokers.length +
      ' named brokers on Norton’s two official pages — ' + esc(c.name) +
      ' publishes no named list to match against.</div>' +
      '<div class="gap-rival"><strong>Brokers supported by ' + esc(c.name) + ' and not by Norton</strong><br>' +
      'Not stated — no named list is published on ' + esc(c.name) + '’s official site.</div></div>';
  }

  html += '</section>';

  html += '<section class="section accent-brokers"><h2><span class="dot">●</span> Notes</h2>' +
    '<p class="note">Norton’s 374 named brokers come from two official pages: the supported list (367) and the opt-out guide (7 more).</p>' +
    '<p class="note">Spellings are matched across lists (for example, Norton’s “axciom.com” is Acxiom). Rows marked “probable match” rest on a likely spelling variant, not an exact name.</p>' +
    '<p class="note">Two names on Norton’s pages (rain-street.org, clubset.com) were transferred to Atlas Data Privacy Corporation by court order on 12 Jun 2026; the dashboard reflects Norton’s pages as published.</p>' +
    '<p class="note">Counts a company states (“425+”, “over 2,000”) and the number of names it publishes are different things; both are shown exactly as stated.</p>' +
    '</section>';
  return html;
}

// ---------------------------------------------------------------- tiers & cost

/** Tier job values live on the tier itself (flat scan/suite/tracking/
 *  removal fields), per the hosted data. */
function tierJobs(t) {
  return [
    ['scan', (t && t.scan) || 'ns'],
    ['suite', (t && t.suite) || 'ns'],
    ['tracking', (t && t.tracking) || 'ns'],
    ['removal', (t && t.removal) || 'ns'],
  ];
}

function coverageFor(bill, job) {
  if (!bill || !bill.tiers || !bill.tiers.length) return '—';
  const inc = bill.tiers.find((t) => t[job] === 'in');
  if (inc) return 'Included — in ' + inc.name + ' (part of the bill above).';
  const addon = bill.tiers.find((t) => t[job] === 'addon');
  if (addon) return 'Add-on — ' + addon.name + '.';
  if (bill.tiers.some((t) => t[job] === 'no')) return 'Not offered.';
  return 'Not stated on official site.';
}

function nameMatchedTier() {
  const nortonTierName = 'Norton 360 with LifeLock Select Plus';
  const tiers = state.company.tiers || [];
  const target = tiers.find((t) => t.removal === 'in')
    || tiers.find((t) => state.company.priceAnnual != null && t.priceAnnual === state.company.priceAnnual);
  return {
    nortonTierName,
    rivalTierName: target ? target.name : (tiers[0] ? tiers[0].name : null),
    rivalTier: target || tiers[0] || null,
  };
}

function companyJobText(job) {
  const c = state.company;
  const tiers = c.tiers || [];
  const has = (v) => tiers.some((t) => t[job] === v);
  if (job === 'removal') {
    if (c.brokerCount != null) {
      let text = 'Removes from ' + (c.brokerCountLabel || (c.brokerCount + ' data brokers')) + ', included';
      if (c.rescanLabel) text += ' · ' + c.rescanLabel;
      return text + '.';
    }
    return 'Count not stated on official site.';
  }
  if (job === 'scan' && c.brokerCount != null) {
    return 'Scan of ' + (c.brokerCountLabel || (c.brokerCount + ' data brokers')) + ' included.';
  }
  if (has('in')) return 'Included in a tier.';
  if (has('addon')) return 'Offered as an add-on.';
  if (has('no')) return 'Not offered.';
  return 'Not stated on official site.';
}

function jobCardsHtml(matchedTier, nortonBill, companyBill) {
  const c = state.company;
  const cards = [['suite', 'Suite (security + identity)'], ['removal', 'Broker removal']]
    .map(([job, heading]) => {
      return '<div class="job-card"><h3>' + esc(heading) + '</h3>' +
        '<div class="job-side"><div class="side-who">Norton LifeLock</div>' +
        '<p>Covered by the bill above.</p>' +
        '<p class="cell-text">' + esc(coverageFor(nortonBill, job)) + '</p></div>' +
        '<div class="job-side"><div class="side-who">' + esc(c.name) + '</div>' +
        '<p>' + esc(companyBill ? 'Covered by the bill above.' : 'Not sold by ' + c.name + '.') + '</p>' +
        '<p class="cell-text">' + esc(companyBill ? coverageFor(companyBill, job) : '') + ' ' +
        esc(companyBill ? companyJobText(job) : '') + '</p></div></div>';
    }).join('');
  return '<div class="job-cards">' + cards + '</div>' +
    '<p class="note">Matched tier for the job view: Norton — ' + esc(matchedTier.nortonTierName) +
    (matchedTier.rivalTierName ? ' · ' + esc(c.name) + ' — ' + esc(matchedTier.rivalTierName) : '') + '.</p>';
}

function diffLineHtml() {
  const norton = state.norton;
  const c = state.company;
  const t = norton.stackTotal;
  const p = c.priceAnnual;
  if (t == null || p == null) {
    return '<div class="diff-line">Exact difference: not shown — ' +
      (p == null ? esc(c.name) + ' does not publish this price' : 'Norton’s total is not in the data') + '.</div>';
  }
  const diff = Math.round((t - p) * 100) / 100;
  const arith = fmtMoney(t) + ' − ' + fmtMoney(p) + ' = ' + fmtMoney(Math.abs(diff));
  let sentence;
  if (diff > 0) sentence = 'Norton costs ' + fmtMoney(diff) + ' more per year for the basket above.';
  else if (diff < 0) sentence = esc(c.name) + ' costs ' + fmtMoney(-diff) + ' more per year for the basket above.';
  else sentence = 'Both totals are the same for the basket above.';
  return '<div class="diff-line"><span class="arith">' + esc(arith) + '</span> — ' + sentence + '</div>';
}

function renderTiersCost() {
  if (state.dataMissing || !state.company) return missingDataHtml();
  const norton = state.norton;
  const c = state.company;

  // "In short" summary — the hosted tab's three facts, drawn from the
  // data: suites include Privacy Monitor only; removal is the add-on;
  // PMA Lite only in some newer LifeLock/partner plans.
  const nt = norton.tiers || [];
  const addonSlice = (norton.stackSlices || []).find((s) => /add-on/i.test(s.name || ''));
  const headline = c.priceLabel || (c.priceAnnual != null
    ? fmtMoney(c.priceAnnual) + '/yr headline'
    : 'headline price not published');
  const cTierNames = (c.tiers || []).map((t) => t.name);
  const inShort =
    '<div class="info-box"><strong>In short — Norton vs ' + esc(c.name) + '</strong><ul class="tight">' +
    '<li>Norton suites include Privacy Monitor only (scan + manual opt-out). Automated removal is the ' +
    esc(addonSlice ? addonSlice.name : 'Privacy Monitor Assistant add-on') +
    (addonSlice && addonSlice.value != null ? ' at ' + fmtMoney(addonSlice.value) + '/yr' : '') +
    (norton.stackTotal != null ? ' — the two-bill total is ' + fmtMoney(norton.stackTotal) + '/yr' : '') +
    '. PMA Lite (lighter automatic removal) comes only with some newer LifeLock and partner plans.</li>' +
    '<li>' + esc(c.name) + (cTierNames.length ? ' sells ' + esc(cTierNames.join(' · ')) : ' sells no stated tiers') +
    ' — headline: ' + esc(headline) + (c.brokerCountLabel ? '; removal covers ' + esc(c.brokerCountLabel) : '') + '.</li>' +
    '</ul></div>';

  function group(title, tiers) {
    const maxPrice = Math.max(0, ...tiers.map((t) => t.priceAnnual || 0));
    let html = '<h3>' + esc(title) + '</h3><div class="tier-group">';
    tiers.forEach((t, i) => {
      html += '<div class="tier-row" data-action="tier" data-side="' +
        (title === 'Norton LifeLock' ? 'norton' : 'company') + '" data-idx="' + i + '" tabindex="0">' +
        '<span class="tier-name">' + esc(t.name) + '</span>' +
        '<span class="tier-price">' + esc(t.priceLabel || (t.priceAnnual != null ? fmtMoney(t.priceAnnual) : 'Not stated')) + '</span>' +
        '<span class="bar-cell"><span class="bar-track">' +
        (t.priceAnnual != null && maxPrice > 0
          ? '<span class="bar-fill" style="width:' + Math.max(4, Math.round((t.priceAnnual / maxPrice) * 100)) + '%"></span>'
          : '') + '</span></span></div>' +
        (t.highlight ? '<div class="tier-badges"><span class="tier-badge">' + esc(t.highlight) + '</span></div>' : '');
    });
    return html + '</div>';
  }

  let tiersHtml = '<section class="section accent-tiers"><h2><span class="dot">●</span> Tiers — what each plan includes</h2>' +
    inShort +
    '<p class="tap-hint">Tap a tier for its full official wording. Bar length is price within each company’s own tiers. An add-on price is never counted as included in a tier.</p>' +
    group('Norton LifeLock', nt) +
    group(c.name, c.tiers || []) +
    '</section>';

  // Cost section — ONE comparison basis throughout: the same basket
  // (suite + automated broker removal) and the same named tiers in every
  // block. A bundle's price appears once, as one line covering all its
  // jobs; job cards only state how the bill above covers the job.
  const matchedTier = nameMatchedTier();
  // Bills are derived from the tiers: Norton's bill is the Select Plus
  // suite tier plus the Privacy Monitor Assistant tier (the add-on);
  // the company's bill is its single matched tier (a bundle's price
  // appears once, covering all its jobs).
  const suiteTier = nt.find((t) => t.name === matchedTier.nortonTierName);
  const pmaTier = nt.find((t) => /^Privacy Monitor Assistant \(full\)/.test(t.name || ''));
  const nortonBill = suiteTier && pmaTier ? { tiers: [suiteTier, pmaTier] } : null;
  const companyBill = matchedTier.rivalTier ? { tiers: [matchedTier.rivalTier] } : null;

  function billBlock(title, bill, emptyText) {
    if (!bill || !bill.tiers || !bill.tiers.length) {
      return '<div class="bill"><h3>' + esc(title) + '</h3><p class="note">' + esc(emptyText) + '</p></div>';
    }
    const parts = bill.tiers
      .map((t) => esc(t.name) + ' ' + esc(fmtMoney(t.priceAnnual) || ''))
      .join(' + ');
    const total = bill.tiers.reduce((sum, t) => sum + (t.priceAnnual || 0), 0);
    const renewals = bill.tiers.filter((t) => t.renewalLabel);
    let html = '<div class="bill' + (title.startsWith('Norton') ? ' norton' : ' company') + '"><h3>' + esc(title) + '</h3>' +
      '<div class="bill-lines">' + bill.tiers.map((t) =>
        '<div class="bill-line"><span>' + esc(t.name) + '</span><span>' + esc(fmtMoney(t.priceAnnual) || 'Not stated') + '</span></div>').join('') +
      '</div>' +
      '<div class="bill-total">Total ' + esc(fmtMoney(total) || '') + '/yr' +
      (renewals.length ? ' first year' : '') + ' — ' + esc(bill.tiers.length === 1 ? '1 bill' : bill.tiers.length + ' separate bills') + '</div>' +
      '<p class="note">' + esc(parts) + (renewals.length
        ? '. Renewal: ' + renewals.map((t) => esc(t.name) + ' — ' + esc(t.renewalLabel)).join('; ') + '.'
        : '') + '</p>' +
      '<p class="note">What this total covers: ' +
      bill.tiers.map((t) => esc(t.name)).join(' + ') + '.</p></div>';
    return html;
  }

  const rd = (c.detail && c.detail.reputation) || null;
  const rdHtml = rd
    ? '<div class="info-box"><strong>Search-result removal &amp; reputation — outside the bills above</strong><br>' +
      (rd.kind === 'stated'
        ? esc(rd.nortonText || '') + ' ' + esc(rd.rivalText || '')
        : 'Not stated on official sites.') + '</div>'
    : '';
  const customGap = (c.gaps || []).find((g) => g.key === 'customRemovals') ||
    (c.partials || []).find((g) => g.key === 'customRemovals');
  const customHtml = customGap && customGap.nortonEvidence && customGap.nortonEvidence.length
    ? '<div class="info-box"><strong>Custom removals — outside the bills above</strong><br>' +
      'Norton offers custom removals only through corporate / executive Reputation Defender (' +
      esc(customGap.nortonEvidence.map((e) => e.product).filter(Boolean).join(' · ') || 'Reputation Defender') +
      '). No consumer Norton product offers custom removals, ' +
      'so there is no consumer bill for this job.</div>'
    : '';

  const basis = '<div class="basis-card"><strong>Comparison basis — the same basket and tiers in every block below</strong>' +
    '<p>Basket: a security + identity suite plus automated data broker removal. ' +
    'Norton tier: ' + esc(matchedTier.nortonTierName) + ' plus the Privacy Monitor Assistant add-on (removal is not included in any Norton suite).' +
    (matchedTier.rivalTierName ? ' ' + esc(c.name) + ' tier: ' + esc(matchedTier.rivalTierName) + '.' : '') +
    '</p><p>A bundle’s price appears once, as one line covering all its jobs. The job cards below only state how the bill covers each job — they never re-price a job.</p></div>';

  let costHtml = '<section class="section accent-cost"><h2><span class="dot">●</span> Cost — the same basket, billed two ways</h2>' +
    '<p class="lede">One basket of jobs — suite + automated broker removal — priced from each company’s own official site. ' +
    'Every price below is for that same basket. Tap a tier above for the official wording behind each price.</p>' +
    basis + rdHtml + customHtml +
    '<div class="bills">' +
    billBlock('Norton LifeLock — two bills', nortonBill, 'Norton’s bill data is not in the data.') +
    billBlock(c.name + (companyBill && companyBill.tiers.length === 1 ? ' — one bill' : ' — bills'),
      companyBill, c.name + ' does not sell this basket as one bill.') +
    '</div>' +
    diffLineHtml() +
    (companyBill ? '' : '<div class="warn-box">' + esc(c.name) +
      ' does not sell the full basket (suite + automated removal), so no like-for-like total exists. The job cards below show what each side does and does not cover.</div>') +
    jobCardsHtml(matchedTier, nortonBill, companyBill) +
    '</section>';

  return tiersHtml + costHtml;
}

function tierPopup(side, idx) {
  const tiers = side === 'norton' ? (state.norton.tiers || []) : (state.company.tiers || []);
  const t = tiers[idx];
  if (!t) return;
  let html = '<p><strong>' + esc(side === 'norton' ? 'Norton LifeLock' : state.company.name) + '</strong> — ' +
    esc(t.priceLabel || 'Price not stated') +
    (t.renewalLabel ? ' · ' + esc(t.renewalLabel) : '') + '</p><ul class="tight">';
  for (const [job, value] of tierJobs(t)) {
    html += '<li>' + esc(JOB_LABELS[job]) + ': <strong>' + esc(JOB_VALUE_LABELS[value] || value) + '</strong></li>';
  }
  html += '</ul>';
  if (t.highlight) html += '<p>' + esc(t.highlight) + '</p>';
  if (t.note) html += '<p>' + esc(t.note) + '</p>';
  html += proofTabNote();
  openModal(t.name, html);
}

// ---------------------------------------------------------------- proof

function renderProof() {
  if (state.dataMissing || !state.company) return missingDataHtml();
  const c = state.company;
  // Proof order (user, 2026-11-27): the OTHER company's proof at the
  // top, Norton's proof below it — on this tab only.
  return '<section class="section accent-proof"><h2><span class="dot">●</span> Proof — every claim traces to an official page</h2>' +
    '<p class="lede">One canonical official domain per company. ' +
    esc(c.name) + ': ' + esc(c.domain) + '. Norton: norton.com. Figures were last checked ' + esc(fmtDate(c.checkedAt)) +
    (c.previousNote ? '. ' + esc(c.previousNote) : '') + '</p>' +
    '<h3>' + esc(c.name) + ' official pages</h3>' + refsHtml(c.refs) +
    '<h3>Norton official pages</h3>' + refsHtml(state.norton.refs) +
    '<p class="note">Discrepancies are shown page by page, exactly as each official page states them — never averaged or merged. ' +
    'Where a site does not state something, the dashboard says “Not stated on official site”.</p></section>';
}

// ---------------------------------------------------------------- routing / render

/** Hash form: #/<tab> or #/<tab>/<companyId> — the company id is the
 *  single global selection. The legacy #/<companyId>/<tab> form is
 *  still read. */
function parseHash() {
  const parts = window.location.hash.replace(/^#\//, '').split('/').filter(Boolean);
  if (!parts.length) return {};
  const isTab = (s) => TABS.some((t) => t.id === s);
  if (isTab(parts[0])) return { tab: parts[0], companyId: parts[1] };
  if (parts[1] && isTab(parts[1])) return { tab: parts[1], companyId: parts[0] };
  return {};
}

function setHash() {
  const pick = state.selectedCompany;
  const target = '#/' + state.tab + (pick ? '/' + pick : '');
  if (window.location.hash !== target) {
    history.replaceState(null, '', target);
  }
}

function currentPick() {
  return state.selectedCompany || null;
}

function renderTabs() {
  // The first tab's label names the globally selected company.
  const onlyMeta = state.companies.find((r) => r.id === state.selectedCompany);
  const name = onlyMeta ? onlyMeta.name : '…';
  $('#tabs').innerHTML = TABS.map((t) =>
    '<button type="button" class="tab-btn' + (state.tab === t.id ? ' active' : '') +
    '" data-action="tab" data-tab="' + t.id + '">' +
    esc(t.id === 'only' ? 'Only ' + name : t.label) + '</button>'
  ).join('');
}

/** The ONE header picker: it holds the global company selection,
 *  shown the same on every tab. There is always a selection (Optery
 *  by default), so no placeholder option is needed. */
function renderPicker() {
  const sel = $('#companySelect');
  const pick = currentPick();
  sel.innerHTML =
    state.companies.map((r) =>
      '<option value="' + esc(r.id) + '"' + (r.id === pick ? ' selected' : '') + '>' +
      esc(r.name) + '</option>').join('');
  sel.value = pick || '';
}

function render() {
  renderPicker();
  $('#companyKind').textContent = state.companyMeta ? state.companyMeta.kind : '';
  $('#checkedAt').textContent = state.company && state.company.checkedAt
    ? 'Data checked ' + fmtDate(state.company.checkedAt) : '';
  renderTabs();
  const content = $('#content');
  if (state.loadError) {
    content.innerHTML = '<div class="data-missing">Comparison data could not be loaded: ' +
      esc(state.loadError) + '</div>';
    return;
  }
  if (state.tab === 'only') content.innerHTML = renderOnly();
  else if (state.tab === 'privacy') content.innerHTML = renderPrivacy();
  else if (state.tab === 'brokers') content.innerHTML = renderBrokers();
  else if (state.tab === 'tierscost') content.innerHTML = renderTiersCost();
  else if (state.tab === 'proof') content.innerHTML = renderProof();
}

// ---------------------------------------------------------------- loading

/** Broker lists for the globally selected company. state.company
 *  must already be resolved to it (syncTab does this first). Results
 *  are cached per company. */
async function loadBrokers() {
  const id = state.selectedCompany;
  if (!id) return;
  if (state.brokersNorton &&
      Object.prototype.hasOwnProperty.call(state.brokersByCompany, id)) {
    const cached = state.brokersByCompany[id];
    state.brokersCompany = cached === 'missing' ? null : cached;
    state.brokersCompanyMissing = cached === 'missing';
    return;
  }
  state.brokersLoading = true;
  try {
    if (!state.brokersNorton) {
      state.brokersNorton = await fetchJson('/api/brokers/norton');
    }
    const bl = state.company && state.company.detail && state.company.detail.brokerList;
    if (bl && bl.kind === 'named') {
      try {
        state.brokersByCompany[id] = await fetchJson('/api/brokers/' + id);
      } catch (err) {
        state.brokersByCompany[id] = 'missing';
      }
      const cached = state.brokersByCompany[id];
      state.brokersCompany = cached === 'missing' ? null : cached;
      state.brokersCompanyMissing = cached === 'missing';
    } else {
      state.brokersCompany = null;
      state.brokersCompanyMissing = false;
    }
  } catch (err) {
    state.brokersNorton = null;
  } finally {
    state.brokersLoading = false;
  }
}

/** Resolve state.company & friends for one company id (null = no
 *  pick), using the per-company cache. */
async function loadCompany(id) {
  state.companyId = id;
  state.companyMeta = id ? (state.companies.find((r) => r.id === id) || null) : null;
  state.company = null;
  state.dataMissing = false;
  state.loadError = null;
  if (!id) return;
  let entry = state.companyCache[id];
  if (!entry) {
    entry = { company: null, dataMissing: false, loadError: null };
    try {
      entry.company = await fetchJson('/api/comparison/' + encodeURIComponent(id));
    } catch (err) {
      if (err.status === 404) entry.dataMissing = true;
      else entry.loadError = err.message;
    }
    state.companyCache[id] = entry;
  }
  state.company = entry.company;
  state.dataMissing = entry.dataMissing;
  state.loadError = entry.loadError;
}

/** Point the dashboard at the current tab: resolve the globally
 *  selected company, load its broker lists when on the Brokers tab,
 *  then render. */
async function syncTab() {
  await loadCompany(currentPick());
  if (state.tab === 'brokers' && currentPick()) {
    // Point the broker-list fields at THIS pick's cache entry before
    // any render, so a previous pick's list is never shown under this
    // company while its own list is still loading.
    const cached = state.brokersByCompany[currentPick()];
    state.brokersCompany = cached && cached !== 'missing' ? cached : null;
    state.brokersCompanyMissing = cached === 'missing';
    if (!cached) state.brokersLoading = true;
    render(); // shows the loading state while the lists arrive
    await loadBrokers();
  }
  setHash();
  render();
}

async function boot() {
  let companies;
  let norton;
  try {
    [companies, norton] = await Promise.all([
      fetchJson('/api/rivals'),
      fetchJson('/api/norton'),
    ]);
  } catch (err) {
    $('#content').innerHTML = '<div class="data-missing">Comparison data could not be loaded: ' +
      esc(err.message) + '</div>';
    return;
  }
  state.companies = companies;
  state.norton = norton;

  const fromHash = parseHash();
  if (fromHash.tab && TABS.some((t) => t.id === fromHash.tab)) state.tab = fromHash.tab;
  // ONE global selection: a company named in the hash wins; otherwise
  // the default is Optery. The same selection drives every tab.
  if (fromHash.companyId && companies.some((r) => r.id === fromHash.companyId)) {
    state.selectedCompany = fromHash.companyId;
  }
  if (!state.selectedCompany) {
    state.selectedCompany = companies.some((r) => r.id === DEFAULT_COMPANY)
      ? DEFAULT_COMPANY : companies[0].id;
  }

  if (STATIC) {
    const btn = $('#refreshBtn');
    if (btn) btn.style.display = 'none';
    $('#refreshStatus').textContent = 'Static copy — data as extracted; use the Node version for refresh.';
  }

  await syncTab();
}

// ---------------------------------------------------------------- events

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'tab') {
    state.tab = el.dataset.tab;
    await syncTab();
  } else if (action === 'goto-proof') {
    closeModal();
    state.tab = 'proof';
    await syncTab();
  } else if (action === 'pie-seg') {
    pieSegmentPopup(el.dataset.seg);
  } else if (action === 'seg-item') {
    openSegItem(el.dataset.seg, Number(el.dataset.index));
  } else if (action === 'feature') {
    const idx = el.dataset.idx || '';
    const features = (state.company.features || []).filter((f) => f.group === 'Privacy');
    const f = features[Number(idx.slice(1))];
    if (f) featurePopup(f);
  } else if (action === 'tier') {
    tierPopup(el.dataset.side, Number(el.dataset.idx));
  } else if (action === 'filter') {
    state.brokerFilter = el.dataset.filter;
    render();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    const el = ev.target.closest && ev.target.closest('[data-action]');
    if (el && (el.classList.contains('feat-row') || el.classList.contains('tier-row'))) {
      ev.preventDefault();
      el.click();
    }
  }
  if (ev.key === 'Escape') closeModal();
});

/** The single header picker sets the global company selection; every
 *  tab re-renders for the newly picked company at once. */
document.addEventListener('change', async (ev) => {
  const sel = ev.target.closest && ev.target.closest('.js-company-pick');
  if (!sel || !sel.value) return;
  if (state.selectedCompany !== sel.value) {
    state.brokerFilter = 'all';
  }
  state.selectedCompany = sel.value;
  await syncTab();
});

$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', closeModal);

window.addEventListener('hashchange', async () => {
  const { companyId, tab } = parseHash();
  let changed = false;
  if (tab && TABS.some((t) => t.id === tab) && tab !== state.tab) {
    state.tab = tab;
    changed = true;
  }
  if (companyId && state.companies.some((r) => r.id === companyId) &&
      state.selectedCompany !== companyId) {
    state.selectedCompany = companyId;
    changed = true;
  }
  if (changed) await syncTab();
});

// ---------------------------------------------------------------- refresh (Node version only)

const refreshBtn = $('#refreshBtn');
if (refreshBtn && !STATIC) {
  refreshBtn.addEventListener('click', async () => {
    const status = $('#refreshStatus');
    refreshBtn.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Refreshing from official sites…';
    try {
      const started = await fetch('/api/refresh', { method: 'POST' });
      const startedBody = await started.json().catch(() => ({}));
      if (!started.ok) throw new Error(startedBody.error || 'Refresh could not start.');
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const check = await fetch('/api/refresh-status');
        const body = await check.json();
        if (body.running) continue;
        if (body.lastError) throw new Error(body.lastError);
        status.textContent = 'Data refreshed' + (body.lastRunAt ? ' at ' + fmtDate(body.lastRunAt) : '') +
          '. Some figures may have changed — the dashboard now shows the new data.';
        // Data files changed under us: drop every cached payload and
        // re-resolve the global selection.
        state.companyCache = {};
        state.brokersByCompany = {};
        state.brokersNorton = null;
        state.brokersCompany = null;
        state.brokersCompanyMissing = false;
        await syncTab();
        break;
      }
    } catch (err) {
      status.classList.add('error');
      status.textContent = 'Refresh failed: ' + err.message;
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

boot();
