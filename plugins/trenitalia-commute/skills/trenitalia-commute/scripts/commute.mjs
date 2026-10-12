// Trenitalia commute helper for lefrecce.it, driven by the personal config file (no personal data in this file).
//
//   node commute.mjs status [--days=20] [--from=YYYY-MM-DD] [--visible] [--debug]
//       Read-only plan: session, legs already booked, matching train per workday, legs still to book.
//   node commute.mjs book [--count=N] [--confirm] [--headless]
//       Books the days the account still misses (every leg to book), in order, at €0,00 only; all of them in the
//       window unless --count limits the number.
//       Without --confirm it stops on the payment page; --confirm accepts the conditions of carriage.
//   node commute.mjs login [--manual]
//       Visible Chrome on the dedicated profile: signs in from the saved credential (save-credential.ps1);
//       with --manual it also waits (at most 5 minutes) for you to sign in by hand.
//   node commute.mjs record
//       Visible Chrome that records the site's API calls (personal values masked) while you book one day by hand.
//
// Common flag: --config=<path> (default: $TRENITALIA_COMMUTE_CONFIG or ~/.trenitalia-commute/config.json).
// Output: one JSON line on stdout, a readable summary on stderr. Exit code 0 = ok, 1 = error, 2 = sign-in needed.
// Uses the Chrome installed on the machine through playwright-core (no browser download).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SITE = 'https://www.lefrecce.it/Channels.Website.WEB/';
const API = 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website';

const argv = process.argv.slice(2);
const command = argv.find((argument) => !argument.startsWith('--')) || 'status';
const flag = (name) => argv.find((argument) => argument === `--${name}` || argument.startsWith(`--${name}=`));
const flagValue = (name) => flag(name)?.split('=').slice(1).join('=') || null;

const configFile = path.resolve(flagValue('config') || process.env.TRENITALIA_COMMUTE_CONFIG || path.join(os.homedir(), '.trenitalia-commute', 'config.json'));
const home = path.dirname(configFile);
const profileDirectory = path.join(home, 'browser-profile');
const runsDirectory = path.join(home, 'runs');

