/* 简单的离线缓存：静态资源缓存优先；动态接口/跨域请求不缓存，直接走网络 */
const CACHE = 'energy-tracker-v66';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/util.js',
  './js/importer.js',
  './js/calc.js',
  './js/charts.js',
  './js/app.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var reqUrl = new URL(e.request.url);
  /* 动态接口（Node-RED 同步/备份等）与跨域请求不缓存，直接走网络，避免拿到旧数据 */
  if (reqUrl.origin !== self.location.origin || reqUrl.pathname.indexOf('/api/') === 0) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return hit; });
    })
  );
});
