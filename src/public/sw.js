/* Service Worker — acelera a navegação guardando os arquivos estáticos
 * (CSS, JS, imagens, fontes) do próprio site no cache do navegador.
 *
 * Regras de segurança:
 *  - Só intercepta GET da MESMA origem. CDNs (fontes, Font Awesome, Analytics,
 *    Pixel) seguem direto pela rede, com o cache HTTP normal deles.
 *  - NUNCA guarda HTML: as páginas têm sessão, token CSRF e dados pessoais.
 *    Para elas usamos só o "navigation preload", que adianta o download.
 *  - /uploads e /admin ficam de fora (podem conter documentos de alunos).
 *
 * Ao alterar CSS/JS em produção, a estratégia stale-while-revalidate já
 * busca a versão nova em segundo plano. Para forçar limpeza total, suba a
 * VERSAO abaixo.
 */
const VERSAO = 'v1';
const CACHE_ESTATICO = 'cvb-estatico-' + VERSAO;

// Arquivos usados em quase toda página: baixados já na instalação.
const PRECACHE = [
  '/style.css',
  '/site-extra.css',
  '/inscrever.css',
  '/auth.css',
  '/js/main.js',
  '/img/logo-cvb-rj.webp',
];

const EXT_ESTATICA = /\.(?:css|js|webp|png|jpe?g|gif|svg|ico|woff2?|ttf)$/i;
const PREFIXOS_IGNORADOS = ['/uploads/', '/admin', '/sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      // addAll falha inteiro se um arquivo faltar; por isso um a um.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter((n) => n.startsWith('cvb-') && n !== CACHE_ESTATICO)
          .map((n) => caches.delete(n))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

function ehEstatico(url) {
  if (url.origin !== self.location.origin) return false;
  if (PREFIXOS_IGNORADOS.some((p) => url.pathname.startsWith(p))) return false;
  return EXT_ESTATICA.test(url.pathname);
}

// Responde na hora com o cache e atualiza em segundo plano.
async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE_ESTATICO);
  const emCache = await cache.match(event.request);
  const daRede = fetch(event.request)
    .then((resp) => {
      if (resp && resp.ok && resp.type === 'basic') {
        cache.put(event.request, resp.clone());
      }
      return resp;
    })
    .catch(() => emCache);

  if (emCache) {
    event.waitUntil(daRede);
    return emCache;
  }
  return daRede;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Páginas: sempre da rede (nada de HTML em cache), aproveitando o preload.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const preload = await event.preloadResponse;
        return preload || fetch(req);
      })()
    );
    return;
  }

  const url = new URL(req.url);
  if (ehEstatico(url)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
