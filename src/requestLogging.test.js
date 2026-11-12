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

  test('logs method, path, status and duration when the response finishes', () => {
    const req = { method: 'POST', path: '/api/submit' };
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
    });
  });

  test('logs a client disconnect once, marked as aborted', () => {
    const req = { method: 'GET', path: '/slow' };
    const res = fakeResponse({ writableFinished: false });

    requestLogging(req, res, () => {});
    res.emit('close');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\[http\] GET \/slow 200 \d+ms aborted$/),
    );
    expect(sentryLog).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ path: '/slow', aborted: true }),
    );
  });

  test('does not log twice when close follows finish', () => {
    const req = { method: 'GET', path: '/' };
    const res = fakeResponse();

    requestLogging(req, res, () => {});
    res.emit('finish');
    res.emit('close');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(sentryLog).toHaveBeenCalledTimes(1);
  });

  test('logs one line for a real request, without its query string', async () => {
    const app = express();
    app.use(requestLogging);
    app.get('/reports/:id', (req, res) => res.status(201).json({ ok: true }));

    const server = await listen(app);
    try {
      const { port } = server.address();
      const response = await fetch(
        `http://127.0.0.1:${port}/reports/42?utm_source=test`,
      );
      await response.json();

      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug).toHaveBeenCalledWith(
        expect.stringMatching(/^\[http\] GET \/reports\/42 201 \d+ms$/),
      );
      expect(sentryLog).toHaveBeenCalledWith(
        'http_request',
        expect.objectContaining({
          method: 'GET',
          path: '/reports/42',
          status: 201,
        }),
      );
    } finally {
      await close(server);
    }
  });
});
