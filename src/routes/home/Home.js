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
import axios from 'axios';
import promisedLocation from 'promised-location';
import { compose, withProps } from 'recompose';
import {
  withScriptjs,
  withGoogleMap,
  GoogleMap,
  Marker,
} from 'react-google-maps';

import s from './Home.css';

class Home extends React.Component {
  state = {
    lat: 40.7128,
    lng: -74.006,
  };

  componentDidMount() {
    this.setCreateDate({ CreateDateJs: new Date() });
    promisedLocation().then(({ coords: { latitude: lat, longitude: lng } }) => {
      this.setState({ lat, lng });
    });
  }

  setCreateDate = ({ CreateDateJs }) => {
    this.setState({
      CreateDate: CreateDateJs.toISOString().replace(/\..*/g, ''),
    });
  };

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  handleChange = async (_, results) => {
    for (const result of results) {
      const [, file] = result;
      try {
        const image = await promisify(toBuffer)(file); // eslint-disable-line no-await-in-loop
        this.extractPlate({ image });
        const exifData = await promisify(ExifImage)({ image }); // eslint-disable-line no-await-in-loop

        console.info(JSON.stringify(exifData, null, 2)); // Do something with your data!

        this.extractLocation({ exifData });
        this.extractDate({ exifData });
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
    }
  };

  // adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
  extractPlate = async ({ image }) => {
    const imageBytes = image.toString('base64'); // {String} The image file that you wish to analyze encoded in base64

    const country = 'us'; // {String} Defines the training data used by OpenALPR.  \"us\" analyzes  North-American style plates.  \"eu\" analyzes European-style plates.  This field is required if using the \"plate\" task  You may use multiple datasets by using commas between the country  codes.  For example, 'au,auwide' would analyze using both the  Australian plate styles.  A full list of supported country codes  can be found here https://github.com/openalpr/openalpr/tree/master/runtime_data/config

    const opts = {
      recognizeVehicle: 0, // {Integer} If set to 1, the vehicle will also be recognized in the image This requires an additional credit per request
      state: 'ny', // {String} Corresponds to a US state or EU country code used by OpenALPR pattern  recognition.  For example, using \"md\" matches US plates against the  Maryland plate patterns.  Using \"fr\" matches European plates against  the French plate patterns.
      returnImage: 0, // {Integer} If set to 1, the image you uploaded will be encoded in base64 and  sent back along with the response
      topn: 10, // {Integer} The number of results you would like to be returned for plate  candidates and vehicle classifications
      prewarp: '', // {String} Prewarp configuration is used to calibrate the analyses for the  angle of a particular camera.  More information is available here http://doc.openalpr.com/accuracy_improvements.html#calibration
    };

    const { data } = await axios.post('/openalpr', {
      imageBytes,
      country,
      opts,
    });
    console.info(`API called successfully. Returned data: ${data}`);
    const { plate } = data.results[0];
    this.setState({ plate });
  };

  extractDate = ({ exifData }) => {
    const { exif: { CreateDate } } = exifData;
    const CreateDateJs = new Date(
      CreateDate.replace(':', '/').replace(':', '/'),
    );
    console.info(JSON.stringify(CreateDateJs, null, 2)); // Do something with your data!

    this.setCreateDate({ CreateDateJs });
  };

  extractLocation = ({ exifData }) => {
    const { gps } = exifData;
    console.info(JSON.stringify(gps, null, 2)); // Do something with your data!
    // below adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
    let lat = gps.GPSLatitude;
    let lng = gps.GPSLongitude;

    // Convert coordinates to WGS84 decimal
    const latRef = gps.GPSLatitudeRef || 'N';
    const lngRef = gps.GPSLongitudeRef || 'W';
    lat = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === 'N' ? 1 : -1);
    lng = (lng[0] + lng[1] / 60 + lng[2] / 3600) * (lngRef === 'W' ? -1 : 1);
    // above adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
    console.info(JSON.stringify({ lat, lng }, null, 2));
    this.setState({ lat, lng });
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

          {/* <p>Cab Color: TODO yellow/green/black radio buttons</p> */}
          <p>License/Medallion: {this.state.plate}</p>
          {/*
          <p>I was: TODO cyclist/walker/passenger dropdown</p>
          <p>Type: TODO dropdown from native app</p>
          */}
          <p>
            Where: {this.state.lat}, {this.state.lng}
            <MyMapComponent
              key="map"
              position={{
                lat: this.state.lat,
                lng: this.state.lng,
              }}
              onRef={mapRef => {
                this.mapRef = mapRef;
              }}
              onCenterChanged={() => {
                const lat = this.mapRef.getCenter().lat();
                const lng = this.mapRef.getCenter().lng();
                this.setState({ lat, lng });
              }}
            />
            {/* TODO reverse geocode, allow edits */}
          </p>
          <p>
            {/* TODO use local timezone */}
            When (UTC):{' '}
            <input
              type="datetime-local"
              value={this.state.CreateDate}
              onChange={event => {
                this.setState({ CreateDate: event.target.value });
              }}
            />
          </p>
          {/*
          <p>Description: TODO text box</p>
          <p>
            TODO checkbox: Allow the photo, description, category, and location
            to be publicly displayed
          </p>
          <p>TODO submit button</p>
          */}
        </div>
      </div>
    );
  }
}

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';
const MyMapComponent = compose(
  withProps({
    googleMapURL: `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.exp&libraries=geometry,drawing,places`,
    loadingElement: <div style={{ height: `100%` }} />,
    containerElement: <div style={{ height: `400px` }} />,
    mapElement: <div style={{ height: `100%` }} />,
  }),
  withScriptjs,
  withGoogleMap,
)(props => {
  const { position, onRef, onCenterChanged } = props;

  return (
    <GoogleMap
      defaultZoom={16}
      center={position}
      ref={onRef}
      onCenterChanged={onCenterChanged}
    >
      <Marker position={position} />
    </GoogleMap>
  );
});

export default withStyles(s)(Home);
