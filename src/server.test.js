/**
 * @jest-environment node
 *
 * server.js imports getVehicleType, which needs Node globals (e.g.
 * TextDecoder) that jest's jsdom environment doesn't provide.
 */

import http from 'http';

// server.js calls app.listen() while being imported; don't actually bind a
// port when it runs under jest.
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function listen() {
  return this;
};

// chunk-manifest.json is a build artifact that doesn't exist in src/; jest's
// normal module resolution fails on it, so use a virtual mock.
jest.mock('./chunk-manifest.json', () => ({}), { virtual: true });

jest.mock('parse/node', () => {
  // eslint-disable-next-line global-require -- allowed inside jest factories
  const RealParseQuery = require('parse/lib/node/ParseQuery.js').default;

  // Submissions as a Parse server would return them: id + attributes, with
  // createdAt on the "object" itself rather than inside attributes. Seeded
  // scrambled so the sort has to do real work.
  const submissions = [
    {
      id: 'A',
      attributes: { timeofreport: '2026-09-03T14:58:00.000Z' },
      createdAt: '2026-09-03T10:00:00.000Z',
    },
    {
      id: 'B',
      attributes: { timeofreport: '2026-09-03T14:58:00.000Z' },
      createdAt: '2026-09-03T10:00:01.000Z',
    },
    {
      id: 'C',
      attributes: { timeofreport: '2026-09-03T15:00:00.000Z' },
      createdAt: '2026-09-03T09:00:00.000Z',
    },
    {
      id: 'D',
      attributes: { timeofreport: '2026-09-03T15:00:00.000Z' },
      createdAt: '2026-09-03T09:00:01.000Z',
    },
  ];

  const state = { lastSubmissionFind: null };

  const valueOf = (doc, field) =>
    doc.attributes && doc.attributes[field] !== undefined
      ? doc.attributes[field]
      : doc[field];

  const compareDates = (a, b) => Date.parse(a) - Date.parse(b);

  // Sort the same way Parse Server applies a query's order string.
  const sortByOrder = (documents, order) =>
    [...documents].sort((a, b) => {
      for (const key of order) {
        const descending = key.startsWith('-');
        const field = descending ? key.slice(1) : key;
        const cmp = compareDates(valueOf(a, field), valueOf(b, field));
        if (cmp !== 0) {
          return descending ? -cmp : cmp;
        }
      }
      return 0;
    });

  class FakeUser {
    constructor() {
      this.fields = {};
    }

    set(fields) {
      this.fields = { ...this.fields, ...fields };
      return this;
    }

    get(key) {
      return this.fields[key];
    }

    save() {
      return Promise.resolve(this);
    }

    // Fake signUp never uses the instance; it just rejects to force the
    // login fallback path.
    // eslint-disable-next-line class-methods-use-this
    signUp = () => Promise.reject(new Error('username already exists'));

    static logIn(username) {
      return Promise.resolve(
        new FakeUser().set({
          username,
          email: username,
          emailVerified: true,
          sessionToken: 'test-session-token',
        }),
      );
    }
  }

  // Only the merged or-query and the tasks query are actually awaited by
  // getSubmissions; fake both at the same seam Parse Server would use.
  RealParseQuery.prototype.find = function find() {
    // eslint-disable-next-line no-underscore-dangle -- ParseQuery's internals
    if (this._where && this._where.$or) {
      state.lastSubmissionFind = this;
      // eslint-disable-next-line no-underscore-dangle -- ParseQuery's internals
      return Promise.resolve(sortByOrder(submissions, this._order || []));
    }
    return Promise.resolve([]);
  };

  return {
    initialize: () => {},
    Cloud: { useMasterKey: () => {} },
    serverURL: '',
    Object: {
      extend: className => {
        class FakeParseObject {}
        FakeParseObject.className = className;
        FakeParseObject.createWithoutData = id => ({ id });
        return FakeParseObject;
      },
    },
    User: FakeUser,
    Query: RealParseQuery,
    state,
  };
});

const { default: RealParseQuery } = require('parse/lib/node/ParseQuery.js');
const { state } = require('parse/node');

const { getSubmissions } = require('./server.js');

afterAll(() => {
  http.Server.prototype.listen = originalListen;
});

describe('getSubmissions', () => {
  test('sorts by photo time, breaking ties by when they were submitted', async () => {
    const submissions = await getSubmissions({
      body: {
        email: 'test@example.com',
        password: 'password123',
        FirstName: 'Test',
        LastName: 'User',
        Phone: '1234567890',
        testify: false,
      },
    });

    // A and B both have a photo timestamp of 2:58 PM; B was created after A,
    // so B must come first. The same holds for C/D at 3:00 PM.
    expect(submissions.map(({ id }) => id)).toEqual(['D', 'C', 'B', 'A']);
  });

  test('applies both sort keys via the query order', async () => {
    // eslint-disable-next-line no-underscore-dangle -- ParseQuery's internals
    expect(state.lastSubmissionFind._order).toEqual([
      '-timeofreport',
      '-createdAt',
    ]);
  });

  test('ParseQuery.descending() resets prior sort keys, so both keys must be passed in one call', () => {
    const oneCall = new RealParseQuery('submission');
    oneCall.descending(['timeofreport', 'createdAt']);
    // eslint-disable-next-line no-underscore-dangle -- ParseQuery's internals
    expect(oneCall._order).toEqual(['-timeofreport', '-createdAt']);

    const twoCalls = new RealParseQuery('submission');
    twoCalls.descending('timeofreport');
    twoCalls.descending('createdAt');
    // The first sort key is dropped entirely.
    // eslint-disable-next-line no-underscore-dangle -- ParseQuery's internals
    expect(twoCalls._order).toEqual(['-createdAt']);
  });
});