const two = (number) => String(number).padStart(2, '0');
const isoDay = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
const stamp = (date = new Date()) => `${isoDay(date)}_${two(date.getHours())}${two(date.getMinutes())}`;
const italianDay = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total) => `${two(Math.floor(Math.max(0, total) / 60))}:${two(Math.max(0, total) % 60)}`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const weekdayName = (day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day}T12:00:00`).getDay()];

const result = { command, ok: false, step: 'config', startedAt: new Date().toISOString() };
const fail = (step, message, exitCode = 1) => { const error = new Error(message); error.step = step; error.exitCode = exitCode; throw error; };

function readConfig() {
  if (!fs.existsSync(configFile)) fail('config', `config not found: ${configFile} (copy config.example.json there and fill it)`);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (JSON.stringify(config).includes('CHANGE-ME')) fail('config', 'config contains CHANGE-ME placeholders');
  for (const key of ['traveller', 'stations', 'legs']) if (!config[key]) fail('config', `config field missing: ${key}`);
  for (const key of ['firstName', 'lastName']) if (!config.traveller[key]) fail('config', `traveller.${key} missing`);
  for (const leg of config.legs) {
    for (const key of ['id', 'from', 'to', 'service', 'departAfter', 'departBefore']) if (!leg[key]) fail('config', `legs[${leg.id || '?'}].${key} missing`);
    for (const end of [leg.from, leg.to]) if (!config.stations[end]) fail('config', `legs[${leg.id}] uses unknown station key "${end}"`);
  }
  config.window = { workingDays: 20, weekdays: [1, 2, 3, 4, 5], extraHolidays: [], minutesBeforeDeparture: 15, ...config.window };
  return config;
}

// --- Italian national holidays: fixed dates, Easter Monday, and 4 October from 2026 (Legge 8 ottobre 2025, n. 151)
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function isHoliday(day, extraHolidays) {
  const year = Number(day.slice(0, 4));
  const monthDay = day.slice(5);
  const fixed = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'];
  if (year >= 2026) fixed.push('10-04');
  const easterMonday = easterSunday(year);
  easterMonday.setDate(easterMonday.getDate() + 1);
  return fixed.includes(monthDay) || day === isoDay(easterMonday) || extraHolidays.includes(day) || extraHolidays.includes(monthDay);
}

function targetDays(config, fromDay) {
  const days = [];
  const date = new Date(`${fromDay}T12:00:00`);
  while (days.length < config.window.workingDays) {
    const day = isoDay(date);
    if (config.window.weekdays.includes(date.getDay()) && !isHoliday(day, config.window.extraHolidays)) days.push(day);
    date.setDate(date.getDate() + 1);
  }
  return days;
}

// --- saved credential: environment variables, or (Windows) a DPAPI-encrypted file written by Export-Clixml
function savedCredential() {
  if (process.env.TRENITALIA_USERNAME && process.env.TRENITALIA_PASSWORD) {
    return { username: process.env.TRENITALIA_USERNAME, password: process.env.TRENITALIA_PASSWORD };
  }
  const file = path.join(home, 'credential.xml');
  if (process.platform !== 'win32' || !fs.existsSync(file)) return null;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$c = Import-Clixml -LiteralPath $env:TRENITALIA_CREDENTIAL_FILE; $c.UserName; $c.GetNetworkCredential().Password'],
  { encoding: 'utf8', env: { ...process.env, TRENITALIA_CREDENTIAL_FILE: file } });
  const [username, password] = output.split(/\r?\n/);
  return username && password ? { username, password } : null;
}

// --- mask known personal values in recordings and diagnostic samples
function masker(config, credential) {
  const personal = [config.traveller.firstName, config.traveller.lastName, config.traveller.tuttoTrenoCardNumber, credential?.username, credential?.password]
    .filter((value) => value && String(value).length > 2).map((value) => String(value).toLowerCase());
  const sensitiveKey = /pass(word)?|token|secret|cookie|e-?mail|phone|mobile|birth|fiscal|^(first|last)name$|surname|holder|cardnumber|loyaltycode|cartafreccia|tuttotreno|customerkey|pnr|booking.?reference/i;
  const mask = (value, key = '') => {
    if (Array.isArray(value)) return value.map((item) => mask(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, mask(child, childKey)]));
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (sensitiveKey.test(key)) return '***';
    let text = String(value);
    for (const secret of personal) text = text.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
    return typeof value === 'number' && text === String(value) ? value : text;
  };
  return mask;
}

async function openBrowser({ headless }) {
  fs.mkdirSync(profileDirectory, { recursive: true });
  // --- English interface: the booking steps and their labels were verified in English
  const options = { headless, viewport: { width: 1366, height: 900 }, locale: 'en-GB' };
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH; else options.channel = 'chrome';
  const context = await chromium.launchPersistentContext(profileDirectory, options);
  // --- pages load in 1-5 s and elements appear at once: navigation at most 20 s, every other step at most 10 s
  context.setDefaultNavigationTimeout(20000);
  context.setDefaultTimeout(10000);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(SITE, { waitUntil: 'load' });
  await wait(1500);
  // --- calls run inside the page with the headers the site's own request interceptor adds;
  //     the session token is read and used there, never returned to this process
  const api = (method, apiPath, body) => page.evaluate(async ({ url, method, body }) => {
    let token = null;
    try { token = JSON.parse(localStorage.getItem('aurelia_authentication') || '{}').access_token || null; } catch { /* no session */ }
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'Fetch', 'X-CSRF-Token': localStorage.getItem('xsrf') || '',
      Channel: localStorage.getItem('channelID') || '41', 'accept-language': 'en-GB', CallerTimestamp: String(Date.now()) };
    if (token) headers.Authorization = `Bearer ${token}`;
    // --- the site's API answers in 0.2-2 s: at most 15 s per call
    const response = await fetch(url, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) })
      .catch((error) => ({ status: 0, text: async () => `request failed: ${error.name}` }));
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text: json ? null : text.slice(0, 300) };
  }, { url: API + apiPath, method, body });
  return { context, page, api };
}

// --- on failure: local screenshot and visible form field identifiers in the runs folder
async function evidence(page, step) {
  try {
    fs.mkdirSync(runsDirectory, { recursive: true });
    const file = path.join(runsDirectory, `${stamp()}_${command}-${step}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
    const fields = await page.evaluate(() => [...document.querySelectorAll('input,button')].filter((element) => element.offsetParent).slice(0, 25)
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || '-'}[${element.type || ''}]`));
    const address = new URL(page.url());
    result.evidence = { screenshot: file, url: address.origin + address.pathname, fields };
  } catch { /* the page may already be closed */ }
}

// --- signed in as the traveller = unexpired session token + traveller's surname in the header + trip list answers.
//     Each alone is not enough: signed out, travel/solutions answers 200 with an empty list, and auth/me answers 400
//     also when signed in. An empty list from a signed-out page would look like "nothing booked".
async function session(page, api, config) {
  const token = await page.evaluate(() => {
    let value = null;
    try { value = JSON.parse(localStorage.getItem('aurelia_authentication') || '{}').access_token || null; } catch { /* no session */ }
    if (!value) return { present: false };
    try { return { present: true, expiresAt: (JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0) * 1000 || null }; } catch { return { present: true, expiresAt: null }; }
  });
  const unexpired = token.present && (!token.expiresAt || token.expiresAt > Date.now() + 60000);
  const surname = config.traveller.lastName.toLowerCase();
  let header = '';
  for (let attempt = 0; unexpired && attempt < 10 && !header.includes(surname); attempt++) {
    header = (await page.evaluate(() => document.querySelector('header')?.innerText || '').catch(() => '')).toLowerCase();
    if (!header.includes(surname)) await wait(500);
  }
  const accountMatchesTraveller = unexpired ? header.includes(surname) : null;
  const today = italianDay(isoDay(new Date()));
  const probe = unexpired ? await api('POST', '/travel/solutions', { travelGroup: 'TICKET', searchType: 'DEPARTURE_DATE', fromDate: today, toDate: today, code: null, limit: 1, offset: 0 }) : null;
  const signedIn = unexpired && accountMatchesTraveller && probe.status === 200 && Array.isArray(probe.json?.solutions);
  return { signedIn, accountMatchesTraveller, tokenExpiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : null };
}

async function signIn(page, api, config, credential) {
  await page.goto(`${SITE}#/login`, { waitUntil: 'load' });
  const usernameField = page.locator('#username:visible').first();
  await usernameField.waitFor();
  // --- a greyed-out form means some account is already signed in in this profile
  if (!(await usernameField.isEditable())) return session(page, api, config);
  await usernameField.fill(credential.username);
  await page.locator('#password:visible').first().fill(credential.password);
  await page.getByRole('button', { name: /^\s*(LOG IN|ACCEDI)\s*$/i }).first().click();
  // --- the site signs in within about 5 s: check for at most 15 s, then keep the evidence
  for (let attempt = 0; attempt < 5; attempt++) {
    await wait(3000);
    const state = await session(page, api, config);
    if (state.signedIn) return state;
  }
  await evidence(page, 'sign-in');
  const message = await page.evaluate(() => [...document.querySelectorAll('.alert, .error, .invalid-feedback, [role=alert], .modal.show')]
    .map((element) => element.innerText.trim()).filter(Boolean).join(' | ').slice(0, 200)).catch(() => '');
  return { signedIn: false, accountMatchesTraveller: null, pageMessage: message || null };
}

