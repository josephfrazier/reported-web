/**
 * Jest's module resolver, with one retry for a resolution that comes back
 * empty.
 *
 * `jest-resolve` keeps what it learns about the filesystem for the life of
 * the worker process: `statSyncCached` records a path it cannot stat as "not
 * a file", nothing expires that, and the native resolver it asks caches its
 * own walk. This checkout is a Docker `virtiofs` share of the host's disk, so
 * a stat can miss for a moment while a full parallel run reads through it --
 * and the miss then outlives the moment. Every later resolution of that path
 * fails, and the suite dies as:
 *
 *   Test suite failed to run
 *   Cannot find module './middleware/query' from
 *   'node_modules/parse-server/node_modules/express/lib/application.js'
 *
 * while the file sits on disk. Jest's own message shows as much: it globs the
 * path it could not resolve and prints what it found there. The Parse suites
 * are the ones that meet it, because parse-server is installed on demand and
 * brings a deep tree of its own (`jest.globalSetup.js`).
 *
 * So resolve the way jest does; when that finds nothing, drop what jest knows
 * about the filesystem and ask once more. A module that is genuinely missing
 * fails both times, and the caller sees the first error, unmatched. A rescue
 * is logged, which is how a recurrence -- or a change in the internals below
 * -- shows itself.
 *
 * The lasting fix belongs in `jest-resolve`: a lookup that finds nothing
 * should not outlive the resolution that saw it. This file is the workaround
 * until then.
 */

// Clear the caches of the jest-resolve this worker resolved through. Found in
// the module cache rather than by requiring it: which installed copy that is
// depends on how the tree was laid out, and a copy required from here could
// be a different one. The two checks below are the shape of jest-resolve's
// own index -- the resolver class as `default`, the preload hook beside it --
// so nothing else in the cache is asked to clear anything.
const clearResolverCaches = () => {
  for (const loaded of Object.values(require.cache)) {
    const exports = loaded?.exports;
    if (
      typeof exports?.default?.clearDefaultResolverCache === 'function' &&
      typeof exports?.preloadResolver === 'function'
    ) {
      exports.default.clearDefaultResolverCache();
    }
  }
};

module.exports = (request, options) => {
  const { basedir, defaultResolver } = options;
  try {
    return defaultResolver(request, options);
  } catch (firstError) {
    clearResolverCaches();
    try {
      const resolved = defaultResolver(request, options);
      console.info(
        `[jest-resolve] ${request} (from ${basedir}) resolved only after clearing the resolver cache`,
      );
      return resolved;
    } catch {
      throw firstError;
    }
  }
};
