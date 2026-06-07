(function () {
  const SJ_CONTROLLER_PREFIX = '{{route}}{{/scram/network/}}';
  const BLOCKLIST_URL = '{{route}}{{/assets/txt/blacklist.txt}}';
  const EXTRA_RULES_URL = '{{route}}{{/assets/txt/ubo-rules.txt}}';

  const domainExact = new Set();
  const tldBuckets = Object.create(null);
  const urlSubstrings = [];
  const cosmeticFilters = Object.create(null);
  let isReady = false;
  const readyWaiters = [];

  const sigDomain = /^[a-z0-9.\-]+\.[a-z]{2,}$/i;

  const addDomain = (domain) => {
    if (!domain) return;
    domain = domain.toLowerCase();
    if (!sigDomain.test(domain)) return;
    domainExact.add(domain);
    const tld = domain.replace(/.+(?=\.\w)/, '');
    if (!tldBuckets[tld]) tldBuckets[tld] = new Set();
    tldBuckets[tld].add(domain);
  };
  const isBlockedHost = (host) => {
    if (!host) return false;
    host = host.toLowerCase();
    if (domainExact.has(host)) return true;
    let idx = host.indexOf('.');
    while (idx !== -1) {
      const parent = host.slice(idx + 1);
      if (domainExact.has(parent)) return true;
      idx = host.indexOf('.', idx + 1);
    }
    return false;
  };

  const isBlockedUrl = (url) => {
    if (!url) return false;
    for (let i = 0; i < urlSubstrings.length; i++) {
      if (url.indexOf(urlSubstrings[i]) !== -1) return true;
    }
    return false;
  };
  const parseRules = (text) => {
    const lines = text.split('\n');
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line[0] === '!' || line[0] === '[') continue;
      const cosmeticIdx = line.indexOf('##');
      if (cosmeticIdx !== -1) {
        const domains = line.slice(0, cosmeticIdx);
        const selector = line.slice(cosmeticIdx + 2).trim();
        if (!selector) continue;
        if (!domains) {
          if (!cosmeticFilters['*']) cosmeticFilters['*'] = [];
          cosmeticFilters['*'].push(selector);
        } else {
          for (const d of domains.split(',')) {
            const dd = d.trim().toLowerCase();
            if (!dd) continue;
            if (!cosmeticFilters[dd]) cosmeticFilters[dd] = [];
            cosmeticFilters[dd].push(selector);
          }
        }
        continue;
      }
      if (line.startsWith('||')) {
        let body = line.slice(2);
        const dollar = body.indexOf('$');
        if (dollar !== -1) body = body.slice(0, dollar);
        body = body.replace(/[\^\/].*$/, '');
        addDomain(body);
        continue;
      }
      if (line.length > 4 && !line.includes(' ')) {
        urlSubstrings.push(line);
      }
    }
  };

  const parseBlocklist = (text) => {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      let d = line;
      if (d.startsWith('||')) d = d.slice(2);
      d = d.replace(/[\^\/].*$/, '');
      addDomain(d);
    }
  };

  const extractScramjetHostname = (reqUrl) => {
    try {
      const u = new URL(reqUrl);
      if (!u.pathname.startsWith(SJ_CONTROLLER_PREFIX)) return null;
      const rest = u.pathname.slice(SJ_CONTROLLER_PREFIX.length).split('/');
      if (rest.length < 3) return null;
      const encoded = rest.slice(2).join('/');
      if (!encoded) return null;
      return new URL(decodeURIComponent(encoded)).hostname;
    } catch (e) {
      return null;
    }
  };

  const extractUvHostname = (reqUrl, uv) => {
    try {
      if (!uv || !uv.config || typeof uv.config.decodeUrl !== 'function')
        return null;
      const u = new URL(reqUrl);
      const prefix = uv.config.prefix;
      if (!prefix || !u.pathname.startsWith(prefix)) return null;
      return new URL(uv.config.decodeUrl(u.pathname.slice(prefix.length)))
        .hostname;
    } catch (e) {
      return null;
    }
  };

  const fetchMiddleware = (event) => {
    if (!isReady) return;
    const url = event.request.url;
    const sjHost = extractScramjetHostname(url);
    if (sjHost) {
      if (isBlockedHost(sjHost) || isBlockedUrl(url))
        return new Response(new Blob(), { status: 403, statusText: 'Blocked' });
      return;
    }
    const uv = self.__invisi_uv;
    const uvHost = extractUvHostname(url, uv);
    if (uvHost) {
      if (isBlockedHost(uvHost) || isBlockedUrl(url))
        return new Response(new Blob(), { status: 403, statusText: 'Blocked' });
      return;
    }
  };

  const messageMiddleware = (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type !== 'invisi-ubo-cosmetic') return;
    const host = (event.data.host || '').toLowerCase();
    const selectors = [];
    if (cosmeticFilters['*']) selectors.push(...cosmeticFilters['*']);
    if (cosmeticFilters[host]) selectors.push(...cosmeticFilters[host]);
    if (host) {
      let idx = host.indexOf('.');
      while (idx !== -1) {
        const parent = host.slice(idx + 1);
        if (cosmeticFilters[parent])
          selectors.push(...cosmeticFilters[parent]);
        idx = host.indexOf('.', idx + 1);
      }
    }
    if (event.source && typeof event.source.postMessage === 'function') {
      event.source.postMessage({
        type: 'invisi-ubo-cosmetic-reply',
        id: event.data.id,
        selectors,
      });
    } else if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'invisi-ubo-cosmetic-reply',
        id: event.data.id,
        selectors,
      });
    }
  };

  const load = async () => {
    try {
      const [blRes, ruleRes] = await Promise.all([
        fetch(BLOCKLIST_URL).then((r) => (r.ok ? r.text() : '')),
        fetch(EXTRA_RULES_URL).then((r) => (r.ok ? r.text() : '')),
      ]);
      if (blRes) parseBlocklist(blRes);
      if (ruleRes) parseRules(ruleRes);
    } catch (e) {
      console.warn('filter load failed:', e);
    } finally {
      isReady = true;
      readyWaiters.splice(0).forEach((fn) => fn());
    }
  };

  const ready = () =>
    isReady ? Promise.resolve() : new Promise((r) => readyWaiters.push(r));
  load();
  self.invisiUbo = Object.freeze({
    fetchMiddleware,
    messageMiddleware,
    ready,
    isBlockedHost,
    isBlockedUrl,
    cosmeticFilters,
  });
})();
