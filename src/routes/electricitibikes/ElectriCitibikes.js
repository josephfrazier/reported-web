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
import 'intl/locale-data/jsonp/en.js'; // https://github.com/andyearnshaw/Intl.js/issues/271#issuecomment-292233493

import withStyles from 'isomorphic-style-loader/lib/withStyles';
import s from './ElectriCitibikes.css';

if (!global.window) {
  global.window = require('global/window'); // eslint-disable-line global-require
}
// import streamdataio from 'streamdataio-js-sdk'
const streamdataio = require('streamdataio-js-sdk'); // eslint-disable-line global-require
// import jsonpatch from 'fast-json-patch'
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
    let eventSource = null;

    const appToken = 'OTY5YTM3ZmItNTA2Ni00ZThhLWJmNzItYjVmM2QwYzZlMmYy';

    // create the StreamdataEventSource Object
    eventSource = streamdataio.createEventSource(
      'https://bikeangels-api.citibikenyc.com/map/v1/nyc/stations',
      appToken,
    );
    // eventSource = streamdataio.createEventSource("https://feeds.citibikenyc.com/stations/stations.json", appToken);

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

        // use json patch library to apply the patch (patch)
        // to the original snapshot (data)
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
      })
      .onError(error => {
        // displays the error message
        console.error(error.getMessage());
      });

    // open the data stream to the REST service through streamdata.io proxy
    eventSource.open();
  }

  async updateData({ data }) {
    this.setState({ data });

    promisedLocation().then(({ coords: { latitude, longitude } }) =>
      this.setState({ latitude, longitude }),
    );
  }

  render() {
    const stations = this.state.data.features.map(f => {
      const {
        coordinates: [longitude, latitude],
      } = f.geometry;

      const start = {
        latitude: this.state.latitude,
        longitude: this.state.longitude,
      };
      const end = { latitude, longitude };
      let dist = 'unknown distance';
      if (start.latitude && start.longitude) {
        dist = humanizeDistance(start, end, 'en-US', 'us');
      }

      return {
        ...f.properties,
        latitude,
        longitude,
        dist,
      };
    });

    const ebikeStations = stations.filter(
      station => station.ebikes_available > 0,
    );
    return (
      <div className={s.root}>
        <div className={s.container}>
          <h1>{this.props.title}</h1>
          <ul>
            {ebikeStations.map(station => (
              <li key={station.name}>
                {station.ebikes_available} @ {station.name} (<a
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.google.com/maps?hl=en&q=${
                    station.latitude
                  },${station.longitude}`}
                >
                  {station.dist} away
                </a>)
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
}

export default withStyles(s)(ElectriCitibikes);
