// sw.js Service Worker（F09 オフライン動作）
// ファイルを更新した時は CACHE_NAME の版数を上げる（v1 → v2）。
'use strict';

const CACHE_NAME = 'kaikei-smooth-v28';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/util.js',
  './js/storage.js',
  './js/presets.js',
  './js/points.js',
  './js/home.js',
  './js/apps.js',
  './js/shops.js',
  './js/genres.js',
  './js/sync.js',
  './js/icon-choices.js',
  './js/icon.js',
  './js/app.js',
  './scheme-test.html',
  './js/scheme-test.js',
  './icons/choices/icon-02-192.png',
  './icons/choices/icon-02-512.png',
  './icons/choices/icon-02-180.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('kaikei-smooth-v') && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュにあればそれを返し、なければ通信で取得する
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request))
  );
});