async function ensureSession(page, api, config) {
  let state = await session(page, api, config);
  if (state.signedIn) return { ...state, how: 'existing session' };
  const credential = savedCredential();
  if (!credential) return { ...state, how: 'no saved credential' };
  state = await signIn(page, api, config, credential);
  return { ...state, how: state.signedIn ? 'saved credential' : 'saved credential rejected or challenge shown' };
}

async function stationIds(api, config) {
  const ids = {};
  for (const [key, name] of Object.entries(config.stations)) {
    const response = await api('GET', `/locations/search?name=${encodeURIComponent(name)}&limit=10`);
    const match = (response.json || []).find((station) => station.name.toLowerCase() === name.toLowerCase());
    if (!match) fail('stations', `station "${name}" not found by locations/search (status ${response.status})`);
    ids[key] = match.id;
  }
  return ids;
}

async function findTrain(api, ids, leg, day) {
  const floor = clock(minutes(leg.departAfter) - 10);
  const response = await api('POST', '/ticket/solutions', {
    departureLocationId: ids[leg.from], arrivalLocationId: ids[leg.to], departureTime: `${day}T${floor}:00.000`, adults: 1, children: 0,
    criteria: { frecceOnly: false, regionalOnly: false, intercityOnly: false, tourismOnly: false, noChanges: false, order: 'DEPARTURE_DATE', offset: 0, limit: 10 },
    advancedSearchRequest: { bestFare: false, bikeFilter: false, forwardDiscountCodes: [] },
  });
  if (response.status !== 200 || !Array.isArray(response.json?.solutions)) return { error: `ticket/solutions answered ${response.status}` };
  const solutions = response.json.solutions.map((entry) => entry.solution);
  const label = (solution) => `${solution.departureTime.slice(11, 16)} ${solution.trains.map((train) => train.acronym + ' ' + train.name).join(' + ')}`;
  const match = solutions.find((solution) => {
    const time = solution.departureTime.slice(11, 16);
    return solution.trains.length === 1 && solution.trains[0].acronym === leg.service && time >= leg.departAfter && time <= leg.departBefore;
  });
  if (!match) return { train: null, seen: solutions.slice(0, 5).map(label) };
  return { train: `${match.trains[0].acronym} ${match.trains[0].name}`, departure: match.departureTime.slice(11, 16), arrival: match.arrivalTime.slice(11, 16), saleable: match.status === 'SALEABLE' };
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results;
}

// --- trips of the account: travel/solutions, 10 per page (the page "I miei viaggi" uses the same call)
function toIsoDateTime(value) {
  if (/^\d{4}-\d\d-\d\d/.test(value)) return value.slice(0, 16).replace(' ', 'T');
  const italian = value.match(/^(\d\d)\/(\d\d)\/(\d{4})\D*(\d\d:\d\d)?/);
  return italian ? `${italian[3]}-${italian[2]}-${italian[1]}T${italian[4] || '00:00'}` : null;
}

// --- one item per leg: station names and times in description, departureDate, pnr,
//     typeDescription "Prenotazione Abbonamento"; any type counts as booked
function tripLegs(items) {
  const legs = new Map();
  for (const item of items) {
    const route = String(item.description || '').match(/^(.+?)\s*\((\d\d:\d\d)\)\s*-\s*(.+?)\s*\((\d\d:\d\d)\)/);
    const departure = toIsoDateTime(String(item.departureDate || ''));
    if (!route || !departure || /CANCEL|REFUND|ANNULL|RIMBORS/i.test(item.statusDescription || '')) continue;
    const key = `${route[1]}|${route[3]}|${departure}`;
    if (!legs.has(key)) legs.set(key, { origin: route[1], destination: route[3], departure, pnr: item.pnr || null, type: item.typeDescription || null });
  }
  return [...legs.values()];
}

async function accountTrips(api, fromDay, toDay) {
  const items = [];
  const answers = [];
  for (const travelGroup of ['TICKET', 'SUBSCRIPTION']) {
    for (let offset = 0; offset < 500; offset += 10) {
      const response = await api('POST', '/travel/solutions', { travelGroup, searchType: 'DEPARTURE_DATE', fromDate: italianDay(fromDay), toDate: italianDay(toDay), code: null, limit: 10, offset });
      answers.push(`${travelGroup}@${offset}:${response.status}`);
      const page = Array.isArray(response.json?.solutions) ? response.json.solutions : null;
      if (response.status !== 200 || !page) break;
      items.push(...page);
      if (page.length < 10) break;
    }
  }
  return { items, answers };
}

function plan(config, days, trains, legs, now, signedIn) {
  const stationName = (key) => config.stations[key].toLowerCase();
  return days.flatMap((day, dayIndex) => config.legs.map((leg, legIndex) => {
    const found = trains[dayIndex * config.legs.length + legIndex];
    const booked = legs?.find((trip) => trip.departure.slice(0, 10) === day
      && trip.origin.toLowerCase().startsWith(stationName(leg.from)) && trip.destination.toLowerCase().startsWith(stationName(leg.to)));
    const entry = { day, weekday: weekdayName(day), leg: leg.id, ...found };
    if (booked) return { ...entry, state: 'booked', pnr: booked.pnr, bookedDeparture: booked.departure.slice(11, 16) };
    const departureMinutes = minutes(found.departure || leg.departAfter);
    if (day === isoDay(now) && departureMinutes - config.window.minutesBeforeDeparture <= now.getHours() * 60 + now.getMinutes()) return { ...entry, state: 'departed' };
    if (found.error) return { ...entry, state: 'search-error' };
    if (!found.train) return { ...entry, state: 'no-matching-train' };
    if (!signedIn) return { ...entry, state: 'unknown-not-signed-in' };
    return { ...entry, state: 'to-book', offerId: leg.offerId ?? null };
  }));
}

