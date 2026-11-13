#!/usr/bin/env node
/**
 * scrape.js — refresh checker for the Norton vs Rivals dashboard.
 *
 * Re-reads each company's CANONICAL OFFICIAL pages only (one official
 * domain per company, taken from the `domain` field of data/<id>.json)
 * and compares the headline annual price + stated broker count against
 * the stored values. Never invents a figure: anything that cannot be
 * fetched or parsed cleanly is flagged "could not re-read" and the
 * stored value is kept.
 *
 * Usage:
 *   node scripts/scrape.js [--dry-run] [--only <rivalId|norton>]
 *
 *   --dry-run   print the changes report to stdout, write nothing.
 *   --only <id> limit the run to one company.
 *
 * Node 20+, CommonJS, ZERO required dependencies (global fetch only).
 * Playwright is optional: if installed it is used for JS-rendered
 * pages, otherwise those pages are flagged could-not-read.
 *
 * Exit code is 0 on a completed run even if some companies could not
 * be re-read — those are flags, not crashes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const DELAY_MS = 1000; // polite 1s gap between requests

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
let ONLY = null;
const onlyIdx = argv.indexOf('--only');
if (onlyIdx !== -1) ONLY = (argv[onlyIdx + 1] || '').toLowerCase() || null;

function usageError(msg) {
  console.error('scrape.js: ' + msg);
  console.error('Usage: node scripts/scrape.js [--dry-run] [--only <id>]');
  process.exit(2);
}
if (onlyIdx !== -1 && !ONLY) usageError('--only needs a company id.');

// ------------------------------------------------------- optional deps
let playwright = null;
try { playwright = require('playwright'); } catch (e) { /* optional */ }

// ------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseMoney(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseCount(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Strip HTML to readable text. Removes scripts/styles/nav junk first. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch a URL as text. Returns { ok, text, status, error }. */
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, status: res.status, error: 'HTTP ' + res.status };
    return { ok: true, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Render a JS-heavy page with Playwright if available, else null. */
async function renderText(url) {
  if (!playwright) return null;
  let browser = null;
  try {
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'networkidle', timeout: FETCH_TIMEOUT_MS });
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Fetch a page and return plain text. Falls back to Playwright
 * rendering when plain fetch yields almost no usable text and the
 * entry allows it. Returns { ok, text, via, error }.
 */
async function getPageText(url, allowRender) {
  const res = await fetchText(url);
  await sleep(DELAY_MS);
  if (res.ok && res.text && htmlToText(res.text).length > 500) {
    return { ok: true, text: htmlToText(res.text), via: 'fetch' };
  }
  if (allowRender && playwright) {
    const rendered = await renderText(url);
    if (rendered && rendered.ok && rendered.text && rendered.text.length > 200) {
      return { ok: true, text: rendered.text.replace(/\s+/g, ' ').trim(), via: 'playwright' };
    }
    if (rendered && !rendered.ok) {
      return { ok: false, error: 'render failed: ' + rendered.error };
    }
  }
  if (!res.ok) return { ok: false, error: res.error || 'fetch failed' };
  if (!res.text || htmlToText(res.text).length <= 500) {
    return { ok: false, error: 'page returned almost no readable text (likely JS-rendered)' };
  }
  return { ok: true, text: htmlToText(res.text), via: 'fetch' };
}

/** First regex match across a list; returns the captured group or null. */
function firstMatch(text, regexes, group) {
  for (const re of regexes) {
    const m = text.match(re);
    if (m) return m[group == null ? 1 : group];
  }
  return null;
}

// ------------------------------------------------------------------
// CONFIG — one entry per company. URLs must be canonical official
// pages on that company's own domain (see `domain` in data/<id>.json).
// Never staging hosts, affiliate-tagged, /deal/ or partner pages.
// priceRe / countRe are best-effort generic patterns; the four
// priority companies (norton, aura, incogni, optery) also get tight
// custom parsers below because generic regexes cannot pin their
// figures reliably. jsPrice/jsCount: the figure is known to be
// JS-rendered — attempt fetch, but flag could-not-read rather than
// guess when it cannot be read cleanly.
// ------------------------------------------------------------------
const ANNUAL_PRICE = [
  /\$\s*([\d,]+\.\d{2})\s+annually/i,
  /\$\s*([\d,]+\.\d{2})\s+billed yearly/i,
  /\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year|a year|\/yr\b)/i,
  /\$\s*([\d,]+\.\d{2})\s*(?:first year|for the first year)/i,
  /\$\s*([\d,]+)\s*(?:\/\s*year|per year|a year|annually|\/yr\b)/i,
];
const BROKER_COUNT = [
  /(\d[\d,]*)\+?\s*(?:data brokers?|broker sites?|sites)/i,
  /over\s+(\d[\d,]*)\s*(?:data brokers?|broker sites?|sites)/i,
  /(\d[\d,]*)\+\s*(?:sites|brokers)/i,
];

