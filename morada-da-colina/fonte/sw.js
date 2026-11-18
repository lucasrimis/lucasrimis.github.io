// Morada da Colina: abre mesmo sem internet depois da primeira visita (modo sozinho).
const CACHE = "morada-v20261118202603";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // arquivo de versão: sempre da internet (o jogo usa para saber se há atualização)
  if (url.origin === self.location.origin && url.pathname.endsWith("/version.json")) return;
  // página do jogo: internet primeiro, sem cache do navegador, para receber atualizações
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req, { cache: "no-store" }).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  // fontes do Google: guarda na primeira vez
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  // ícones e manifesto: cópia guardada primeiro
  if (url.origin === self.location.origin) e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
