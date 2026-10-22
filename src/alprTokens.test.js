/**
 * @jest-environment node
 */

import readLicenseViaALPR from './alpr.js';

// Small enough that the downscaling steps leave it alone, and not a real image
// at all: every call below is answered by the stub, so the bytes only need to
// be bytes.
const photo = Buffer.from('the bytes the request carries');

function answer({ ok = true, status = 200, body = { results: [] } } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    body: { cancel: jest.fn().mockResolvedValue(undefined) },
  };
}

// Runs `body` with the given answers in place of Plate Recognizer, one per
// call, and puts back whatever fetch was there before.
async function withAnswers(answers, body) {
  const hadFetch = 'fetch' in global;
  const originalFetch = global.fetch;
  const fetchSpy = jest.fn();
  answers.forEach(response => fetchSpy.mockResolvedValueOnce(response));
  global.fetch = fetchSpy;

  try {
    return await body(fetchSpy);
  } finally {
    if (hadFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  }
}

function authorizationHeaders(fetchSpy) {
  return fetchSpy.mock.calls.map(
    ([, options]) => options.headers.Authorization,
  );
}

describe('PLATERECOGNIZER_TOKENS', () => {
  test('tries the tokens in the order they are listed', async () => {
    await withAnswers([answer()], async fetchSpy => {
      await readLicenseViaALPR({
        attachmentBuffer: photo,
        PLATERECOGNIZER_TOKENS: 'first,second',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(authorizationHeaders(fetchSpy)).toEqual(['Token first']);
    });
  });

  test('ignores whitespace around an entry and empty entries', async () => {
    await withAnswers(
      [answer({ ok: false, status: 401 }), answer()],
      async fetchSpy => {
        await readLicenseViaALPR({
          attachmentBuffer: photo,
          PLATERECOGNIZER_TOKENS: ' first , , second ',
        });

        expect(authorizationHeaders(fetchSpy)).toEqual([
          'Token first',
          'Token second',
        ]);
      },
    );
  });

  test('moves to the next token when one is refused', async () => {
    const refused = answer({ ok: false, status: 401 });
    const accepted = answer();

    await withAnswers([refused, accepted], async fetchSpy => {
      const reading = await readLicenseViaALPR({
        attachmentBuffer: photo,
        PLATERECOGNIZER_TOKENS: 'one,two',
      });

      expect(reading.results).toEqual([]);
      expect(authorizationHeaders(fetchSpy)).toEqual([
        'Token one',
        'Token two',
      ]);
      // The refusal behind the accepted call had its body consumed so its
      // socket goes back to the pool.
      expect(refused.body.cancel).toHaveBeenCalledTimes(1);
    });
  });

  test('throws the last refusal when every token is refused', async () => {
    const first = answer({ ok: false, status: 401 });
    const last = answer({
      ok: false,
      status: 429,
      body: { detail: 'Request was throttled.' },
    });

    await withAnswers([first, last], async fetchSpy => {
      await expect(
        readLicenseViaALPR({
          attachmentBuffer: photo,
          PLATERECOGNIZER_TOKENS: 'one,two',
        }),
      ).rejects.toThrow('429');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(first.body.cancel).toHaveBeenCalledTimes(1);
      // The last response is read for its error, so its body is left intact.
      expect(last.body.cancel).not.toHaveBeenCalled();
    });
  });

  test('fails without calling the service when no tokens are configured', async () => {
    await withAnswers([], async fetchSpy => {
      await expect(
        readLicenseViaALPR({
          attachmentBuffer: photo,
          PLATERECOGNIZER_TOKENS: ' , ',
        }),
      ).rejects.toThrow('PLATERECOGNIZER_TOKENS');

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
