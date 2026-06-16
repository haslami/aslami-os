// Server-side proxy for Google Sheets API. Keeps the API key out of the browser.
// The key lives in SHEETS_API_KEY (set in Netlify site settings).
// The spreadsheet must be shared as "Anyone with the link can view".

const SHEET_ID = '1U6qTSLvgDeLDBgjcCT9-FV3ZmyBiX_2izmJTh3CRdu8';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function parseMoney(s) {
  if (!s || typeof s !== 'string') return 0;
  const n = parseFloat(s.replace(/[$,\s%]/g, '').replace(/[−–]/g, '-'));
  return isNaN(n) ? 0 : n;
}

// Search all cells in row for "gross income" text, then return the next dollar value found
function findGrossIncome(rows) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && row[i].toLowerCase().includes('gross income')) {
        for (let j = i + 1; j < row.length; j++) {
          const v = parseMoney(String(row[j] || ''));
          if (v > 0) return v;
        }
      }
    }
  }
  return 0;
}

// Find first occurrence of a label and return the value in the next non-empty cell
function findValue(rows, label) {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (typeof row[i] === 'string' && row[i].toLowerCase().includes(label.toLowerCase())) {
        for (let j = i + 1; j < row.length; j++) {
          const v = parseMoney(String(row[j] || ''));
          if (v !== 0) return v;
        }
      }
    }
  }
  return 0;
}

// Parse "Mar9-Mar22" or "Jan-Mar9" → { start: "2026-03-09", end: "2026-03-22" }
const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function parsePeriodDates(label) {
  const m = label.trim().match(/^([A-Za-z]+)(\d*)[–\-]([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const [, sm, sd, em, ed] = m;
  const smon = MON[sm.toLowerCase()]; const emon = MON[em.toLowerCase()];
  if (!smon || !emon) return null;
  const startDay = sd ? parseInt(sd) : 1;
  const endDay = parseInt(ed);
  const sYear = 2026;
  const eYear = emon < smon ? 2027 : 2026;
  return {
    start: `${sYear}-${String(smon).padStart(2,'0')}-${String(startDay).padStart(2,'0')}`,
    end: `${eYear}-${String(emon).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`
  };
}

// Prorate gross income across calendar months by day count
function prorateToMonths(gross, startISO, endISO) {
  const result = {};
  const s = new Date(startISO + 'T12:00:00Z');
  const e = new Date(endISO + 'T12:00:00Z');
  const totalDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
  let cur = new Date(s);
  while (cur <= e) {
    const key = cur.toISOString().slice(0, 7);
    result[key] = (result[key] || 0) + (gross / totalDays);
    cur = new Date(cur.getTime() + 86400000);
  }
  return result;
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const apiKey = process.env.SHEETS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SHEETS_API_KEY not configured' })
    };
  }

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

  try {
    // 1. Get all tab names
    const metaRes = await fetch(`${base}?fields=sheets.properties&key=${apiKey}`);
    if (!metaRes.ok) {
      const text = await metaRes.text();
      throw new Error(`Sheets API ${metaRes.status}: ${text.slice(0, 200)}`);
    }
    const { sheets } = await metaRes.json();

    // 2. Read "Total Overview 2026" tab for year totals
    const overviewTab = sheets.find(s => /overview|total overview/i.test(s.properties.title));
    let yearGross = 0, yearExpenses = 0, yearNet = 0;
    if (overviewTab) {
      const r = await fetch(`${base}/values/${encodeURIComponent(overviewTab.properties.title)}!A:F?key=${apiKey}`);
      const { values = [] } = await r.json();
      yearGross = findValue(values, 'total gross income');
      yearExpenses = findValue(values, 'total expenses');
      yearNet = findValue(values, 'net income');
    }

    // 3. Read each pay-period tab (pattern: "Mar9-Mar22", "Apr6-Apr19", "Jan-Mar9")
    const periodTabs = sheets.filter(s => /^[A-Za-z]+\d*[–\-][A-Za-z]+\d+$/.test(s.properties.title.trim()));

    const payPeriods = [];
    for (const tab of periodTabs) {
      const name = tab.properties.title;
      const r = await fetch(`${base}/values/${encodeURIComponent(name)}!A:J?key=${apiKey}`);
      const { values = [] } = await r.json();
      const gross = findGrossIncome(values);
      const dates = parsePeriodDates(name);

      // Also extract expenses and net for each period
      const expenses = findValue(values, 'total expenses');
      const net = findValue(values, 'net income');

      payPeriods.push({
        label: name,
        gross,
        expenses,
        net,
        start: dates?.start || null,
        end: dates?.end || null
      });
    }
    payPeriods.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    // If overview tab didn't yield a yearGross, sum pay periods
    if (!yearGross && payPeriods.length) {
      yearGross = Math.round(payPeriods.reduce((s, p) => s + p.gross, 0));
    }

    // 4. Monthly aggregation (prorate pay period income by day across calendar months)
    const monthMap = {};
    for (const p of payPeriods) {
      if (!p.start || !p.end || !p.gross) continue;
      const dist = prorateToMonths(p.gross, p.start, p.end);
      for (const [k, v] of Object.entries(dist)) {
        monthMap[k] = (monthMap[k] || 0) + v;
      }
    }
    const monthly = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, gross]) => ({
        month: MONTH_NAMES[parseInt(key.split('-')[1]) - 1],
        monthKey: key,
        gross: Math.round(gross)
      }));

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ yearGross: Math.round(yearGross), yearExpenses: Math.round(yearExpenses), yearNet: Math.round(yearNet), payPeriods, monthly })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
