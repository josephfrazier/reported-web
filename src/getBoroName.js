import mem from 'mem';

export function getBoroName({ lookup, end }) {
  const boroughPolygon = (lookup &&
    lookup.search(end.longitude, end.latitude)) || {
    properties: {
      BoroName: '(unknown borough)',
    },
  };

  return boroughPolygon.properties.BoroName;
}

export const getBoroNameMemoized = mem(getBoroName, {
  cacheKey: ({ lookup, end }) => !!lookup + JSON.stringify(end),
});