const CONFIG = {
  // ---- priority companies (custom parsers below) ----
  norton: {
    urls: [
      'https://us.norton.com/products/privacy-monitor-assistant',
    ],
    custom: 'norton',
  },
  aura: {
    urls: ['https://www.aura.com/pricing'],
    custom: 'aura',
  },
  incogni: {
    urls: ['https://incogni.com/pricing'],
    custom: 'incogni',
  },
  optery: {
    urls: ['https://www.optery.com/pricing/'],
    custom: 'optery',
  },

  // ---- other rivals: generic config entries ----
  malwarebytes: {
    urls: ['https://www.malwarebytes.com/personal-data-remover-page'],
    priceRe: ANNUAL_PRICE,
    countRe: [/(\d[\d,]*)\+\s*(?:data brokers?|brokers)/i, ...BROKER_COUNT],
  },
  duckduckgo: {
    urls: ['https://duckduckgo.com/pro'],
    priceRe: ANNUAL_PRICE,
    countRe: [],
  },
  surfshark: {
    urls: ['https://surfshark.com/pricing'],
    priceRe: ANNUAL_PRICE, countRe: [],
    jsPrice: true, // price is script-rendered; flag if unreadable
  },
  nord: {
    urls: ['https://nordvpn.com/offer/pricing/'],
    priceRe: ANNUAL_PRICE,
    countRe: BROKER_COUNT,
  },
  mcafee: {
    urls: ['https://www.mcafee.com/en-us/antivirus/mcafee-total-protection.html'],
    priceRe: ANNUAL_PRICE,
    countRe: [/(\d[\d,]*)\+?\s*(?:data brokers?|broker sites?)/i],
    jsPrice: true, // price is script-rendered; flag if unreadable
  },
  bitdefender: {
    urls: ['https://www.bitdefender.com/en-us/consumer/digital-identity-protection'],
    priceRe: ANNUAL_PRICE, countRe: [],
  },
  proton: {
    urls: ['https://proton.me/drive/pricing'],
    priceRe: ANNUAL_PRICE, countRe: [],
  },
  expressvpn: {
    urls: ['https://www.expressvpn.com/features/id-defender'],
    priceRe: ANNUAL_PRICE, countRe: [],
    jsPrice: true, // price is script-rendered; flag if unreadable
  },
  experian: {
    urls: ['https://www.experian.com/plans/'],
    priceRe: ANNUAL_PRICE, countRe: [],
  },
  apple: {
    urls: ['https://support.apple.com/en-us/108047'],
    priceRe: [], countRe: [], // no removal product, no stored price/count
  },
  adguard: {
    urls: ['https://adguard-vpn.com/en/license.html'],
    priceRe: ANNUAL_PRICE, countRe: [],
    jsPrice: true, // prices are script-rendered; flag if unreadable
  },
  pureprivacy: {
    urls: ['https://www.pureprivacy.com/pricing-vpn/'],
    priceRe: ANNUAL_PRICE,
    countRe: BROKER_COUNT,
  },
  cloaked: {
    urls: ['https://www.cloaked.com/'],
    priceRe: ANNUAL_PRICE,
    countRe: [/(\d[\d,]*)\+\s*(?:data brokers?|brokers)/i, ...BROKER_COUNT],
  },
  deleteme: {
    urls: ['https://joindeleteme.com/pricing/'],
    priceRe: ANNUAL_PRICE, countRe: [],
    jsPrice: true, // price is script-rendered; flag if unreadable
  },
  kanary: {
    urls: ['https://www.kanary.com/pricing'],
    priceRe: ANNUAL_PRICE, countRe: [],
  },
  dataseal: {
    urls: ['https://dataseal.io/'],
    priceRe: [],
    countRe: [/(\d[\d,]*)\+\s*(?:data brokers?|brokers)/i, ...BROKER_COUNT],
  },
  helloprivacy: {
    urls: ['https://helloprivacy.com/remove-info-data-brokers'],
    priceRe: [],
    countRe: BROKER_COUNT,
  },
  easyoptouts: {
    urls: ['https://easyoptouts.com/pricing'],
    priceRe: ANNUAL_PRICE,
    countRe: BROKER_COUNT,
  },
  privacyduck: {
    urls: ['https://privacyduck.com/pricing'],
    priceRe: ANNUAL_PRICE,
    countRe: BROKER_COUNT,
  },
  brave: {
    urls: ['https://brave.com/shields/'],
    priceRe: [], countRe: [], // free browser: $0, no broker count
  },
  onerep: {
    urls: ['https://onerep.com/pricing'],
    priceRe: ANNUAL_PRICE,
    countRe: BROKER_COUNT,
  },
  privacybee: {
    urls: ['https://privacybee.com/pricing'],
    priceRe: [/\$\s*([\d,]+\.\d{2})\s*\/\s*month/i, ...ANNUAL_PRICE],
    countRe: [/(\d[\d,]*)\s*(?:data brokers?|broker sites?)/i, ...BROKER_COUNT],
    monthlyPrice: true, // headline prices are monthly; annualise x12
  },
  firefox: {
    urls: ['https://support.mozilla.org/en-US/kb/enhanced-tracking-protection-firefox-desktop'],
    priceRe: [], countRe: [], // free browser: $0, no broker count
  },
};