function summary(rows) {
  for (const row of rows) {
    const detail = row.state === 'booked' ? `PNR ${row.pnr || '?'} (${row.bookedDeparture})` : row.train ? `${row.train} ${row.departure}` : (row.seen || []).join(', ') || row.error || '';
    process.stderr.write(`${row.day} ${row.weekday}  ${row.leg.padEnd(9)} ${row.state.padEnd(22)} ${detail}\n`);
  }
}

// --- trains per day and leg, the account's trips, and the state of every leg
async function accountPlan(api, config, days, fromDay, signedIn) {
  result.step = 'stations';
  const ids = await stationIds(api, config);
  result.step = 'trains';
  const pairs = days.flatMap((day) => config.legs.map((leg) => ({ day, leg })));
  const trains = await mapLimited(pairs, 3, ({ day, leg }) => findTrain(api, ids, leg, day));
  let legs = null;
  if (signedIn) {
    result.step = 'trips';
    const trips = await accountTrips(api, fromDay, days[days.length - 1]);
    legs = tripLegs(trips.items);
    result.trips = { answers: trips.answers, items: trips.items.length, legs: legs.length };
    if (flag('debug') || (trips.items.length && !legs.length)) {
      fs.mkdirSync(runsDirectory, { recursive: true });
      const file = path.join(runsDirectory, `${stamp()}_trips-sample.json`);
      fs.writeFileSync(file, JSON.stringify(masker(config, null)(trips.items.slice(0, 3)), null, 2));
      result.trips.sample = file;
    }
  }
  result.step = 'plan';
  return plan(config, days, trains, legs, new Date(), signedIn);
}

async function status(config) {
  const fromDay = flagValue('from') || isoDay(new Date());
  if (flagValue('days')) config.window.workingDays = Number(flagValue('days'));
  const days = targetDays(config, fromDay);
  result.step = 'browser';
  const { context, page, api } = await openBrowser({ headless: !flag('visible') });
  try {
    result.step = 'session';
    result.session = await ensureSession(page, api, config);
    result.window = { from: days[0], to: days[days.length - 1], workingDays: days.length };
    result.plan = await accountPlan(api, config, days, fromDay, result.session.signedIn);
    result.toBook = result.plan.filter((row) => row.state === 'to-book').length;
    summary(result.plan);
    if (!result.session.signedIn) fail('session', `not signed in (${result.session.how}): run "node commute.mjs login"`, 2);
    result.ok = true;
  } catch (error) {
    if (error.exitCode !== 2) await evidence(page, error.step || result.step);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

// --- booking through the site's own pages. Every stage checks the €0,00 total;
//     any other price, refusal or surprise stops the day.
const pageTotal = (page) => page.evaluate(() => (document.body.innerText.match(/(Total price|Prezzo totale)\s*:\s*€\s*([\d.]+,\d\d)/i) || [])[2] || null);

async function expectFree(page, where) {
  const total = await pageTotal(page);
  if (total !== '0,00') fail('book', `${where}: total is ${total === null ? 'not readable' : '€' + total}, not €0,00`);
}

async function chooseStation(page, selector, name) {
  const field = page.locator(selector).first();
  if ((await field.inputValue()) === name) return;
  await field.click();
  await field.fill('');
  // --- one character short: the full name suppresses the suggestions
  await field.pressSequentially(name.slice(0, -1), { delay: 60 });
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(500);
}

async function searchDay(page, config, day) {
  const [outbound, back] = config.legs;
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await chooseStation(page, 'input#origin-station', config.stations[outbound.from]);
  await chooseStation(page, 'input#destination-station', config.stations[outbound.to]);
  if (!(await page.locator('input#returnDate-end-dt-input:visible').count())) {
    await page.getByRole('button', { name: /Aggiungi un ritorno|RETURN JOURNEY|RITORNO/i }).first().click();
    await page.waitForTimeout(800);
  }
  // --- adding the return sometimes clears the destination
  await chooseStation(page, 'input#destination-station', config.stations[outbound.to]);
  const [year, month, date] = day.split('-').map(Number);
  const fieldDate = (await page.locator('input#departureDate-dt-input').first().inputValue()).split('/').map(Number);
  await page.locator('input#departureDate-dt-input').click();
  await page.waitForTimeout(800);
  // --- two months are shown: find the grid titled with the target month; otherwise count from the month of the
  //     date in the field, which the calendar shows first
  let monthIndex = -1;
  {
    monthIndex = await page.evaluate(({ month, year }) => {
      const names = [['JANUARY', 'GENNAIO'], ['FEBRUARY', 'FEBBRAIO'], ['MARCH', 'MARZO'], ['APRIL', 'APRILE'], ['MAY', 'MAGGIO'], ['JUNE', 'GIUGNO'], ['JULY', 'LUGLIO'], ['AUGUST', 'AGOSTO'], ['SEPTEMBER', 'SETTEMBRE'], ['OCTOBER', 'OTTOBRE'], ['NOVEMBER', 'NOVEMBRE'], ['DECEMBER', 'DICEMBRE']];
      const titleOf = (grid) => { let node = grid; for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) { const found = (node.innerText || '').toUpperCase().match(/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|GENNAIO|FEBBRAIO|MARZO|APRILE|MAGGIO|GIUGNO|LUGLIO|AGOSTO|SETTEMBRE|OTTOBRE|NOVEMBRE|DICEMBRE)\s+(\d{4})/g); if (found && found.length === 1) return found[0]; } return ''; };
      return [...document.querySelectorAll('div.day-grid')].filter((grid) => grid.offsetParent).findIndex((grid) => { const title = titleOf(grid); return names[month - 1].some((name) => title.startsWith(name)) && title.endsWith(String(year)); });
    }, { month, year });
  }
  if (monthIndex < 0 && fieldDate.length === 3) {
    const offset = (year * 12 + month) - (fieldDate[2] * 12 + fieldDate[1]);
    if (offset === 0 || offset === 1) monthIndex = offset;
  }
  if (monthIndex < 0) fail('book', `calendar: month ${month}/${year} not among the two months shown`);
  await page.locator('div.day-grid:visible').nth(monthIndex).locator('button', { hasText: new RegExp(`^\\s*${date}\\s*$`) }).first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  const setTime = async (input, time) => {
    await page.locator(input).click();
    await page.waitForTimeout(500);
    await page.locator('button.btn-item:visible', { hasText: new RegExp(`^\\s*${time}\\s*$`) }).first().click();
    await page.waitForTimeout(500);
  };
  // --- floor below the window, rounded down to the quarter hour of the time list
  const floor = (leg) => clock(Math.floor((minutes(leg.departAfter) - 10) / 15) * 15);
  await setTime('input#departureTime-dt-input', floor(outbound));
  await setTime('input#returnTime-dt-input', floor(back));
  const read = (id) => page.locator(`input#${id}`).first().inputValue();
  const expected = italianDay(day);
  const form = { from: await read('origin-station'), to: await read('destination-station'), outboundDate: await read('departureDate-dt-input'), returnDate: await read('returnDate-end-dt-input') };
  if (form.from !== config.stations[outbound.from] || form.to !== config.stations[outbound.to] || form.outboundDate !== expected || form.returnDate !== expected) {
    fail('book', `search form not as expected: ${JSON.stringify(form)}`);
  }
  await page.getByRole('button', { name: /^\s*(SEARCH|CERCA)\s*$/i }).first().click();
  await page.waitForURL(/search-results/);
  await page.waitForTimeout(3000);
}

