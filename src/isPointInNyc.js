import mem from 'mem';

export function isPointInNyc({ lookup, end }) {
  return !!lookup.search(end.longitude, end.latitude);
}

export const isPointInNycMemoized = mem(isPointInNyc, {
  cacheKey: ({ lookup, end }) => !!lookup + JSON.stringify(end),
});
