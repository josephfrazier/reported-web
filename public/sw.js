// Derived from https://github.com/pwa-builder/serviceworkers/blob/5b9128ec9232556171f0969bc2aa9c6039054ed6/serviceWorker1/pwabuilder-sw.js

const offlineBody = `
  <h1>
    <a href="javascript:window.location.reload()">
      You need to be online to use Reported.
      <br/>
      Click here to retry.
    </a>
  </h1>
`;

const offlineHeaders = {
  headers: { 'Content-Type': 'text/html' },
};

// If any fetch fails, it will show `offlineBody`
// Maybe this should be limited to HTML documents?
// eslint-disable-next-line no-restricted-globals
self.addEventListener('fetch', event => {
  const { request } = event;

  // Only page loads need the offline page. Intercepting everything else means
  // re-issuing the request through `fetch(request)` below, and browsers have
  // been known to drop or truncate the body of a request handled that way:
  // WebKit's own root-cause analysis of its empty-body upload regression
  // points at a service worker re-issuing an intercepted POST, and Firefox
  // has its own bugs around request bodies through service workers. An upload
  // that arrives empty reads as `Unexpected end of form` on the server, so
  // returning early here lets the browser make the request itself.
  // https://bugs.webkit.org/show_bug.cgi?id=319396#c0
  if (request.mode !== 'navigate') {
    return;
  }

  // DevTools opening will trigger these o-i-c requests, which this SW can't handle.
  // There's probably more going on here, but I'd rather just ignore this problem. :)
  // https://github.com/paulirish/caltrainschedule.io/issues/49
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  event.respondWith(
    fetch(request).catch(error => {
      console.error({
        message: `[PWA Builder] Network request Failed. Serving offline page ${error}`,
        event,
      });
      return new Response(offlineBody, offlineHeaders);
    }),
  );
});
