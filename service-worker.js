const CACHE_NAME = "savings-tracker-v3";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./store.js",
  "./lucide.min.js",
  "./chart.min.js",
  "./Outfit-ExtraBold.woff2",
  "./Outfit-Bold.woff2",
  "./Outfit-Regular.woff2",
  "./Outfit-SemiBold.woff2"
];

// Install: cache files
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch: serve offline
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});