self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('ler-store').then((cache) => {
      return cache.addAll([
        './',
        './LocalEpubReader.html',
        './ler.css',
        './ler-dark.css',
        './ler.js',
        './jszip.min.js',
        './epub.min.js',
        './LER.svg',
        './manifest.json',
        './sw.js'
      ]);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