// ------------------------------------------------------- custom parsers
// Each returns checks: [{ field, stored, found, changed, couldNotRead,
// reason, clean }]. `clean` means the figure was read unambiguously
// from the canonical page, so a non-dry-run may write it back.
// `field` maps to a JSON path (see applyUpdates).

function check(field, stored, found, opts) {
  opts = opts || {};
  const c = { field, stored: stored == null ? null : stored,
    found: found == null ? null : found,
    changed: false, couldNotRead: false, reason: opts.reason || null,
    clean: !!opts.clean, url: opts.url || null };
  if (found == null) {
    c.couldNotRead = true;
    c.reason = opts.reason || 'figure not found on page';
  } else if (stored != null && found !== stored) {
    c.changed = true;
  }
  return c;
}

function skipped(field, stored, reason) {
  return { field, stored: stored == null ? null : stored, found: null,
    changed: false, couldNotRead: false, skipped: true, reason };
}

// Norton: two bills. The PMA page gives the $109.99/yr add-on price and
// the "over 2,000" broker count. Select Plus ($99.99) has no dedicated
// canonical page in refs, so the stack total is re-derived as
// 99.99 + the re-read PMA price (= $209.98 at the stored figures).
function parseNorton(pages, stored) {
  const checks = [];
  const pma = pages[0] || {};
  const pmaTier = (stored.tiers || []).find((t) => /Privacy Monitor Assistant \(full\)/.test(t.name || ''));
  const pmaPrice = pmaTier ? pmaTier.priceAnnual : 109.99;

  if (!pma.ok) {
    checks.push(check('norton.pmaPrice', pmaPrice, null, { reason: 'could not fetch PMA page: ' + pma.error, url: CONFIG.norton.urls[0] }));
    checks.push(check('norton.brokerCount', 2000, null, { reason: 'could not fetch PMA page: ' + pma.error, url: CONFIG.norton.urls[0] }));
  } else {
    const price = parseMoney(firstMatch(pma.text, [
      /\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year|a year)/i,
      /Privacy Monitor Assistant[\s\S]{0,400}?\$\s*([\d,]+\.\d{2})/i,
    ]));
    checks.push(check('norton.pmaPrice', pmaPrice, price, { clean: price != null, url: CONFIG.norton.urls[0] }));
    const count = parseCount(firstMatch(pma.text, [
      /over\s+([\d,]+)\s+data broker/i,
      /([\d,]+)\+?\s+data broker sites/i,
    ]));
    checks.push(check('norton.brokerCount', 2000, count, { url: CONFIG.norton.urls[0] }));
  }

  // Re-derive the two-bill stack total only when the PMA price re-read
  // cleanly: Select Plus $99.99 + PMA add-on.
  const pmaC = checks[0];
  if (pmaC.found != null) {
    const total = Math.round((99.99 + pmaC.found) * 100) / 100;
    checks.push(check('norton.stackTotal', stored.stackTotal, total, { clean: true }));
  }
  return checks;
}

