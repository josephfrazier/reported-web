import * as Sentry from '@sentry/node';

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
// `aborted: true`. The query string is left out: it fragments `path` and can
// carry values that are not ours to log.
const requestLogging = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  let logged = false;

  const log = () => {
    if (logged) {
      return;
    }
    logged = true;
    const fields = {
      event: 'http_request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
      aborted: !res.writableFinished,
    };

    // eslint-disable-next-line no-console
    console.debug(
      `[http] ${fields.method} ${fields.path} ${fields.status} ${
        fields.durationMs
      }ms${fields.aborted ? ' aborted' : ''}`,
    );
    Sentry.logger.info('http_request', fields);
  };

  res.on('finish', log);
  res.on('close', log);
  next();
};

export default requestLogging;
