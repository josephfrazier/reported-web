import * as Sentry from '@sentry/node';

import { readSessionToken } from './session.js';

// A coarse "automated client" flag for reading a traffic spike: crawlers,
// link previewers, headless browsers and command-line HTTP clients. It is a
// heuristic, not a user-agent parser, and the raw `userAgent` is logged next
// to it so a new or misclassified client can be inspected.
const AUTOMATED_CLIENT =
  /bot\b|crawler|spider|slurp|headless|phantomjs|selenium|puppeteer|playwright|lighthouse|pingdom|uptimerobot|statuscake|facebookexternalhit|embedly|quora link preview|pinterest|preview|curl\/|wget\/|python-requests|python-urllib|httpx|scrapy|go-http-client|java\/|okhttp|apache-httpclient|libwww-perl|postmanruntime|axios\/|node-fetch|undici|chatgpt-user/i;

const isAutomated = userAgent => !userAgent || AUTOMATED_CLIENT.test(userAgent);

// Only the host is kept: a referrer's path and query say more about the page
// a visitor came from than is needed to tell where traffic is coming from.
const refererHost = value => {
  if (!value) {
    return 'direct';
  }
  try {
    return new URL(value).host;
  } catch {
    return 'invalid';
  }
};

// The submissions map's search is either a polygon drawn on the map or a
// linked report: `polygon`, `submission`/`objectId` and `case_id` travel in
// the page URL and the map's two API requests. Keep those, so a search can be
// replayed from /submissions-map?..., while every other endpoint's query
// string stays out of the log so tokens and personal values never reach it.
// `objectId` is the API's name for the page's `submission`.
const SEARCH_QUERY_PATHS = new Set([
  '/submissions-map',
  '/api/submissions-in-polygon',
  '/api/submission',
]);
const MAX_LOGGED_SEARCH_LENGTH = 4096;
const MAX_LOGGED_ID_LENGTH = 200;

const stringParam = (value, maxLength) =>
  typeof value === 'string' && value !== ''
    ? value.slice(0, maxLength)
    : undefined;

const searchQuery = req => {
  // Express matches these routes with or without a trailing slash.
  const path = req.path.replace(/\/+$/, '') || '/';
  if (!SEARCH_QUERY_PATHS.has(path)) {
    return {};
  }

  const { query } = req;
  const fields = {};
  const polygon = stringParam(query.polygon, MAX_LOGGED_SEARCH_LENGTH);
  if (polygon !== undefined) {
    fields.searchPolygon = polygon;
  }
  const caseId = stringParam(query.case_id, MAX_LOGGED_ID_LENGTH);
  if (caseId !== undefined) {
    fields.searchCaseId = caseId;
  }
  const submission =
    stringParam(query.submission, MAX_LOGGED_ID_LENGTH) ??
    stringParam(query.objectId, MAX_LOGGED_ID_LENGTH);
  if (submission !== undefined) {
    fields.searchSubmission = submission;
  }
  return fields;
};

// Logs one line per HTTP request, so traffic can be counted after the fact.
//
// Heroku gets a compact line on stdout. Sentry gets the same facts as log
// attributes, so Logs can group requests by `method`, `path` or `status` and
// `event:http_request` selects exactly these entries. `console.debug` is not
// in consoleLoggingIntegration's levels (see src/server.js), so the Heroku
// line does not also become a duplicate Sentry log.
//
// The line is written when the response ends, so it carries the status the
// client actually got and the time the request took. A client that disconnects
// before the response finishes also ends it, and is logged once with
// `aborted: true`. Query strings are left out apart from the submissions-map
// search fields: they fragment `path` and can carry values that are not ours
// to log.
//
// `bot`, `userAgent`, `refererHost`, `hasSession` and `ip` describe who made
// the request. `ip` is Express's `req.ip`, which the trusted proxy setting in
// src/config.js resolves from X-Forwarded-For in production. Cookie values are
// never logged; `hasSession` only says a session cookie was present, not that
// it is valid.
const requestLogging = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  let logged = false;

  const log = () => {
    if (logged) {
      return;
    }
    logged = true;
    const userAgent = req.headers['user-agent'] || '';
    const fields = {
      event: 'http_request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
      aborted: !res.writableFinished,
      bot: isAutomated(userAgent),
      userAgent: userAgent.slice(0, 300),
      refererHost: refererHost(req.headers.referer),
      hasSession: Boolean(readSessionToken(req)),
      ip: req.ip,
      ...searchQuery(req),
    };

    // eslint-disable-next-line no-console
    console.debug(
      `[http] ${fields.method} ${fields.path} ${fields.status} ${
        fields.durationMs
      }ms${fields.aborted ? ' aborted' : ''}${fields.bot ? ' bot' : ''}`,
    );
    Sentry.logger.info('http_request', fields);
  };

  res.on('finish', log);
  res.on('close', log);
  next();
};

export default requestLogging;
