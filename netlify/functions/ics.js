// Proxies the Brightspace calendar feed.
//
// Brightspace sends no Access-Control-Allow-Origin, so the hosted dashboard
// cannot read the .ics directly from the browser. This fetches it server-side.
// Locally the same job is done by serve.ps1 at /api/ics.
//
// Locked to the Brightspace host so this cannot be used as an open proxy.

const ALLOWED = /^https:\/\/brightspace\.missouristate\.edu\//;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const url = (event.queryStringParameters || {}).url;
  if (!url) {
    return { statusCode: 400, headers: cors, body: 'missing url parameter' };
  }
  if (!ALLOWED.test(url)) {
    return { statusCode: 403, headers: cors, body: 'only brightspace.missouristate.edu is proxied' };
  }

  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) {
      return { statusCode: 502, headers: cors, body: `brightspace returned ${r.status}` };
    }
    const text = await r.text();
    // A wrong or expired token yields a login page rather than an error status.
    if (!text.includes('BEGIN:VCALENDAR')) {
      return {
        statusCode: 502,
        headers: cors,
        body: 'that URL did not return a calendar — the feed token is probably stale. Re-copy it from Brightspace: Calendar > Subscribe.',
      };
    }
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' },
      body: text,
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: `fetch failed: ${e.message}` };
  }
};
