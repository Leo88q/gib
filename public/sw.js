/* eslint-disable no-restricted-globals */
/**
 * Service Worker статики «Города историй» (gib-static-v2).
 *
 * Правило приватности детей (152-ФЗ):
 *  - Кешируются ТОЛЬКО неизменяемые публичные ресурсы оформления:
 *    шрифты `/fonts/*`, 3D-иллюстрации `/art/v2/*`, пиктограммы `/openmoji/*`
 *    и иммутабельные бандлы `/_next/static/*`.
 *  - Запросы к `/api/*`, HTML-документы с сессионными куками и любые
 *    пользовательские ответы НИКОГДА не сохраняются в Cache Storage.
 */
const CACHE_NAME = 'gib-static-v2';
const PRECACHE_URLS = [
  '/fonts/opendyslexic-regular.woff2',
  '/fonts/opendyslexic-bold.woff2',
  '/art/v2/creatures/lis-face.png',
  '/art/v2/creatures/mira-face.png',
  '/art/v2/creatures/tima-face.png',
  '/art/v2/creatures/pet.png',
  '/art/v2/creatures/pet-teen.png',
  '/art/v2/creatures/pet-adult.png',
  '/art/v2/places/home.png',
  '/art/v2/places/map.png',
];

function isCacheableStaticPath(pathname) {
  if (pathname.startsWith('/api/')) return false;
  return (
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/art/v2/') ||
    pathname.startsWith('/openmoji/') ||
    pathname.startsWith('/_next/static/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!isCacheableStaticPath(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkPromise;
    }),
  );
});