async function chooseFreeFare(page, config, leg, row) {
  const [trainType, trainNumber] = row.train.split(' ');
  const card = page.locator('div.card.solution').filter({ hasText: row.departure }).filter({ hasText: trainNumber }).first();
  if (!(await card.count())) fail('book', `${leg.id}: ${row.train} ${row.departure} not in the results`);
  await card.locator('[role=button][aria-expanded]').first().click();
  await page.waitForTimeout(2000);
  await card.getByText(/^\s*(SEE OTHER OFFERS|VEDI ALTRE OFFERTE)\s*$/i).first().click();
  // --- the offer panel fills asynchronously: up to 15 s
  let select = null;
  for (let attempt = 0; attempt < 15 && !select; attempt++) {
    await page.waitForTimeout(1000);
    const candidate = page.locator('select:visible').filter({ has: page.locator(`option[value="${leg.offerId}"]`) }).first();
    if (await candidate.count()) { select = candidate; break; }
    // --- the free fares are second class, but the panel can open on another service:
    //     switch the Service select to the second-class entry and look again
    // --- the offer list follows the service only once the panel has settled: a switch made too early leaves the
    //     first-class offers (526/524) under "2ª CLASSE", so switch away and back until the list changes (3 times)
    const service = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('select')].filter((element) => element.offsetParent);
      const index = visible.findIndex((element) => [...element.options].some((option) => /^\s*2/.test(option.text)) && [...element.options].some((option) => /CLASS/i.test(option.text)));
      if (index < 0) return null;
      const options = [...visible[index].options];
      return { index, second: options.find((option) => /^\s*2/.test(option.text)).value, other: (options.find((option) => !/^\s*2/.test(option.text)) || {}).value, onSecond: /^\s*2/.test(visible[index].options[visible[index].selectedIndex]?.text || '') };
    });
    if (service && (attempt === 2 || attempt === 6 || attempt === 10) && (!service.onSecond || service.other !== undefined)) {
      const serviceSelect = page.locator('select:visible').nth(service.index);
      if (service.onSecond && service.other !== undefined) { await serviceSelect.selectOption(service.other); await page.waitForTimeout(2500); }
      await serviceSelect.selectOption(service.second);
      await page.waitForTimeout(3000);
    }
  }
  // --- a custom dropdown can hide the native select: use a hidden one that holds the fare; otherwise report every
  //     select with its free fares, to tell "hidden" from "not offered that day"
  if (!select) {
    const hidden = page.locator('select').filter({ has: page.locator(`option[value="${leg.offerId}"]`) }).first();
    if (await hidden.count()) {
      await hidden.selectOption(String(leg.offerId), { force: true });
      select = { selectOption: (value) => hidden.selectOption(value, { force: true }) };
    } else {
      const seen = await page.evaluate(() => [...document.querySelectorAll('select')].map((element) => `${element.offsetParent ? 'visible' : 'hidden'} "${element.options[element.selectedIndex]?.text.trim()}" free fares: ${[...element.options].filter((option) => /CTT|Abbonam/i.test(option.text)).map((option) => option.value + '=' + option.text.trim()).join(' | ') || 'none'}`));
      fail('book', `${leg.id}: offer ${leg.offerId} not offered for ${trainType} ${trainNumber} on this day (selects: ${seen.join('; ')})`);
    }
  }
  // --- the choice can silently not take while the panel settles: BASE, then the free fare again
  const label = leg.offerName.toUpperCase();
  for (let round = 0; round < 3; round++) {
    await page.waitForTimeout(1500);
    if (round > 0) { await select.selectOption('1'); await page.waitForTimeout(2500); }
    await select.selectOption(String(leg.offerId));
    await page.waitForTimeout(3500);
    const taken = await page.evaluate((label) => document.body.innerText.toUpperCase().includes(label) && !!document.querySelector('input#param-285, input[aria-label="Tutto treno card number"], input[aria-label="Numero carta tutto treno"]'), label);
    if (taken && (await pageTotal(page)) === '0,00') break;
    if (round === 2) fail('book', `${leg.id}: ${leg.offerName} did not give €0,00 after 3 attempts`);
  }
  for (const [selector, value] of [
    ['input#param-10, input[aria-label="Name"], input[aria-label="Nome"]', config.traveller.firstName],
    ['input#param-11, input[aria-label="Surname"], input[aria-label="Cognome"]', config.traveller.lastName],
    ['input#param-285, input[aria-label="Tutto treno card number"], input[aria-label="Numero carta tutto treno"]', config.traveller.tuttoTrenoCardNumber],
  ]) {
    const field = page.locator(selector).filter({ visible: true }).first();
    if ((await field.count()) && !(await field.inputValue())) await field.fill(String(value));
  }
  const seats = page.locator('input#switch-seat');
  if ((await seats.count()) && !(await seats.isChecked())) await seats.check({ force: true });
  await page.waitForTimeout(800);
  await expectFree(page, `${leg.id} fare`);
}

