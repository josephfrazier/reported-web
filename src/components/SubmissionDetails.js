import React from 'react';
import PropTypes from 'prop-types';
import Loadable from 'react-loadable';
import axios from 'axios';
import humanizeString from 'humanize-string';

class SubmissionDetails extends React.Component {
  constructor(props) {
    super(props);

    const { isDetailsOpen } = props;

    this.state = {
      isDetailsOpen,
    };
  }

  render() {
    const {
      reqnumber,
      medallionNo,
      typeofcomplaint,
      timeofreport,

      photoData0,
      photoData1,
      photoData2,

      videoData0,
      videoData1,
      videoData2,
    } = this.props.submission;

    const humanTimeString = new Date(timeofreport).toLocaleString();

    const ImagesAndVideos = () => {
      const images = [photoData0, photoData1, photoData2]
        .filter(item => !!item)
        .map((photoData, i) => {
          const { url } = photoData;
          return (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt={`#${i}`} />
            </a>
          );
        });

      const videos = [videoData0, videoData1, videoData2]
        .filter(item => !!item)
        .map((videoData, i) => {
          const url = videoData;
          return (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={url} alt={`#${i}`} />
            </a>
          );
        });

      return (
        <React.Fragment>
          {images}
          {videos}
        </React.Fragment>
      );
    };

    const LoadableServiceRequestStatus = Loadable({
      loader: () =>
        axios.get(`/srlookup/${reqnumber}`).then(({ data }) => () => {
          const { error, threeOneOneSRLookupResponse } = data;
          if (error) {
            const { errorMessage, errorCode } = error;
            return `${errorMessage} (error code ${errorCode})`;
          }

          const items = Object.entries(threeOneOneSRLookupResponse[0]).map(
            ([key, value]) => (
              <React.Fragment key={key}>
                <dt>{humanizeString(key)}:</dt>
                <dd>
                  {key.endsWith('Date') ? new Date(value).toString() : value}
                </dd>
              </React.Fragment>
            ),
          );
          return <dl>{items}</dl>;
        }),
      loading: () => 'Loading Service Request Status...',
    });

    return (
      <details
        open={this.state.isDetailsOpen}
        onToggle={evt => {
          this.setState({
            isDetailsOpen: evt.target.open,
          });
        }}
      >
        <summary>
          {medallionNo} {typeofcomplaint} on {humanTimeString}
        </summary>

        {this.state.isDetailsOpen && (
          <React.Fragment>
            <ImagesAndVideos />

            {!reqnumber.startsWith('N/A') && (
              <div>
                <LoadableServiceRequestStatus />
              </div>
            )}
          </React.Fragment>
        )}
      </details>
    );
  }
}

SubmissionDetails.propTypes = {
  isDetailsOpen: PropTypes.bool,
  submission: PropTypes.shape({
    reqnumber: PropTypes.string,
    medallionNo: PropTypes.string,
    typeofcomplaint: PropTypes.string,
    timeofreport: PropTypes.string,

    photoData0: PropTypes.object,
    photoData1: PropTypes.object,
    photoData2: PropTypes.object,

    videoData0: PropTypes.string,
    videoData1: PropTypes.string,
    videoData2: PropTypes.string,
  }).isRequired,
};

SubmissionDetails.defaultProps = {
  isDetailsOpen: false,
};

export default SubmissionDetails;