// Aura: aura.com/pricing — annual Individual price + "425+" count.
function parseAura(pages, stored) {
  const page = pages[0] || {};
  if (!page.ok) {
    return [
      check('priceAnnual', stored.priceAnnual, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.aura.urls[0] }),
      check('brokerCount', stored.brokerCount, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.aura.urls[0] }),
    ];
  }
  // Aura prices monthly: Individual is "$12 /mo ... billed annually"
  // (= $144/yr). Annualise the Individual monthly figure; fall back to
  // any explicit annual price on the page.
  let price = parseMoney(firstMatch(page.text, [
    /Individual[\s\S]{0,400}?\$\s*([\d,]+(?:\.\d{2})?)\s*\/mo[^$]{0,120}?billed annually/i,
  ]));
  if (price != null) price = Math.round(price * 12 * 100) / 100;
  if (price == null) {
    price = parseMoney(firstMatch(page.text, [
      /\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year|billed annually)/i,
      /\$\s*([\d,]+)\s*(?:\/\s*year|per year)/i,
    ]));
  }
  const count = parseCount(firstMatch(page.text, [
    /(\d[\d,]*)\+\s*(?:data brokers?|brokers)/i,
    /(\d[\d,]*)\+\s*(?:sites|sources)/i,
  ]));
  return [
    check('priceAnnual', stored.priceAnnual, price, { clean: price != null, url: CONFIG.aura.urls[0] }),
    check('brokerCount', stored.brokerCount, count, { clean: count != null, url: CONFIG.aura.urls[0] }),
  ];
}

// Incogni: incogni.com/pricing — Standard $95.88/yr + "420+" count.
function parseIncogni(pages, stored) {
  const page = pages[0] || {};
  if (!page.ok) {
    return [
      check('priceAnnual', stored.priceAnnual, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.incogni.urls[0] }),
      check('brokerCount', stored.brokerCount, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.incogni.urls[0] }),
    ];
  }
  // Incogni shows Standard as "$7.99 /month ... Billed at $191.76
  // $95.88 annually". The monthly figure must NOT be taken as the
  // annual price — only accept a price with an annual anchor.
  const price = parseMoney(firstMatch(page.text, [
    /\$\s*([\d,]+\.\d{2})\s+annually/i,
    /\$\s*([\d,]+\.\d{2})\s+billed yearly/i,
    /Standard[\s\S]{0,600}?\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year|annually)/i,
  ]));
  const count = parseCount(firstMatch(page.text, [
    /(\d[\d,]*)\+\s*(?:data brokers?|brokers)/i,
    /(\d[\d,]*)\+\s*(?:sites|sources)/i,
  ]));
  return [
    check('priceAnnual', stored.priceAnnual, price, { clean: price != null, url: CONFIG.incogni.urls[0] }),
    check('brokerCount', stored.brokerCount, count, { clean: count != null, url: CONFIG.incogni.urls[0] }),
  ];
}

