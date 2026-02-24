import React from 'react';
import PropTypes from 'prop-types';
import { compose, withProps } from 'recompose';
import {
  withScriptjs,
  withGoogleMap,
  GoogleMap,
  Marker,
  InfoWindow,
} from 'react-google-maps';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

const defaultCenter = { lat: 40.7128, lng: -74.006 };

class SubmissionsMapPure extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      openMarkerId: null,
    };
  }

  render() {
    const { submissions } = this.props;
    const { openMarkerId } = this.state;

    const validSubmissions = submissions.filter(s => s.latitude && s.longitude);

    const center =
      validSubmissions.length > 0
        ? {
            lat: validSubmissions[0].latitude,
            lng: validSubmissions[0].longitude,
          }
        : defaultCenter;

    return (
      <GoogleMap
        defaultZoom={13}
        defaultCenter={center}
        options={{ mapTypeControl: false, gestureHandling: 'greedy' }}
      >
        {validSubmissions.map(submission => {
          const position = {
            lat: submission.latitude,
            lng: submission.longitude,
          };
          const label = submission.medallionNo || submission.license || '';
          const streetAddress = (submission.loc1_address || '').split(',')[0];
          const reportTime = new Date(submission.timeofreport).toLocaleString();

          return (
            <Marker
              key={submission.objectId}
              position={position}
              onClick={() =>
                this.setState({ openMarkerId: submission.objectId })
              }
            >
              {openMarkerId === submission.objectId && (
                <InfoWindow
                  onCloseClick={() => this.setState({ openMarkerId: null })}
                >
                  <div>
                    <strong>{label}</strong> {submission.typeofcomplaint}
                    <br />
                    {streetAddress}
                    <br />
                    {reportTime}
                  </div>
                </InfoWindow>
              )}
            </Marker>
          );
        })}
      </GoogleMap>
    );
  }
}

SubmissionsMapPure.propTypes = {
  submissions: PropTypes.arrayOf(
    PropTypes.shape({
      objectId: PropTypes.string,
      latitude: PropTypes.number,
      longitude: PropTypes.number,
      medallionNo: PropTypes.string,
      license: PropTypes.string,
      typeofcomplaint: PropTypes.string,
      loc1_address: PropTypes.string,
      timeofreport: PropTypes.string,
    }),
  ).isRequired,
};

const SubmissionsMap = compose(
  withProps({
    googleMapURL: `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.exp&libraries=geometry,drawing,places`,
    loadingElement: <div style={{ height: `100%` }} />,
    containerElement: <div style={{ height: `400px` }} />,
    mapElement: <div style={{ height: `100%` }} />,
  }),
  withScriptjs,
  withGoogleMap,
)(SubmissionsMapPure);

export default SubmissionsMap;
