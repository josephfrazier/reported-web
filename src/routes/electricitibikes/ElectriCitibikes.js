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

import withStyles from 'isomorphic-style-loader/lib/withStyles';
import s from './ElectriCitibikes.css';

if (!global.window) {
  global.window = require('global/window'); // eslint-disable-line global-require
}
const streamdataio = require('streamdataio-js-sdk'); // eslint-disable-line global-require
const jsonpatch = require('fast-json-patch'); // eslint-disable-line global-require

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
    const appToken = 'OTY5YTM3ZmItNTA2Ni00ZThhLWJmNzItYjVmM2QwYzZlMmYy';

    const eventSource = streamdataio.createEventSource(
      'https://bikeangels-api.citibikenyc.com/map/v1/nyc/stations',
      appToken,
    );

    eventSource
      .onOpen(() => {
        console.info('streamdata Event Source connected.');
      })
      .onData(data => {
        console.info({ data });
        this.updateData({ data });
      })
      .onPatch(patch => {
        console.info({ patch });

        const data = jsonpatch.deepClone(this.state.data);
        jsonpatch.applyPatch(data, patch);
        this.updateData({ data });

        const changedEbikes = patch.filter(operation =>
          operation.path.includes('ebikes_available'),
        );
        changedEbikes.forEach(operation => {
          const { op, path, value } = operation;
          const changedStation = data.features[path.split('/')[2]].properties;
          const ebikeCount = op === 'remove' ? 0 : value;
          console.info(`${ebikeCount} ebikes at ${changedStation.name}`);
        });
      });

    // open the data stream to the REST service through streamdata.io proxy
    // eslint-disable-next-line no-underscore-dangle
    eventSource.open()._sse.addErrorListener(() => {
      window.location.reload();
    });
  }

  async updateData({ data }) {
    const updatedAt = Date.now();
    this.setState({ data, updatedAt });

    promisedLocation().then(({ coords: { latitude, longitude } }) =>
      this.setState({ latitude, longitude }),
    );
  }

  render() {
    const {
      state: { data, latitude, longitude, updatedAt },
    } = this;
    return (
      <div className={s.root}>
        <div className={s.container}>
          <h1>{this.props.title}</h1>
          <ElectriCitibikeList
            data={data}
            latitude={latitude}
            longitude={longitude}
            updatedAt={updatedAt}
          />
        </div>
      </div>
    );
  }
}

export function ElectriCitibikeList({ data, latitude, longitude, updatedAt }) {
  const stations = data.features.map(f => {
    const { coordinates } = f.geometry;
    const start = { latitude, longitude };
    const end = {
      latitude: coordinates[1],
      longitude: coordinates[0],
    };
    let dist = 'unknown distance';
    let distMeters;
    if (start.latitude && start.longitude) {
      dist = humanizeDistance(start, end, 'en-US', 'us');
      distMeters = geodist(start, end, { unit: 'meters', exact: true });
    }

    return {
      ...f.properties,
      latitude: end.latitude,
      longitude: end.longitude,
      dist,
      distMeters,
    };
  });

  const ebikeStations = stations.filter(
    station => station.ebikes_available > 0,
  );
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
              href={`https://www.google.com/maps?hl=en&q=${station.latitude},${
                station.longitude
              }`}
            >
              {station.name}
            </a>
            <br />
            ({station.dist} away, about {Math.ceil(station.distMeters / 80)}{' '}
            blocks)
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

export default withStyles(s)(ElectriCitibikes);
