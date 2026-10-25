import Parse from 'parse/node';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { MongoBinary, MongoMemoryServer } = require('mongodb-memory-server');
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

// The suites that start a server run in parallel Jest workers, and on a cold
// cache they all download MongoDB at once. mongodb-memory-server's own
// download lock does not create its lock file atomically, so two workers can
// both pass its existence check, write the same ".tgz.downloading" file, and
// the one that loses the rename fails with ENOENT and its beforeAll hook
// times out. CI starts with an empty cache on every run, so that failure came
// and went on main. A lock file created with O_EXCL is exclusive across
// processes, so exactly one worker downloads and the others wait for the
// cached binary.
const MONGOD_LOCK = path.join(
  os.tmpdir(),
  `reported-web-mongod-${MONGOD_VERSION}-${process.getuid?.() ?? 'user'}.lock`,
);
const LOCK_RETRY_MS = 100;
const LOCK_STALE_MS = 10 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const pidIsAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return err.code === 'EPERM';
  }
};

const lockIsStale = lockPath => {
  let pid;
  let mtimeMs;
  try {
    pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch (err) {
    // The holder released the lock between the failed create and this read.
    return err.code === 'ENOENT';
  }
  // The age check covers a lock whose PID the system later gave to an
  // unrelated process, which would otherwise look alive forever.
  return !pid || !pidIsAlive(pid) || Date.now() - mtimeMs > LOCK_STALE_MS;
};

const acquireMongodLock = async lockPath => {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
    if (lockIsStale(lockPath)) {
      fs.rmSync(lockPath, { force: true });
    } else {
      await sleep(LOCK_RETRY_MS);
    }
    await acquireMongodLock(lockPath);
  }
};

// Download and extract the binary once, before the parallel suites can race
// on it. With a warm cache this is a stat, so server startup stays parallel.
const downloadMongod = async () => {
  await acquireMongodLock(MONGOD_LOCK);
  try {
    await MongoBinary.getPath({ version: MONGOD_VERSION });
  } finally {
    fs.rmSync(MONGOD_LOCK, { force: true });
  }
};

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
  await downloadMongod();
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