// --- seats: known-good seat for this train if free, else the best free seat in the preferred coaches:
//     no seat beside it (same row), fewest seats in front/behind, fewest occupied neighbours
async function pickSeat(page, config, leg, row) {
  const knownGood = (config.seats?.knownGood || []).filter((entry) => entry.leg === leg.id && entry.train === row.train).map((entry) => `${entry.carriage}-${entry.seat}`);
  const choice = await page.evaluate(({ knownGood, carriages }) => {
    const coachOf = (element) => {
      let node = element;
      for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
        const title = [...node.children].map((child) => (child.innerText || '').match(/^\s*(Coach|Carrozza) (\d+)/)).find(Boolean);
        if (title) return Number(title[2]);
      }
      return null;
    };
    const seats = [...document.querySelectorAll('[aria-label^="Posto a sedere"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute('aria-label');
      return { coach: coachOf(element), seat: label.replace('Posto a sedere ', '').replace(/,.*$/, '').trim(), free: !/non disponibile/i.test(label), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 + window.scrollY };
    }).filter((seat) => seat.coach !== null);
    const known = knownGood.map((id) => seats.find((seat) => `${seat.coach}-${seat.seat}` === id && seat.free)).find(Boolean);
    if (known) return { coach: known.coach, seat: known.seat, how: 'known-good' };
    // --- spacing measured per coach from the map itself (fixed pixel distances missed neighbours):
    //     the median, over the seats, of the gap to the nearest seat of the same row / column; gaps under 12 px and
    //     entries with the same seat name are overlapping labels, not neighbours (a 5 px "spacing" came from them)
    const median = (values) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
    const pitch = {};
    for (const coach of new Set(seats.map((seat) => seat.coach))) {
      const inCoach = seats.filter((seat) => seat.coach === coach && (seat.x || seat.y));
      const nearestAcross = [];
      const nearestAlong = [];
      for (const a of inCoach) {
        let across = Infinity;
        let along = Infinity;
        for (const b of inCoach) {
          if (a === b || a.seat === b.seat) continue;
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          if (dy < 3 && dx >= 12) across = Math.min(across, dx);
          if (dx < 3 && dy >= 12) along = Math.min(along, dy);
        }
        nearestAcross.push(across);
        nearestAlong.push(along);
      }
      pitch[coach] = { across: median(nearestAcross) || 49, along: median(nearestAlong) || 42 };
    }
    const preferred = seats.filter((seat) => carriages.includes(seat.coach));
    const pool = (preferred.length ? preferred : seats).filter((seat) => seat.free);
    const scored = pool.map((seat) => {
      const same = seats.filter((other) => other !== seat && other.seat !== seat.seat && other.coach === seat.coach);
      const { across, along } = pitch[seat.coach];
      const side = same.filter((other) => Math.abs(other.y - seat.y) < along * 0.4 && Math.abs(other.x - seat.x) <= across * 1.25);
      const frontBack = same.filter((other) => Math.abs(other.x - seat.x) < across * 0.4 && Math.abs(other.y - seat.y) <= along * 1.25);
      return { seat, side, frontBack, score: side.length * 10 + frontBack.length * 3 + [...side, ...frontBack].filter((other) => !other.free).length };
    }).sort((a, b) => a.score - b.score);
    const names = (list) => list.map((other) => other.seat + (other.free ? '' : ' taken')).join(', ') || 'none';
    if (!scored.length) return null;
    const best = scored[0];
    const spacing = pitch[best.seat.coach];
    return { coach: best.seat.coach, seat: best.seat.seat, how: `derived, score ${best.score}; beside: ${names(best.side)}; front/behind: ${names(best.frontBack)}; spacing ${Math.round(spacing.across)}x${Math.round(spacing.along)} px` };
  }, { knownGood, carriages: config.seats?.carriages || [] });
  if (!choice) fail('book', `${leg.id}: no free seat on the map`);
  const handle = await page.evaluateHandle(({ coach, seat }) => {
    const coachOf = (element) => { let node = element; for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) { const title = [...node.children].map((child) => (child.innerText || '').match(/^\s*(Coach|Carrozza) (\d+)/)).find(Boolean); if (title) return Number(title[2]); } return null; };
    return [...document.querySelectorAll(`[aria-label^="Posto a sedere ${seat},"]`)].find((element) => coachOf(element) === coach) || null;
  }, choice);
  const element = handle.asElement();
  await element.scrollIntoViewIfNeeded();
  await (await element.evaluateHandle((node) => node.closest('button, a, [role=button], [tabindex]') || node.parentElement)).asElement().click();
  await page.waitForTimeout(1500);
  if (!/selezionat/i.test((await element.getAttribute('aria-label')) || '')) fail('book', `${leg.id}: seat ${choice.coach}-${choice.seat} did not get selected`);
  // --- picture of the choice for the run report; a window in the background may not render it (5 s at most)
  fs.mkdirSync(runsDirectory, { recursive: true });
  const picture = path.join(runsDirectory, `${stamp()}_${row.day}_${leg.id}-seat-${choice.coach}-${choice.seat}.jpg`);
  choice.picture = await element.screenshot({ path: picture, type: 'jpeg', quality: 75, timeout: 5000 }).then(() => picture).catch(() => null);
  return choice;
}

