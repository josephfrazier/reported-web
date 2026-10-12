import Parse from 'parse/node';

const net = require('net');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ParseServer } = require('parse-server');

// parse-server skips its cloud/URL verification (and test-unfriendly process
// listeners) when TESTING is set. This module is imported at the top of every
// suite that starts a server, so the flag is set before one is constructed.
process.env.TESTING = '1';

const APP_ID = 'test-app';
const MASTER_KEY = 'test-master';

// Note: the binary must be downloaded once (mongodb-memory-server caches it),
// and on Ubuntu 24+ mongod 4.4 needs libssl1.1 installed.
const MONGOD_VERSION = '4.4.14';

// create() can resolve a moment before mongod accepts connections, and
// parse-server connects to it in its constructor, so wait until the port
// actually accepts a TCP connection.
const waitForMongod = (port, attempts = 0) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      if (attempts < 100) {
        setTimeout(
          () => waitForMongod(port, attempts + 1).then(resolve, reject),
          50,
        );
      } else {
        reject(new Error('mongod never accepted connections'));
      }
    });
  });

// Starts a real Parse Server (the version production runs) backed by a real
// MongoDB started in-memory, and points this process's Parse SDK at it, so a
// suite exercises the actual semantics instead of a fake.
//
// Each suite still chooses its own authorization, because that is the part
// worth reading at the call site rather than here:
//
//   - `masterKey` is passed to the SDK only when the suite asks for it. The
//     suites whose modules list or delete records belonging to another Parse
//     user need it; the ones that authorize with a session token must not
//     have it, so that nothing can quietly bypass an ACL.
//   - `useMasterKey` mirrors production's import-time
//     `Parse.Cloud.useMasterKey()` for the suites that mean to test with it
//     switched on globally.
//
// `serverOptions` is merged over the baseline configuration last, so a suite
// can add adapters or relax a parse-server default that its own saves rely on.
const startRealParseServer = async ({
  serverOptions = {},
  masterKey = null,
  useMasterKey = false,
} = {}) => {
  const mongo = await MongoMemoryServer.create({
    binary: { version: MONGOD_VERSION },
  });
  await waitForMongod(new URL(mongo.getUri()).port);

  // startApp() resolves once the HTTP server is listening, so no separate wait
  // for the 'listening' event is needed.
  const parseServer = await ParseServer.startApp({
    databaseURI: mongo.getUri(),
    appId: APP_ID,
    masterKey: MASTER_KEY,
    // Only used as a placeholder; the client points at the real port.
    serverURL: 'http://localhost/parse',
    mountPath: '/parse',
    port: 0,
    verbose: false,
    ...serverOptions,
  });

  // parse-server initializes its own nested parse SDK; ours needs it too.
  Parse.initialize(APP_ID, undefined, masterKey ?? undefined);
  if (useMasterKey) {
    Parse.Cloud.useMasterKey();
  }
  Parse.serverURL = `http://localhost:${parseServer.server.address().port}/parse`;

  return {
    mongo,
    parseServer,
    // handleShutdown() closes the HTTP server itself.
    stop: async () => {
      await parseServer.handleShutdown();
      await mongo.stop();
    },
  };
};

export default startRealParseServer;
