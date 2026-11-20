// HOT-Step v1.5.2 has root-relative navigation. Keep it inside the portal mount.
(() => {
  const base = '/manage/music';
  const mounted = location.pathname.startsWith(base + '/');
  if (!mounted) return;
  const rewrite = value => typeof value === 'string' && value.startsWith('/') &&
    !value.startsWith('//') && !value.startsWith(base + '/') ? base + value : value;
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function(state, title, url) {
      return original.call(this, state, title, rewrite(url));
    };
  }
  const fetchOriginal = window.fetch;
  window.fetch = function(resource, options) {
    return fetchOriginal.call(this, rewrite(resource), options);
  };
  const openOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return openOriginal.call(this, method, rewrite(url), ...rest);
  };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor) anchor.setAttribute('href', rewrite(anchor.getAttribute('href')));
  }, true);
})();
