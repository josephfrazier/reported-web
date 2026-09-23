/**
 * A memo of reverse-geocoded addresses, keyed by the coordinates they were
 * looked up for.
 *
 * An address is a function of coordinates alone, but `setCoords` re-queries
 * NYC Planning Labs on every call: the 500 ms debounce coalesces a burst of
 * calls into one request and then stores nothing, so moving the map away from
 * a curb and back asks for the same address all over again. Semi-automatic
 * mode gives that work a stage of its own -- it geocodes every violation
 * before the user starts reviewing them -- which is what makes the same
 * coordinates worth remembering.
 *
 * One memo per `Home` instance rather than a module-level singleton: this
 * module is evaluated once per server process, so a shared cache would leak
 * addresses looked up for one request into the next request's render.
 *
 * Successes only. A failed lookup means "not right now" -- the service is
 * down, or the request timed out -- and caching that would keep serving the
 * failure long after the service recovered, for every violation at those
 * coordinates. `get` returns `undefined` for coordinates that were never
 * resolved, so a cached empty string (a real answer for coordinates geosearch
 * cannot name) is still distinguishable from a miss.
 */

// Coordinates arrive as JS numbers with many decimals of precision, and their
// decimal text round-trips exactly, so `"lat,long"` cannot bring two distinct
// pairs to the same key the way a rounded or reordered one could. The comma is
// what keeps a latitude ending in a digit from running into a longitude
// starting with one.
const coordinateKey = ({ latitude, longitude }) => `${latitude},${longitude}`;

export default function createGeosearchAddressCache() {
  const addresses = new Map();

  return {
    get({ latitude, longitude }) {
      return addresses.get(coordinateKey({ latitude, longitude }));
    },

    set({ latitude, longitude, address }) {
      addresses.set(coordinateKey({ latitude, longitude }), address);
    },
  };
}
