// Where the batch hands its grouping data to whoever can send it.
//
// The client entry registers a sender (Sentry, through its own SDK). Nothing
// here imports @sentry/browser, so the server bundle can import this module
// too. With no sender -- tests, the server, or a build without a Sentry DSN --
// the calls do nothing.
let send = null;

export const setBatchGroupingSender = sender => {
  send = sender;
};

export const captureBatchGroupingEvent = payload => {
  if (send) {
    send(payload);
  }
};
