/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import promisify from 'util.promisify';

import React from 'react';
import withStyles from 'isomorphic-style-loader/lib/withStyles';
import FileReaderInput from 'react-file-reader-input';
import toBuffer from 'blob-to-buffer';
import { ExifImage } from 'exif';
import s from './Home.css';

class Home extends React.Component {
  state = {};

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  handleChange = async (_, results) => {
    for (const result of results) {
      const [, file] = result;
      try {
        const image = await promisify(toBuffer)(file); // eslint-disable-line no-await-in-loop
        const exifData = await promisify(ExifImage)({ image }); // eslint-disable-line no-await-in-loop

        console.info(JSON.stringify(exifData, null, 2)); // Do something with your data!

        this.extractLocation({ exifData });
        this.extractDate({ exifData });
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
    }
  };

  extractDate = ({ exifData }) => {
    const { exif: { CreateDate } } = exifData;
    const CreateDateJs = new Date(
      CreateDate.replace(':', '/').replace(':', '/'),
    );
    console.info(JSON.stringify(CreateDateJs, null, 2)); // Do something with your data!

    this.setState({ CreateDate: CreateDateJs.toString() });
  };

  extractLocation = ({ exifData }) => {
    const { gps } = exifData;
    console.info(JSON.stringify(gps, null, 2)); // Do something with your data!
    // below adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
    let lat = gps.GPSLatitude;
    let lon = gps.GPSLongitude;

    // Convert coordinates to WGS84 decimal
    const latRef = gps.GPSLatitudeRef || 'N';
    const lonRef = gps.GPSLongitudeRef || 'W';
    lat = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === 'N' ? 1 : -1);
    lon = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (lonRef === 'W' ? -1 : 1);
    // above adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
    console.info(JSON.stringify({ lat, lon }, null, 2));
    this.setState({ lat, lon });
  };

  render() {
    return (
      <div className={s.root}>
        <div className={s.container}>
          <br />

          <FileReaderInput
            accept="image/*"
            as="buffer"
            onChange={this.handleChange}
          >
            <button>Select/Take a picture</button>
          </FileReaderInput>

          <p>Cab Color: TODO yellow/green/black radio buttons</p>
          <p>License/Medallion: TODO input, openALPR</p>
          <p>I was: TODO cyclist/walker/passenger dropdown</p>
          <p>Type: TODO dropdown from native app</p>
          <p>
            Where: {this.state.lat}, {this.state.lon} TODO reverse geocode,
            allow edits
          </p>
          <p>When: {this.state.CreateDate} TODO allow edits</p>
          <p>Description: TODO text box</p>
          <p>
            TODO checkbox: Allow the photo, description, category, and location
            to be publicly displayed
          </p>
          <p>TODO submit button</p>
        </div>
      </div>
    );
  }
}

export default withStyles(s)(Home);