async function cartSummary(page, api) {
  const cartId = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /cart\?cartId=/.test(name)).map((name) => name.match(/cartId=([0-9a-f-]{36})/i)[1]).pop() || null);
  if (!cartId) fail('book', 'cart id not found');
  const response = await api('GET', `/cart?cartId=${cartId}`);
  const text = JSON.stringify(response.json || {});
  return {
    status: response.json?.status || null,
    expires: response.json?.expirationDate || null,
    offers: [...new Set((text.match(/"offerName":"[^"]*"/g) || []).map((match) => match.slice(13, -1)))],
    wagonsAndSeats: (text.match(/"(wagon|seat)":"[^"]{1,6}"/g) || []).map((match) => match.split(':')[1].replace(/"/g, '')),
  };
}

async function prepareDay(page, api, config, day, rows) {
  await searchDay(page, config, day);
  const [outbound, back] = config.legs;
  const rowOf = (leg) => rows.find((row) => row.day === day && row.leg === leg.id);
  await chooseFreeFare(page, config, outbound, rowOf(outbound));
  await page.getByText(/^\s*(GO TO RETURN JOURNEY|VAI AL RITORNO)\s*$/i).first().click();
  await page.waitForTimeout(5000);
  const refusal = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(not possible to perform|Non è possibile effettuare)[^\n]*/i) || [null])[0]);
  if (refusal) fail('book', `refused at "go to return": ${refusal.trim()} (see SKILL.md §6, entitlement)`);
  await chooseFreeFare(page, config, back, rowOf(back));
  await page.getByRole('button', { name: /^\s*(PURCHASE|ACQUISTA)\s*$/i }).first().click();
  await page.waitForURL(/seatmap/);
  await page.waitForTimeout(4000);
  const outboundSeat = await pickSeat(page, config, outbound, rowOf(outbound));
  await page.getByRole('button', { name: /^\s*(NEXT TRAIN|PROSSIMO TRENO)\s*$/i }).first().click();
  await page.waitForTimeout(4000);
  const returnSeat = await pickSeat(page, config, back, rowOf(back));
  await page.getByRole('button', { name: /^\s*(CONFIRM|CONFERMA)\s*$/i }).first().click();
  await page.waitForURL(/travellers/);
  await page.waitForTimeout(3000);
  await expectFree(page, 'details and payment page');
  const cart = await cartSummary(page, api);
  for (const leg of config.legs) if (!cart.offers.includes(leg.offerName)) fail('book', `cart does not hold ${leg.offerName}: ${cart.offers.join(', ')}`);
  return { day, trains: [rowOf(outbound), rowOf(back)].map((row) => `${row.train} ${row.departure}`), seats: { [outbound.id]: `${outboundSeat.coach}-${outboundSeat.seat} (${outboundSeat.how})`, [back.id]: `${returnSeat.coach}-${returnSeat.seat} (${returnSeat.how})` }, cart };
}

