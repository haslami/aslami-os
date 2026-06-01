// Server-side proxy for GoHighLevel. Keeps the API token out of the browser.
// The token lives in the GHL_TOKEN environment variable (set in Netlify site settings).
const GHL_BASE = 'https://services.leadconnectorhq.com';

// Only these read-only endpoints may be proxied — prevents use as an open proxy.
const ALLOWED = [
  '/calendars/events',
  '/calendars/',
  '/opportunities/search',
  '/opportunities/pipelines',
  '/contacts/',
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const params = event.queryStringParameters || {};
  const ghlpath = params.ghlpath || '';

  if (!ALLOWED.some((p) => ghlpath === p || ghlpath.startsWith(p))) {
    return { statusCode: 400, body: 'Path not allowed' };
  }

  const token = process.env.GHL_TOKEN;
  if (!token) {
    return { statusCode: 500, body: 'GHL_TOKEN not configured' };
  }

  const url = new URL(GHL_BASE + ghlpath);
  Object.entries(params).forEach(([k, v]) => {
    if (k !== 'ghlpath' && v != null) url.searchParams.set(k, String(v));
  });

  try {
    const r = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28' },
    });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: text,
    };
  } catch (e) {
    return { statusCode: 502, body: 'Upstream error' };
  }
};
