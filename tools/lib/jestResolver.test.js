/**
 * @jest-environment node
 */
const jestResolve = require('jest-resolve');

const Resolver = jestResolve.default;
const resolve = require('./jestResolver.js');

const moduleNotFound = () => {
  const error = new Error("Cannot find module './middleware/query'");
  error.code = 'MODULE_NOT_FOUND';
  return error;
};

// `defaultResolver` answers with each attempt in turn, so a test can say what
// the first look found and what the second one found.
const optionsWith = attempts => ({
  basedir: '/repo/src',
  defaultResolver: jest.fn(() => {
    const attempt = attempts.shift();
    if (attempt instanceof Error) {
      throw attempt;
    }
    return attempt;
  }),
});

let clearDefaultResolverCache;

beforeEach(() => {
  // Requiring jest-resolve above put it in this process's module cache, which
  // is what the resolver clears caches through. The spy stands in for the
  // real clear, which would empty caches this process still runs on.
  clearDefaultResolverCache = jest
    .spyOn(Resolver, 'clearDefaultResolverCache')
    .mockImplementation(() => {});
});

afterEach(() => {
  clearDefaultResolverCache.mockRestore();
});

test('resolves in one attempt when the file is found', () => {
  const options = optionsWith(['/repo/src/found.js']);

  expect(resolve('./found', options)).toBe('/repo/src/found.js');

  expect(options.defaultResolver).toHaveBeenCalledTimes(1);
  expect(clearDefaultResolverCache).not.toHaveBeenCalled();
});

test('clears the resolver caches and looks again when the first attempt misses', () => {
  const options = optionsWith([moduleNotFound(), '/repo/src/query.js']);
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});

  expect(resolve('./middleware/query', options)).toBe('/repo/src/query.js');

  expect(options.defaultResolver).toHaveBeenCalledTimes(2);
  expect(clearDefaultResolverCache).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('./middleware/query'),
  );

  log.mockRestore();
});

test('reports the first failure when the module is missing', () => {
  const first = moduleNotFound();
  const options = optionsWith([first, moduleNotFound()]);

  expect(() => resolve('./missing', options)).toThrow(first);

  expect(options.defaultResolver).toHaveBeenCalledTimes(2);
  expect(clearDefaultResolverCache).toHaveBeenCalledTimes(1);
});

test('finds the jest-resolve the process loaded, and the clear it needs', () => {
  // The clear goes through the module cache, so this is the shape it looks
  // for: if jest ever renames either part, the retry above would still run
  // but stop helping, and this test is where that shows up first.
  expect(typeof jestResolve.preloadResolver).toBe('function');
  expect(typeof Resolver.clearDefaultResolverCache).toBe('function');
});
