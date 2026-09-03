/* Offline shell for the school dashboard.
 *
 * He studies away from home. Hotel wifi that resolves DNS but stalls on
 * fetches is worse than no wifi: the page half-loads and React never boots.
 * Cache the shell and the CDN libraries so the app always starts, then let
 * Supabase fail loudly on its own (the UI already shows a red banner).
 */
const CACHE = 'ultramind-school-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/react@18.2.0/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.23.4/babel.min.js',
  'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  'https://unpkg.com/@supabase/supabase-js@2',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Don't let one unreachable CDN file abort the whole install.
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { mode: 'no-cors' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the database or the calendar proxy — stale study data is
  // worse than an honest failure, and the app reports sync state itself.
  if (url.hostname.endsWith('supabase.co') || url.pathname.includes('/.netlify/functions/')) return;

  // App shell: network first so a deploy lands immediately, cache as backup.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match(req);
        return hit || caches.match('./index.html');
      }
    })());
    return;
  }

  // Pinned CDN libraries never change at their versioned URL: cache first.
  if (url.hostname === 'unpkg.com') {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return new Response('/* offline and not cached */', { headers: { 'Content-Type': 'application/javascript' } });
      }
    })());
  }
});