async function commitDay(page, api, config, prepared) {
  await expectFree(page, 'before confirming');
  // --- the page keeps loading extras for some seconds and ignores the tick meanwhile: retry, at most 10 s
  const terms = page.locator('input#check-BASE_DISCLAIMER');
  for (let attempt = 0; attempt < 5 && !(await terms.isChecked()); attempt++) {
    await page.waitForTimeout(2000);
    await terms.check({ force: true, timeout: 3000 }).catch(() => {});
  }
  if (!(await terms.isChecked())) fail('book', 'conditions of carriage box did not tick within 10 s');
  await expectFree(page, 'after ticking the conditions');
  await page.getByRole('button', { name: /^\s*(CONFIRM|CONFERMA)\s*$/i }).first().click();
  const contact = page.locator('.modal.show button:visible').filter({ hasText: /USE THE PURCHASER'S CONTACT INFORMATION|UTILIZZA I DATI DI CONTATTO/i }).first();
  await contact.waitFor({ timeout: 15000 }).then(() => contact.click()).catch(() => {});
  // --- the site works 10-20 s ("Loading..."): at most 45 s
  let success = false;
  for (let attempt = 0; attempt < 15 && !success; attempt++) {
    await page.waitForTimeout(3000);
    success = /thank-you/.test(page.url()) || /Purchase successful|Acquisto effettuato/i.test(await page.evaluate(() => document.body.innerText));
  }
  if (!success) fail('book', `no success page within 45 s (url ${page.url()}); check the trip list before retrying`);
  fs.mkdirSync(runsDirectory, { recursive: true });
  const logFile = path.join(runsDirectory, `${isoDay(new Date())}_bookings.md`);
  fs.appendFileSync(logFile, `- ${new Date().toTimeString().slice(0, 8)} booked ${prepared.day}: ${prepared.trains.join(' + ')}; seats ${JSON.stringify(prepared.seats)}; total 0,00 EUR; PNR pending verification\n`);
  // --- proof from the account, not from the confirmation page; the trip list shows a new booking only after
  //     some seconds: every 5 s, at most 90 s
  let trips = [];
  for (let attempt = 0; attempt < 18 && trips.length < config.legs.length; attempt++) {
    await page.waitForTimeout(5000);
    trips = tripLegs((await accountTrips(api, prepared.day, prepared.day)).items);
  }
  const pnrs = [...new Set(trips.map((trip) => trip.pnr))];
  fs.appendFileSync(logFile, `- ${new Date().toTimeString().slice(0, 8)} verified ${prepared.day} in account trip list: ${trips.length} legs, PNR ${pnrs.join(', ')}\n`);
  if (trips.length !== config.legs.length) fail('book', `${prepared.day}: account shows ${trips.length} legs after booking, expected ${config.legs.length}`);
  return { ...prepared, pnr: pnrs.join(', '), verifiedLegs: trips.length, log: logFile };
}

// --- node commute.mjs book --count=2 [--confirm]: without --confirm every day stops on the payment page
//     (cart left to expire); with --confirm it accepts the conditions of carriage and confirms each day
async function book(config) {
  // --- the days come from the account's gap; --count limits how many, default every such day in the window
  const count = flagValue('count') ? Number(flagValue('count')) : Infinity;
  const confirm = !!flag('confirm');
  result.step = 'browser';
  const { context, page, api } = await openBrowser({ headless: !!flag('headless') });
  result.booked = [];
  try {
    result.step = 'session';
    result.session = await ensureSession(page, api, config);
    if (!result.session.signedIn) fail('session', `not signed in (${result.session.how})`, 2);
    for (let done = 0; done < count; done++) {
      // --- re-read the account before each day: never book a leg that has a PNR
      const days = targetDays(config, isoDay(new Date()));
      const rows = await accountPlan(api, config, days, days[0], true);
      const day = days.find((candidate) => !result.booked.some((entry) => entry.day === candidate)
        && config.legs.every((leg) => rows.find((row) => row.day === candidate && row.leg === leg.id)?.state === 'to-book'));
      if (!day) { result.note = 'no further day with every leg to book'; break; }
      result.step = `book ${day}`;
      const prepared = await prepareDay(page, api, config, day, rows);
      if (!confirm) { result.prepared = prepared; result.note = 'stopped on the payment page (no --confirm); the cart expires by itself'; break; }
      result.booked.push(await commitDay(page, api, config, prepared));
    }
    result.ok = true;
  } catch (error) {
    await evidence(page, (error.step || result.step).replace(/\s+/g, '-'));
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function login(config) {
  result.step = 'browser';
  const { context, page, api } = await openBrowser({ headless: false });
  try {
    result.step = 'session';
    let state = await session(page, api, config);
    if (!state.signedIn) {
      const credential = savedCredential();
      if (credential) state = await signIn(page, api, config, credential);
      // --- waiting for a person only when asked: a sign-in by hand takes 1-2 minutes, so at most 5
      if (!state.signedIn && flag('manual')) {
        await page.goto(`${SITE}#/login`, { waitUntil: 'load' }).catch(() => {});
        process.stderr.write('Sign in in the Chrome window (at most 5 minutes)...\n');
        for (let attempt = 0; attempt < 100 && !state.signedIn; attempt++) { await wait(3000); state = await session(page, api, config).catch(() => state); }
      }
    }
    result.session = state;
    if (!state.signedIn) {
      fail('session', savedCredential() ? 'saved credential did not sign in (see evidence and pageMessage)' : 'no saved credential: run save-credential.ps1, or login --manual', 2);
    }
    result.ok = true;
  } catch (error) {
    await evidence(page, error.step || result.step);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function record(config) {
  result.step = 'browser';
  const mask = masker(config, savedCredential());
  const { context } = await openBrowser({ headless: false });
  fs.mkdirSync(path.join(home, 'recordings'), { recursive: true });
  const file = path.join(home, 'recordings', `${stamp()}.jsonl`);
  let calls = 0;
  context.on('response', async (response) => {
    const url = response.url();
    if (!url.startsWith(API)) return;
    const request = response.request();
    const address = new URL(url);
    let requestBody = null;
    let responseBody = null;
    try { requestBody = request.postData() ? JSON.parse(request.postData()) : null; } catch { requestBody = '(not JSON)'; }
    if (!/\/auth\/login/.test(address.pathname)) {
      try { responseBody = JSON.parse((await response.text()).slice(0, 50000)); } catch { responseBody = '(not JSON or larger than 50 KB)'; }
    }
    let step = null;
    try { step = new URL(request.frame().url()).hash; } catch { /* request without a page frame */ }
    const line = { at: new Date().toISOString(), step, method: request.method(), path: address.pathname.replace(/^.*\/website/, ''),
      query: mask(Object.fromEntries(address.searchParams)), status: response.status(), request: /\/auth\/login/.test(address.pathname) ? '***' : mask(requestBody), response: mask(responseBody) };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    calls++;
  });
  process.stderr.write(`Recording to ${file}. Book one day by hand, then close the Chrome window (limit 30 minutes).\n`);
  await new Promise((resolve) => { context.on('close', resolve); setTimeout(resolve, 30 * 60000).unref(); });
  await context.close().catch(() => {});
  result.recording = file;
  result.calls = calls;
  result.ok = true;
}

async function main() {
  try {
    const config = readConfig();
    if (command === 'status') await status(config);
    else if (command === 'book') await book(config);
    else if (command === 'login') await login(config);
    else if (command === 'record') await record(config);
    else fail('command', `unknown command "${command}" (status | book | login | record)`);
    result.step = 'done';
  } catch (error) {
    result.step = error.step || result.step;
    result.error = String(error.message || error).split('\n')[0].slice(0, 300);
    process.exitCode = error.exitCode || 1;
  }
  result.finishedAt = new Date().toISOString();
  if (command === 'status') {
    fs.mkdirSync(runsDirectory, { recursive: true });
    fs.writeFileSync(path.join(runsDirectory, `${stamp()}_status.json`), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result));
}

main();
