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
      loc1_address, // eslint-disable-line camelcase
      timeofreport,
      reportDescription,
      status,

      photoData0,
      photoData1,
      photoData2,

      videoData0,
      videoData1,
      videoData2,

      objectId,
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

    const srStatusOrDeleteButton = () =>
      (status !== 0 && (
        <div>
          <LoadableServiceRequestStatus />
        </div>
      )) || (
        <button
          type="button"
          style={{
            margin: '1px',
            color: 'red', // Ubuntu Chrome shows black otherwise
            background: 'white',
          }}
          onClick={() => {
            this.props.onDeleteSubmission({ objectId });
          }}
        >
          <span role="img" aria-label="Delete Submission">
            ❌
          </span>
          Delete Submission
        </button>
      );

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
          {medallionNo} {typeofcomplaint} near{' '}
          {/* eslint-disable-next-line camelcase */}
          {(loc1_address || '').split(',')[0]} on {humanTimeString}
          <br />
          TLC Service Request Number: {reqnumber}
        </summary>

        {this.state.isDetailsOpen && (
          <React.Fragment>
            <p>{reportDescription}</p>
            <ImagesAndVideos />

            {srStatusOrDeleteButton()}
          </React.Fragment>
        )}
      </details>
    );
  }
}

SubmissionDetails.propTypes = {
  isDetailsOpen: PropTypes.bool,
  onDeleteSubmission: PropTypes.func.isRequired,
  submission: PropTypes.shape({
    reqnumber: PropTypes.string,
    medallionNo: PropTypes.string,
    typeofcomplaint: PropTypes.string,
    loc1_address: PropTypes.string,
    timeofreport: PropTypes.string,
    reportDescription: PropTypes.string,
    status: PropTypes.number,

    photoData0: PropTypes.object,
    photoData1: PropTypes.object,
    photoData2: PropTypes.object,

    videoData0: PropTypes.string,
    videoData1: PropTypes.string,
    videoData2: PropTypes.string,

    objectId: PropTypes.string,
  }).isRequired,
};

SubmissionDetails.defaultProps = {
  isDetailsOpen: false,
};

export default SubmissionDetails;
