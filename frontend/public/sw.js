const CACHE = "nodedesk-v1"

self.addEventListener("install", (e) => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        "/",
        "/index.html",
        "/manifest.json",
        "/icon-192.svg",
        "/icon-512.svg",
        "/favicon.svg",
      ])
    )
  )
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
})

self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/index.html"))
    )
    return
  }
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  )
})
