importScripts('{{route}}{{/assets/js/workerware.js}}');
importScripts('{{route}}{{/assets/js/ubo-middleware.js}}');
importScripts('{{route}}{{/scram/controller.sw.js}}');
importScripts('{{route}}{{/uv/uv.bundle.js}}');
importScripts('{{route}}{{/uv/uv.config.js}}');
importScripts(self['{{__uv$config}}'].sw || '{{route}}{{/uv/uv.sw.js}}');

const uv = new UVServiceWorker();
self.__invisi_uv = uv;

const ww = new self.WorkerWare({
  debug: false,
  timing: false,
});

ww.use({
  function: self.invisiUbo.fetchMiddleware,
  name: 'ubo-network',
  events: ['fetch'],
});

const proxyRouter = async (event) => {
  if ($scramjetController.shouldRoute(event)) {
    return $scramjetController.route(event);
  }
  if (uv.route(event)) {
    return await uv.fetch(event);
  }
  return fetch(event.request);
};
ww.use({
  function: proxyRouter,
  name: 'proxy-router',
  events: ['fetch'],
});

ww.use({
  function: self.invisiUbo.messageMiddleware,
  name: 'ubo-cosmetic',
  events: ['message'],
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const result = await ww.run(event)();
      if (result instanceof Response) return result;
      if (Array.isArray(result)) {
        for (let i = result.length - 1; i >= 0; i--) {
          if (result[i] instanceof Response) return result[i];
        }
      }
      return fetch(event.request);
    })()
  );
});

self.addEventListener('message', (event) => {
  ww.run(event)().catch((err) =>
    console.error('message middleware failed:', err)
  );
});
