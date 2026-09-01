// Aggregates GoHighLevel into the compact rollups the Reports page renders.
//
// READ-ONLY. Every call here is a GET; nothing is ever written back to GHL.
//
// Why aggregate server-side: the location holds ~1,400 opportunities. The app
// used to fetch one page of 100 and draw conclusions from it, which quietly
// understated every lead number on the page. Pulling all of it into the browser
// on each load would be slow and burn a function call per device; doing it here
// once and caching for 5 minutes costs one call and returns a few KB.
//
// The 10s function budget is the real constraint, so pages are fetched in
// PARALLEL: page 1 tells us meta.total, and the rest go out at once.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION = '4oujU1ql0szJ60pb1xzk';
const FALLBACK_USER = 'v1rBWcBX8nB2a3RwvpzR';   // used only when the token cannot list users
const PAGE = 100;
const MAX_PAGES = 25;            // 2,500 leads; beyond that we report the cap
const WINDOW_DAYS = 365;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function monthKey(ms) { return new Date(ms).toISOString().slice(0, 7); }
function tally(target, key) { if (key == null || key === '') key = '(none)'; target[key] = (target[key] || 0) + 1; }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const token = process.env.GHL_TOKEN;
  if (!token) {
    return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GHL_TOKEN not configured' }) };
  }
  const H = { Authorization: 'Bearer ' + token, Version: '2021-07-28' };
  const get = async (path, params) => {
    const url = new URL(GHL_BASE + path);
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, String(v)); });
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  };

  const warnings = [];
  try {
    // ---- pipelines: stage ids are meaningless without their names ----
    const pipeRes = await get('/opportunities/pipelines', { locationId: LOCATION }).catch(() => ({ pipelines: [] }));
    const stageName = {}, stagePipeline = {}, pipelineOrder = {};
    (pipeRes.pipelines || []).forEach(p => {
      pipelineOrder[p.name] = (p.stages || []).map(s => s.name);
      (p.stages || []).forEach(s => { stageName[s.id] = s.name; stagePipeline[s.id] = p.name; });
    });

    // ---- opportunities: page 1 first for the total, then the rest at once ----
    const first = await get('/opportunities/search', { location_id: LOCATION, limit: PAGE, page: 1 });
    const total = (first.meta && first.meta.total) || (first.opportunities || []).length;
    const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES);
    if (Math.ceil(total / PAGE) > MAX_PAGES) warnings.push(`Only the newest ${MAX_PAGES * PAGE} of ${total} leads were read.`);

    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
        get('/opportunities/search', { location_id: LOCATION, limit: PAGE, page: i + 2 })
          .then(r => r.opportunities || [])
          .catch(() => []))
    );
    const opps = (first.opportunities || []).concat(...rest);

    // ---- lead rollups ----
    const byStatus = {}, bySource = {}, byStageCount = {}, byStageValue = {}, byMonth = {};
    const valueByStatus = { open: 0, won: 0, lost: 0, abandoned: 0 };
    const sourceStats = {};   // source -> { leads, booked, won, value }
    // A stage whose name implies the lead turned into real work. Status alone is
    // useless here: nearly everything sits at "open" because the crew moves cards
    // between stages rather than closing them.
    const BOOKED = /booked|appointment|new booking|visit attended|sale|vip member|springfield/i;

    opps.forEach(o => {
      const st = (o.status || 'open').toLowerCase();
      tally(byStatus, st);
      const src = o.source || '(none)';
      tally(bySource, src);
      const value = Number(o.monetaryValue) || 0;
      if (valueByStatus[st] != null) valueByStatus[st] += value;

      const sName = stageName[o.pipelineStageId] || '(unknown stage)';
      const key = (stagePipeline[o.pipelineStageId] || '?') + ' · ' + sName;
      byStageCount[key] = (byStageCount[key] || 0) + 1;
      byStageValue[key] = (byStageValue[key] || 0) + value;

      const created = Date.parse(o.createdAt || o.dateAdded || '') || 0;
      if (created) {
        const mk = monthKey(created);
        byMonth[mk] = byMonth[mk] || { month: mk, leads: 0, value: 0, booked: 0 };
        byMonth[mk].leads++; byMonth[mk].value += value;
        if (BOOKED.test(sName)) byMonth[mk].booked++;
      }

      const s = sourceStats[src] || (sourceStats[src] = { source: src, leads: 0, booked: 0, won: 0, value: 0 });
      s.leads++; s.value += value;
      if (BOOKED.test(sName)) s.booked++;
      if (st === 'won') s.won++;
    });

    // ---- appointments across EVERY user, not just one ----
    // The app used to pass a single userId, so any job assigned to another tech
    // or the second van never appeared anywhere in the Command Center.
    let appts = [], users = [];
    try {
      const u = await get('/users/', { locationId: LOCATION });
      users = (u.users || []).map(x => ({ id: x.id, name: x.name || x.firstName || 'User' }));
    } catch (e) {
      // The token has no users.readonly scope, so the tech list is unavailable.
      // Fall back to every calendar plus the one known user id — less complete
      // than per-user, but far better than the single calendar we had before.
      warnings.push('The GoHighLevel token cannot list users (needs the users.readonly scope), '
        + 'so appointments are grouped by calendar instead of by tech.');
    }

    const now = Date.now();
    const start = now - WINDOW_DAYS * 86400000, end = now + 90 * 86400000;
    const seen = {};
    const absorb = (list, label) => list.forEach(e => {
      if (e && e.id && !seen[e.id]) { seen[e.id] = 1; appts.push({ ...e, _user: label }); }
    });

    if (users.length) {
      const perUser = await Promise.all(users.map(u =>
        get('/calendars/events', { locationId: LOCATION, userId: u.id, startTime: start, endTime: end })
          .then(r => ({ name: u.name, events: r.events || [] })).catch(() => ({ name: u.name, events: [] }))));
      // The same appointment comes back under each user assigned to it.
      perUser.forEach(p => absorb(p.events, p.name));
    } else {
      const calRes = await get('/calendars/', { locationId: LOCATION }).catch(() => ({ calendars: [] }));
      const cals = (calRes.calendars || []).filter(c => c.id);
      const perCal = await Promise.all(cals.map(c =>
        get('/calendars/events', { locationId: LOCATION, calendarId: c.id, startTime: start, endTime: end })
          .then(r => ({ name: c.name || 'Calendar', events: r.events || [] }))
          .catch(() => ({ name: c.name || 'Calendar', events: [] }))));
      perCal.forEach(p => absorb(p.events, p.name));
      const mine = await get('/calendars/events', { locationId: LOCATION, userId: FALLBACK_USER, startTime: start, endTime: end })
        .then(r => r.events || []).catch(() => []);
      absorb(mine, 'Unassigned / other');
    }

    const apptStatus = {}, apptMonth = {}, apptUser = {};
    let upcoming = 0;
    appts.forEach(a => {
      const raw = (a.appointmentStatus || '').toLowerCase();
      const st = /cancel/.test(raw) ? 'cancelled' : /noshow|no-show/.test(raw) ? 'no-show'
        : /showed|complete/.test(raw) ? 'showed' : /confirm/.test(raw) ? 'confirmed' : (raw || 'other');
      tally(apptStatus, st);
      tally(apptUser, a._user);
      const t = Date.parse(a.startTime || '') || 0;
      if (t) { const mk = monthKey(t); apptMonth[mk] = (apptMonth[mk] || 0) + 1; if (t > now) upcoming++; }
    });

    const sortedMonths = Object.keys(byMonth).sort().slice(-13).map(k => byMonth[k]);
    const stageRows = Object.keys(byStageCount)
      .map(k => ({ stage: k, count: byStageCount[k], value: Math.round(byStageValue[k]) }))
      .sort((a, b) => b.count - a.count);
    const sourceRows = Object.values(sourceStats)
      .map(s => ({ ...s, value: Math.round(s.value), bookedRate: s.leads ? s.booked / s.leads : 0 }))
      .sort((a, b) => b.leads - a.leads);

    const booked = opps.filter(o => BOOKED.test(stageName[o.pipelineStageId] || '')).length;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        builtAt: Date.now(),
        readOnly: true,
        leads: {
          total, read: opps.length, byStatus, bySource, valueByStatus,
          byStage: stageRows, byMonth: sortedMonths, booked,
          bookedRate: opps.length ? booked / opps.length : 0,
        },
        sources: sourceRows,
        pipelines: pipelineOrder,
        appointments: {
          total: appts.length, byStatus: apptStatus, byUser: apptUser,
          byMonth: Object.keys(apptMonth).sort().slice(-13).map(k => ({ month: k, count: apptMonth[k] })),
          upcoming, users: users.length,
        },
        warnings,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, warnings }),
    };
  }
};
