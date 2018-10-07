/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import promisedLocation from 'promised-location';
import humanizeDistance from 'humanize-distance';
import geodist from 'geodist';
import 'intl/locale-data/jsonp/en.js'; // https://github.com/andyearnshaw/Intl.js/issues/271#issuecomment-292233493
import strftime from 'strftime';
import PolygonLookup from 'polygon-lookup';
import geolib from 'geolib';
import d2d from 'degrees-to-direction';
import mem from 'mem';

import withStyles from 'isomorphic-style-loader/lib/withStyles';
import marx from 'marx-css/css/marx.css';
import s from './ElectriCitibikes.css';

class ElectriCitibikes extends React.Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
  };

  state = {
    data: {
      features: [],
    },
  };

  componentDidMount() {
    this.updateData();

    fetch(
      'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/nybb/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson',
    )
      .then(response => response.json())
      .then(boroughBoundariesFeatureCollection => {
        this.setState({
          boroughBoundariesFeatureCollection,
        });
      });
  }

  updateData = async () => {
    this.setState({ isRefreshing: true });
    const data = await fetch(
      'https://bikeangels-api.citibikenyc.com/map/v1/nyc/stations',
    ).then(r => r.json());
    console.info({ data });
    const updatedAt = Date.now();
    this.setState({ isRefreshing: false, data, updatedAt });

    promisedLocation().then(({ coords: { latitude, longitude } }) =>
      this.setState({ latitude, longitude }),
    );
  };

  render() {
    const {
      state: {
        data,
        latitude,
        longitude,
        updatedAt,
        boroughBoundariesFeatureCollection,
      },
    } = this;
    return (
      <div className={s.root}>
        <div className={s.container}>
          <h1>{this.props.title}</h1>
          <p>
            <button
              style={{ width: '100%' }}
              onClick={this.updateData}
              disabled={this.state.isRefreshing}
            >
              {this.state.isRefreshing ? 'Loading...' : 'Refresh'}
            </button>
          </p>
          <ElectriCitibikeList
            data={data}
            latitude={latitude}
            longitude={longitude}
            updatedAt={updatedAt}
            boroughBoundariesFeatureCollection={
              boroughBoundariesFeatureCollection
            }
          />
        </div>
      </div>
    );
  }
}

function getMapUrl({ station, latitude, longitude }) {
  if (latitude && longitude) {
    return `https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${latitude}%2C${longitude}&destination=${
      station.latitude
    }%2C${station.longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${
    station.latitude
  }%2C${station.longitude}`;
}

function getBoroName({ lookup, end }) {
  const boroughPolygon = (lookup &&
    lookup.search(end.longitude, end.latitude)) || {
    properties: {
      BoroName: '(unknown borough)',
    },
  };

  return boroughPolygon.properties.BoroName;
}

const getBoroNameMemoized = mem(getBoroName, {
  cacheKey: ({ lookup, end }) => !!lookup + JSON.stringify(end),
});

function getCompassBearing({ lookup, start, end }) {
  let rhumbLineBearing = geolib.getRhumbLineBearing(start, end);
  const startBoroName = getBoroNameMemoized({ lookup, end: start });
  const endBoroName = getBoroNameMemoized({ lookup, end });
  const useManhattanCompass =
    startBoroName === endBoroName && endBoroName === 'Manhattan';
  if (useManhattanCompass) {
    rhumbLineBearing -= 29; // http://gothamist.com/2006/03/30/map_of_the_day_41.php
  }
  let compassBearing = d2d(rhumbLineBearing);
  if (useManhattanCompass) {
    compassBearing = `"Manhattan ${compassBearing}"`;
  }
  return compassBearing;
}

export function ElectriCitibikeList({
  data,
  latitude,
  longitude,
  updatedAt,
  boroughBoundariesFeatureCollection,
}) {
  let lookup;
  if (boroughBoundariesFeatureCollection) {
    console.time('new PolygonLookup'); // eslint-disable-line no-console
    lookup = new PolygonLookup(boroughBoundariesFeatureCollection);
    console.timeEnd('new PolygonLookup'); // eslint-disable-line no-console
  }

  const ebikeStations = data.features
    .filter(f => f.properties.ebikes_available > 0)
    .map(f => {
      const { coordinates } = f.geometry;
      const start = { latitude, longitude };
      const end = {
        latitude: coordinates[1],
        longitude: coordinates[0],
      };
      let dist = 'unknown distance';
      let distMeters;
      let compassBearing;
      if (start.latitude && start.longitude) {
        dist = humanizeDistance(start, end, 'en-US', 'us');
        distMeters = geodist(start, end, { unit: 'meters', exact: true });
        compassBearing = getCompassBearing({ lookup, start, end });
      }

      const BoroName = getBoroNameMemoized({ lookup, end });

      return {
        ...f.properties,
        latitude: end.latitude,
        longitude: end.longitude,
        dist,
        distMeters,
        BoroName,
        compassBearing,
      };
    });

  ebikeStations.sort((a, b) => a.distMeters - b.distMeters);
  const humanDate = strftime('%r', new Date(updatedAt));
  const totalEbikesAvailable = ebikeStations
    .map(station => station.ebikes_available)
    .reduce((a, b) => a + b, 0);
  return (
    <>
      {totalEbikesAvailable} available as of {humanDate}
      {ebikeStations.map(station => (
        <details key={station.name} style={{ margin: '1rem 0' }}>
          <summary>
            {station.ebikes_available} @&nbsp;
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={getMapUrl({ station, latitude, longitude })}
            >
              {station.name}, {station.BoroName}
            </a>
            <br />
            (about {Math.ceil(station.distMeters / 80)} blocks{' '}
            {station.compassBearing} of you)
            <br />
            Max Charge:{' '}
            {Math.max(
              (station.ebikes || [{ charge: 0 }]).map(ebike => ebike.charge),
            ) || '?'}/4
          </summary>
          <ul>
            {station.ebikes &&
              station.ebikes.map(ebike => (
                <li key={ebike.bike_number}>
                  {`#${ebike.bike_number}`} has {ebike.charge}/4 charge
                </li>
              ))}
          </ul>
        </details>
      ))}
    </>
  );
}

export default withStyles(marx, s)(ElectriCitibikes);
