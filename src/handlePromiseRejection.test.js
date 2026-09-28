import handlePromiseRejection from './handlePromiseRejection.js';

const fakeResponse = () => {
  const res = { statusCode: undefined, body: undefined };

  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = payload => {
    res.body = payload;
    return res;
  };

  return res;
};

describe('handlePromiseRejection', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('propagates an upstream status rather than reporting a 500', () => {
    const res = fakeResponse();
    const error = new Error('Plate Recognizer API error: 429 - {}');
    error.status = 429;

    handlePromiseRejection(res)(error);

    expect(res.statusCode).toBe(429);
    // Only enumerable own properties survive into the body, which is why the
    // status is there and the message is not.
    expect(res.body).toEqual({ error: { status: 429 } });
  });

  test('keeps other upstream statuses too', () => {
    const res = fakeResponse();
    const error = new Error('quota');
    error.status = 402;

    handlePromiseRejection(res)(error);

    expect(res.statusCode).toBe(402);
  });

  test('reports a 500 for an error carrying no status', () => {
    const res = fakeResponse();

    handlePromiseRejection(res)(new Error('something broke'));

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: {} });
  });

  // `status` is an ordinary property on an arbitrary object, so it cannot be
  // trusted to be an HTTP status. These would all reach Express as something
  // other than a valid status line.
  test.each([0, 99, 600, 42, 4.29, '429', null, undefined])(
    'does not pass off %p as an HTTP status',
    value => {
      const res = fakeResponse();
      const error = new Error('odd status');
      error.status = value;

      handlePromiseRejection(res)(error);

      expect(res.statusCode).toBe(500);
    },
  );

  test('still logs the whole error for the server log', () => {
    const res = fakeResponse();
    const error = new Error('boom');

    handlePromiseRejection(res)(error);

    expect(consoleError).toHaveBeenCalledWith({ error });
  });
});
