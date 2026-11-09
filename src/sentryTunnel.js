// Content blockers stop browsers from reaching Sentry's own domain, so the
// browser SDK sends its envelopes to this app instead (the `tunnel` option
// in src/client.js). This relays one envelope to the ingest endpoint named
// by the DSN in the envelope header. That DSN must match the configured
// one: the route is public, and forwarding anything else would turn it
// into an open proxy.

export const ingestUrl = dsn => {
  const { host, pathname } = new URL(dsn);
  return `https://${host}/api/${pathname.slice(1)}/envelope/`;
};

// Resolves with the ingest endpoint's HTTP status. Rejects when the body
// is not an envelope or names a different DSN.
export const relayEnvelope = async (body, { dsn, fetchImpl = fetch }) => {
  const [headerLine] = String(body).split('\n');
  const header = JSON.parse(headerLine);
  const target = new URL(header.dsn);
  const configured = new URL(dsn);
  if (
    target.host !== configured.host ||
    target.pathname !== configured.pathname
  ) {
    throw new Error(`Envelope DSN does not match the configured DSN`);
  }

  const response = await fetchImpl(ingestUrl(header.dsn), {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
  });
  return response.status;
};
