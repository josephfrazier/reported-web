/**
 * @jest-environment node
 */

import { EventEmitter } from 'events';

import * as Sentry from '@sentry/node';
import express from 'express';

import requestLogging from './requestLogging.js';

// The middleware only reads `statusCode` and `writableFinished` from the
// response and subscribes to the events Node emits at the end of one.
const fakeResponse = ({ statusCode = 200, writableFinished = true } = {}) =>
  Object.assign(new EventEmitter(), { statusCode, writableFinished });

const listen = app =>
  new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

const close = server => new Promise(resolve => server.close(resolve));

describe('requestLogging', () => {
  let debug;
  let sentryLog;

  beforeEach(() => {
    debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    sentryLog = jest.spyOn(Sentry.logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    debug.mockRestore();
    sentryLog.mockRestore();
  });

  test('logs method, path, status, duration and client details on finish', () => {
    const req = {
      method: 'POST',
      path: '/api/submit',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130.0.0.0',
        referer: 'https://example.com/some/page?utm_source=test',
        cookie: 'other=value',
      },
    };
    const res = fakeResponse({ statusCode: 202 });

    requestLogging(req, res, () => {});
    res.emit('finish');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[http\] POST \/api\/submit 202 \d+ms$/),
    );
    expect(sentryLog).toHaveBeenCalledTimes(1);
    expect(sentryLog).toHaveBeenCalledWith('http_request', {
      event: 'http_request',
      method: 'POST',
      path: '/api/submit',
      status: 202,
      durationMs: expect.any(Number),
      aborted: false,
      bot: false,
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130.0.0.0',
      refererHost: 'example.com',
      hasSession: false,
    });
  });

  test('marks an automated client and a present session cookie', () => {
    const req = {
      method: 'GET',
      path: '/',
      headers: {
        'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        referer: 'https://news.ycombinator.com/item?id=1',
        cookie: 'reportedWebSession=some-token',
      },
    };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');

    expect(debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[http\] GET \/ 200 \d+ms bot$/),
    );
    expect(sentryLog).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({
        bot: true,
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        refererHost: 'news.ycombinator.com',
        hasSession: true,
      }),
    );
  });

  test('keeps the submissions-map polygon and drops other query strings', () => {
    const polygon =
      '40.700000,-74.000000;40.710000,-74.010000;40.720000,-74.020000';
    const req = {
      method: 'GET',
      path: '/api/submissions-in-polygon',
      query: { polygon },
      headers: { 'user-agent': 'Mozilla/5.0' },
    };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');

    expect(sentryLog).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({
        path: '/api/submissions-in-polygon',
        searchPolygon: polygon,
      }),
    );

    const pageReq = {
      method: 'GET',
      path: '/submissions-map/',
      query: { polygon, case_id: '311-22918579' },
      headers: {},
    };
    const pageRes = fakeResponse();

    requestLogging(pageReq, pageRes, () => {});
    pageRes.emit('finish');

    expect(sentryLog).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({
        path: '/submissions-map/',
        searchPolygon: polygon,
      }),
    );
  });

  test('caps a long submissions-map polygon', () => {
    const req = {
      method: 'GET',
      path: '/api/submissions-in-polygon',
      query: { polygon: '1,2;'.repeat(2000) },
      headers: {},
    };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');

    expect(sentryLog.mock.calls[0][1].searchPolygon).toHaveLength(4096);
  });

  test('does not log a query string from another path', () => {
    const req = {
      method: 'GET',
      path: '/api/geosearch',
      query: { polygon: 'not-a-search' },
      headers: {},
    };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');

    expect(sentryLog.mock.calls[0][1]).not.toHaveProperty('searchPolygon');
  });

  test('logs a client disconnect once, marked as aborted', () => {
    const req = { method: 'GET', path: '/slow', headers: {} };
    const res = fakeResponse({ writableFinished: false });

    requestLogging(req, res, () => {});
    res.emit('close');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[http\] GET \/slow 200 \d+ms aborted bot$/),
    );
    expect(sentryLog).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({
        path: '/slow',
        aborted: true,
        bot: true,
        userAgent: '',
        refererHost: 'direct',
      }),
    );
  });

  test('does not log twice when close follows finish', () => {
    const req = { method: 'GET', path: '/', headers: {} };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');
    res.emit('close');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(sentryLog).toHaveBeenCalledTimes(1);
  });

  test('reads the polygon from a real Express request', async () => {
    const app = express();
    app.use(requestLogging);
    app.get('/api/submissions-in-polygon', (req, res) =>
      res.json({ ok: true }),
    );

    const server = await listen(app);
    try {
      const { port } = server.address();
      const polygon = '40.1,-73.1;40.2,-73.2;40.3,-73.3';
      const response = await fetch(
        `http://127.0.0.1:${port}/api/submissions-in-polygon?polygon=${encodeURIComponent(
          polygon,
        )}`,
      );
      await response.json();

      expect(sentryLog).toHaveBeenCalledWith(
        'http_request',
        expect.objectContaining({
          path: '/api/submissions-in-polygon',
          searchPolygon: polygon,
        }),
      );
    } finally {
      await close(server);
    }
  });
});