// Optery: optery.com/pricing/ — Core $39/yr; counts Core / Extended /
// Ultimate automated + total incl. custom removals. Plan cards are
// JS-rendered, so a thin fetch is flagged could-not-read, never guessed.
function parseOptery(pages, stored) {
  const page = pages[0] || {};
  if (!page.ok) {
    return [
      check('priceAnnual', stored.priceAnnual, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.optery.urls[0] }),
      check('brokerCount', stored.brokerCount, null, { reason: 'could not fetch pricing page: ' + page.error, url: CONFIG.optery.urls[0] }),
    ];
  }
  const t = page.text;
  const price = parseMoney(firstMatch(t, [
    /Core[\s\S]{0,600}?\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year)/i,
    /\$\s*([\d,]+\.\d{2})\s*(?:\/\s*year|per year)/i,
  ]));
  // Core count: "removal from N+ Sites" in the Core card; fall back to
  // the first "N+ Sites" automated-removal figure on the page.
  const core = parseCount(firstMatch(t, [
    /Core[\s\S]{0,800}?(\d[\d,]*)\+\s*Sites/i,
    /Automated removals from\s+(\d[\d,]*)\+\s*Sites/i,
  ]));
  const checks = [
    check('priceAnnual', stored.priceAnnual, price, { clean: price != null, url: CONFIG.optery.urls[0] }),
    check('brokerCount', stored.brokerCount, core, { clean: core != null, url: CONFIG.optery.urls[0] }),
  ];
  // Extra tier counts, reported but never written to priceAnnual/count.
  const ext = parseCount(firstMatch(t, [/Extended[\s\S]{0,800}?(\d[\d,]*)\+\s*Sites/i]));
  const ult = parseCount(firstMatch(t, [/Ultimate[\s\S]{0,800}?(\d[\d,]*)\+\s*Sites/i]));
  const total = parseCount(firstMatch(t, [/(\d[\d,]*)\+\s*Sites total/i]));
  checks.push(check('optery.extendedCount', null, ext, { url: CONFIG.optery.urls[0] }));
  checks.push(check('optery.ultimateCount', null, ult, { url: CONFIG.optery.urls[0] }));
  checks.push(check('optery.totalCount', null, total, { url: CONFIG.optery.urls[0] }));
  return checks;
}

const CUSTOM_PARSERS = {
  norton: parseNorton,
  aura: parseAura,
  incogni: parseIncogni,
  optery: parseOptery,
};

// -------------------------------------------------------- generic engine
async function scrapeCompany(id) {
  const cfg = CONFIG[id];
  if (!cfg) return { id, error: 'no config entry' };
  const file = path.join(DATA_DIR, id + '.json');
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { id, error: 'cannot read data file: ' + e.message };
  }

  // Fetch every configured canonical page (plain fetch first).
  const pages = [];
  for (const url of cfg.urls) {
    pages.push(await getPageText(url, true));
  }
  const text = pages.filter((p) => p.ok).map((p) => p.text).join(' ');
  const firstUrl = cfg.urls[0];

  if (cfg.custom && CUSTOM_PARSERS[cfg.custom]) {
    return { id, stored, checks: CUSTOM_PARSERS[cfg.custom](pages, stored) };
  }

  const checks = [];
  // ---- price ----
  if (stored.priceAnnual == null || (cfg.priceRe || []).length === 0) {
    checks.push(skipped('priceAnnual', stored.priceAnnual,
      stored.priceAnnual === 0 ? 'free product ($0)' : 'no stored price / nothing to check'));
  } else if (!text) {
    checks.push(check('priceAnnual', stored.priceAnnual, null, {
      reason: 'could not fetch ' + firstUrl + ': ' + (pages[0].error || 'unknown error') +
        (cfg.jsPrice ? ' (price is JS-rendered)' : ''), url: firstUrl }));
  } else {
    let found = parseMoney(firstMatch(text, cfg.priceRe));
    if (found != null && cfg.monthlyPrice) found = Math.round(found * 12 * 100) / 100;
    // Generic first-regex-match is only trusted as CONFIRMATION: a
    // differing figure is reported as CHANGED but never auto-written,
    // because cluttered pages (other tiers, savings, coverage amounts)
    // routinely produce false "new" figures. A human reviews the diff
    // and updates the data file. Only the four tight custom parsers
    // may auto-write a changed figure.
    const clean = found != null && found === stored.priceAnnual;
    checks.push(check('priceAnnual', stored.priceAnnual, found, {
      clean,
      reason: found == null
        ? 'annual price not found on page' + (cfg.jsPrice ? ' (price is JS-rendered)' : '')
        : null,
      url: firstUrl }));
  }
  // ---- broker count ----
  if (stored.brokerCount == null || (cfg.countRe || []).length === 0) {
    checks.push(skipped('brokerCount', stored.brokerCount, 'no stored broker count'));
  } else if (!text) {
    checks.push(check('brokerCount', stored.brokerCount, null, {
      reason: 'could not fetch ' + firstUrl + ': ' + (pages[0].error || 'unknown error'), url: firstUrl }));
  } else {
    const found = parseCount(firstMatch(text, cfg.countRe));
    checks.push(check('brokerCount', stored.brokerCount, found, {
      clean: found != null && found === stored.brokerCount, // see price note above
      reason: found == null ? 'broker count not found on page' : null,
      url: firstUrl }));
  }
  return { id, stored, checks };
}

