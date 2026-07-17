// Service Worker básico para evitar errores de registro
const CACHE_NAME = 'linea4-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activado');
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Simplemente deja pasar todas las peticiones a internet
  event.respondWith(fetch(event.request));
});