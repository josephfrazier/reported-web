import getNycTimezoneOffset from './timezone.js';

// timezone-mock replaces the global Date with one that knows the US Eastern
// rules, but not every method the offset helper uses. Keep the real Date for
// formats the mock cannot parse, and lend the mock the real `toTimeString`,
// which the helper reads to find the minute a switch happens.
const RealDate = Date;

require('timezone-mock').register('US/Eastern');
require('timezone-mock').options({
  fallbackFn: param => new RealDate(param),
});

global.Date.prototype.toTimeString = function toTimeString() {
  return this.d.toTimeString();
};

describe('getNycTimezoneOffset', () => {
  test('reads winter in standard time and summer in daylight time', () => {
    expect(getNycTimezoneOffset(new Date(Date.UTC(2016, 0, 15, 12)))).toBe(
      300,
    );
    expect(getNycTimezoneOffset(new Date(Date.UTC(2016, 6, 15, 12)))).toBe(
      240,
    );
  });

  test("uses the date's own year for the switches", () => {
    // A report can carry a time from any year. Reading a 2015 or 2027 summer
    // against today's switches marks it standard time; its own year's say
    // daylight time.
    expect(getNycTimezoneOffset(new Date(Date.UTC(2015, 6, 15, 12)))).toBe(
      240,
    );
    expect(getNycTimezoneOffset(new Date(Date.UTC(2027, 6, 15, 12)))).toBe(
      240,
    );
    expect(getNycTimezoneOffset(new Date(Date.UTC(2027, 0, 15, 12)))).toBe(
      300,
    );
  });
});