// ------------------------------------------------------------- updates
// Write back ONLY changed figures that were read cleanly. Returns the
// list of applied updates (for the report).
function applyUpdates(id, stored, checks) {
  const updates = [];
  const file = path.join(DATA_DIR, id + '.json');
  let touched = false;

  function setField(field, value) {
    if (field === 'priceAnnual' || field === 'brokerCount') {
      stored[field] = value;
    } else if (field === 'norton.pmaPrice') {
      const t = (stored.tiers || []).find((x) => /Privacy Monitor Assistant \(full\)/.test(x.name || ''));
      if (t) t.priceAnnual = value;
      const s = (stored.stackSlices || []).find((x) => /Privacy Monitor Assistant/.test(x.name || ''));
      if (s) s.value = value;
    } else if (field === 'norton.stackTotal') {
      stored.stackTotal = value;
    } else {
      return false; // report-only field (e.g. optery tier counts)
    }
    return true;
  }

  for (const c of checks) {
    if (!c.changed || !c.clean || c.couldNotRead) continue;
    if (setField(c.field, c.found)) {
      touched = true;
      updates.push({ field: c.field, from: c.stored, to: c.found, url: c.url });
    }
  }
  if (touched) {
    stored.checkedAt = todayISO();
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
  }
  return updates;
}

// ----------------------------------------------------------------- main
async function main() {
  const ids = Object.keys(CONFIG);
  const targets = ONLY
    ? (ids.includes(ONLY) ? [ONLY] : usageError('unknown company id: ' + ONLY))
    : ids;

  const results = [];
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    playwrightAvailable: !!playwright,
    companies: {},
  };

  for (const id of targets) {
    const r = await scrapeCompany(id);
    if (r.error) {
      console.log(id + ': could not re-read: ' + r.error);
      report.companies[id] = { error: r.error };
      results.push(r);
      continue;
    }
    // One log line per company.
    const parts = [];
    for (const c of r.checks) {
      if (c.skipped) {
        parts.push(c.field + ' skipped (' + c.reason + ')');
      } else if (c.couldNotRead) {
        parts.push(c.field + ' could not re-read: ' + c.reason);
      } else if (c.changed) {
        parts.push(c.field + ' ' + c.stored + ' -> ' + c.found + ' (CHANGED)');
      } else {
        parts.push(c.field + ' ' + c.stored + ' -> ' + c.found + ' (unchanged)');
      }
    }
    console.log(id + ': ' + parts.join(' | '));

    let updates = [];
    if (!DRY_RUN) updates = applyUpdates(id, r.stored, r.checks);
    else {
      // In dry-run, list what WOULD change.
      updates = r.checks
        .filter((c) => c.changed && c.clean && !c.couldNotRead)
        .map((c) => ({ field: c.field, from: c.stored, to: c.found, url: c.url, wouldChange: true }));
    }
    report.companies[id] = {
      checks: r.checks,
      updates: updates,
    };
    results.push(r);
  }

  const changedCount = Object.values(report.companies)
    .reduce((n, c) => n + (c.updates || []).length, 0);
  const unreadableCount = Object.values(report.companies)
    .reduce((n, c) => n + ((c.checks || []).filter((x) => x.couldNotRead).length), 0);

  if (DRY_RUN) {
    console.log('\n--- dry-run report (nothing written) ---');
    console.log(JSON.stringify(report, null, 2));
  } else {
    const out = path.join(DATA_DIR, 'changes-' + todayISO() + '.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log('\nWrote ' + out);
  }
  console.log('Done: ' + targets.length + ' companies, ' + changedCount +
    ' figure(s) ' + (DRY_RUN ? 'would change' : 'updated') + ', ' +
    unreadableCount + ' check(s) could not be re-read.');
  process.exit(0);
}

main().catch((e) => {
  console.error('scrape.js failed: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
