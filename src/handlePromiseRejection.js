import stringify from 'json-stringify-safe';

// A usable HTTP status, if the error carries one.
//
// Failures from an upstream service set `error.status` to that service's own
// status (see `src/alpr.js`), and flattening those into a 500 hid what actually
// happened: a 429 rate limit from Plate Recognizer reached the browser looking
// exactly like a crash in our own code.
//
// The bounds matter because `status` is an ordinary property on an arbitrary
// error object -- it could be anything, and a response with a status Express
// rejects would fail differently from the error being reported.
const isHttpStatus = value =>
  Number.isInteger(value) && value >= 100 && value <= 599;

// Turns a rejection into the response for it: `handlePromiseRejection(res)`
// returns the handler, so it can be passed straight to `.catch()`.
//
// The error's own status is propagated when it has a usable one, and the
// response is a 500 otherwise, so a failure with no status of its own still
// reads as a server error rather than being passed off as something the client
// did wrong.
//
// Only enumerable own properties survive the round trip into JSON, so an
// Error's `message` and `stack` are not in the body -- `status` is, which is
// what the client can act on. The whole error goes to the server log.
const handlePromiseRejection = res => error => {
  console.error({ error });
  res
    .status(isHttpStatus(error?.status) ? error.status : 500)
    .json(JSON.parse(stringify({ error })));
};

export default handlePromiseRejection;
