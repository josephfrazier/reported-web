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

// The submissions map has no text search: its search is the polygon drawn on
// the map. The polygon travels in the `polygon` query parameter of both the
// page URL and its API request, so keep it for both paths. The searched area
// can be replayed from /submissions-map?polygon=..., while every other
// endpoint's query string stays out of the log so tokens and personal values
// never reach it.
const SEARCH_QUERY_PATHS = new Set([
  '/submissions-map',
  '/api/submissions-in-polygon',
]);
const MAX_LOGGED_SEARCH_LENGTH = 4096;

const searchPolygon = req => {
  // Express matches these routes with or without a trailing slash.
  const path = req.path.replace(/\/+$/, '') || '/';
  if (!SEARCH_QUERY_PATHS.has(path)) {
    return undefined;
  }
  const { polygon } = req.query;
  return typeof polygon === 'string'
    ? polygon.slice(0, MAX_LOGGED_SEARCH_LENGTH)
    : undefined;
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
// polygon: they fragment `path` and can carry values that are not ours to log.
//
// `bot`, `userAgent`, `refererHost` and `hasSession` describe who made the
// request without recording the client's IP address or any cookie value.
// `hasSession` only says a session cookie was present, not that it is valid.
const requestLogging = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  let logged = false;

  const log = () => {
    if (logged) {
      return;
    }
    logged = true;
    const userAgent = req.headers['user-agent'] || '';
    const polygon = searchPolygon(req);
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
      ...(polygon === undefined ? {} : { searchPolygon: polygon }),
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
