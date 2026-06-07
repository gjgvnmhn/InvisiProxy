(() => {
  const swRoutes = ['{{route}}{{/sw.js}}', '{{route}}{{/sw-blacklist.js}}'],
    swScope = '{{route}}{{/}}',
    swAllowedHostnames = ['localhost', '127.0.0.1'],
    defaultWispUrl =
      (location.protocol === 'https:' ? 'wss' : 'ws') +
      '://' +
      location.host +
      '{{route}}{{/wisp/}}',
    resolveWispUrl = (custom) => {
      if (!custom || typeof custom !== 'string') return defaultWispUrl;
      const trimmed = custom.trim();
      if (!trimmed) return defaultWispUrl;
      try {
        if (/^wss?:\/\//i.test(trimmed)) return new URL(trimmed).href;
        if (trimmed.startsWith('//')) {
          return (
            (location.protocol === 'https:' ? 'wss:' : 'ws:') + trimmed
          );
        }
        if (trimmed.startsWith('/')) {
          return (
            (location.protocol === 'https:' ? 'wss' : 'ws') +
            '://' +
            location.host +
            trimmed +
            (trimmed.endsWith('/') ? '' : '/')
          );
        }
        return (
          (location.protocol === 'https:' ? 'wss' : 'ws') +
          '://' +
          trimmed.replace(/\/+$/, '') +
          '/wisp/'
        );
      } catch (e) {
        return defaultWispUrl;
      }
    },
    getWispUrl = () => resolveWispUrl(readStorage('WispUrl')),
    proxyUrl = {
      tor: 'socks5h://localhost:9050',
      eu: 'socks5h://localhost:7000',
      jp: 'socks5h://localhost:7001',
    },
    transports = {
      '{{epoxy}}': '{{route}}{{/epoxy/index.mjs}}',
      '{{libcurl}}': '{{route}}{{/libcurl/index.mjs}}',
    },
    storageId = '{{hu-lts}}-storage',
    storageObject = () => JSON.parse(localStorage.getItem(storageId)) || {},
    readStorage = (name) => storageObject()[name],
    defaultMode = '{{epoxy}}';

  transports.default = transports[defaultMode];
  Object.freeze(transports);

  const getTransportSelection = () => {
    const url = transports[readStorage('Transport')] || transports.default;
    const options = { wisp: getWispUrl() };
    if ('string' === typeof readStorage('UseSocks5'))
      options.proxy = proxyUrl[readStorage('UseSocks5')];
    return { url, options };
  };

  const registerCombinedSW = async () => {
    if (!navigator.serviceWorker) {
      if (
        location.protocol !== 'https:' &&
        !swAllowedHostnames.includes(location.hostname)
      )
        throw new Error('Service workers cannot be registered without https.');
      throw new Error("Your browser doesn't support service workers.");
    }

    const sw = swRoutes[readStorage('HideAds') !== false ? 1 : 0];
    const path = new URL(sw, location.origin).pathname;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const active = registration.active;
      if (!active) continue;
      if (new URL(active.scriptURL).pathname !== path)
        await registration.unregister();
    }

    console.log('Registering combined service worker:', sw);
    const registration = await navigator.serviceWorker.register(sw, {
      scope: swScope,
    });

    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const onChange = () => {
          navigator.serviceWorker.removeEventListener(
            'controllerchange',
            onChange
          );
          resolve();
        };
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          onChange,
          { once: true }
        );
        setTimeout(resolve, 5000);
      });
    }

    return registration;
  };

  const buildScramjetTransport = async () => {
    const { url, options } = getTransportSelection();
    const mod = await import(url);
    const TransportClient = mod.default;
    return new TransportClient(options);
  };

  const initialize = async () => {
    try {
      if (window.$invisiScramjet?.ready) {
        const existing = window.$invisiScramjet;
        const visibleFrame = document.getElementById('frame');
        if (
          visibleFrame instanceof HTMLIFrameElement &&
          existing.frame?.element !== visibleFrame
        ) {
          existing.frame = existing.controller.createFrame(visibleFrame);
        }
        window.dispatchEvent(new Event('s-ready'));
        return;
      }

      const { url: transportUrl, options: transportOptions } =
        getTransportSelection();
      console.log('Using proxy:', transportOptions.proxy);
      console.log('Transport mode:', transportUrl);
      const baremux = new BareMux.BareMuxConnection(
        '{{route}}{{/baremux/worker.js}}'
      );
      await baremux.setTransport(transportUrl, [transportOptions]);

      const registration = await registerCombinedSW();

      const serviceworker =
        navigator.serviceWorker.controller ?? registration.active;
      if (!serviceworker)
        throw new Error('No service worker available for Scramjet controller');

      const { Controller } = $scramjetController;
      const { defaultConfig } = $scramjet;
      const transport = await buildScramjetTransport();
      const controller = new Controller({
        serviceworker,
        transport,
        config: {
          prefix: '{{route}}{{/scram/network/}}',
          scramjetPath: '{{route}}{{/scram/scramjet.js}}',
          wasmPath: '{{route}}{{/scram/scramjet.wasm}}',
          injectPath: '{{route}}{{/scram/controller.inject.js}}',
        },
        scramjetConfig: {
          ...defaultConfig,
          flags: {
            ...defaultConfig.flags,
            allowFailedIntercepts: true,
            allowInvalidJs: true,
          },
        },
      });

      await controller.wait();
      console.log('Scramjet controller initialized');

      const visibleFrame = document.getElementById('frame');
      let frame;
      if (visibleFrame instanceof HTMLIFrameElement) {
        frame = controller.createFrame(visibleFrame);
      } else {
        const hidden = document.createElement('iframe');
        hidden.setAttribute('aria-hidden', 'true');
        hidden.tabIndex = -1;
        hidden.style.cssText =
          'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
        document.body.appendChild(hidden);
        frame = controller.createFrame(hidden);
      }

      window.$invisiScramjet = { controller, frame, ready: true };
      window.dispatchEvent(new Event('s-ready'));
    } catch (err) {
      console.error('Initialization failed:', err);
    }
  };

  initialize();
})();
