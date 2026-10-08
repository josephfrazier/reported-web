import { ingestUrl, relayEnvelope } from './sentryTunnel.js';

const dsn = 'https://key@o1.ingest.us.sentry.io/42';
const envelopeFor = envelopeDsn =>
  `${JSON.stringify({ dsn: envelopeDsn })}\n{"type":"event"}\n{"message":"probe"}\n`;

describe('ingestUrl', () => {
  test('points at the envelope endpoint of the DSN', () => {
    expect(ingestUrl(dsn)).toBe(
      'https://o1.ingest.us.sentry.io/api/42/envelope/',
    );
  });
});

describe('relayEnvelope', () => {
  test('forwards an envelope to the ingest endpoint of its DSN', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 200 });
    const envelope = envelopeFor(dsn);

    const status = await relayEnvelope(envelope, { dsn, fetchImpl });

    expect(status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://o1.ingest.us.sentry.io/api/42/envelope/',
      {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
      },
    );
  });

  test('refuses an envelope for a different host', async () => {
    const fetchImpl = jest.fn();
    const envelope = envelopeFor('https://key@o2.ingest.us.sentry.io/42');

    await expect(relayEnvelope(envelope, { dsn, fetchImpl })).rejects.toThrow(
      'does not match',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('refuses an envelope for a different project', async () => {
    const fetchImpl = jest.fn();
    const envelope = envelopeFor('https://key@o1.ingest.us.sentry.io/43');

    await expect(relayEnvelope(envelope, { dsn, fetchImpl })).rejects.toThrow(
      'does not match',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('refuses a body that is not an envelope', async () => {
    const fetchImpl = jest.fn();

    await expect(
      relayEnvelope('not an envelope', { dsn, fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
