import React from 'react';
import PropTypes from 'prop-types';
import Loadable from 'react-loadable';
import axios from 'axios';

class SubmissionDetails extends React.Component {
  constructor(props) {
    super(props);

    const { isDetailsOpen } = props;

    this.state = {
      isDetailsOpen,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.props.submission !== nextProps.submission ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission ||
      this.props.onEditSubmission !== nextProps.onEditSubmission ||
      this.state.isDetailsOpen !== nextState.isDetailsOpen
    );
  }

  render() {
    const {
      medallionNo,
      license,
      state: licenseState,
      typeofcomplaint,
      loc1_address, // eslint-disable-line camelcase
      timeofreport,
      reportDescription,
      status,
      reqnumber,

      photoData,
      photoData0,
      photoData1,
      photoData2,

      videoData0,
      videoData1,
      videoData2,

      objectId,
      tasks,
    } = this.props.submission;

    const humanTimeString = new Date(timeofreport).toLocaleString();

    const tlcTask = (tasks || []).find(
      task => task.action === 'submit 311 complaint',
    );
    const tlcCaseId = tlcTask
      ? tlcTask.case_id
      : tasks?.length === 0 &&
        reqnumber !== 'N/A until submitted to 311' &&
        reqnumber;

    const nypdTask = (tasks || []).find(
      task => task.action === 'submit 311 illegal parking complaint',
    );
    const nypdCaseId = nypdTask && nypdTask.case_id;

    const ImagesAndVideos = () => {
      const images = [photoData, photoData0, photoData1, photoData2]
        .filter(item => !!item)
        .map((photoDataItem, i) => {
          const { url } = photoDataItem;
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

    const makeLoadableSrStatus = caseId =>
      Loadable({
        loader: () =>
          axios.get(`/srlookup/${caseId}`).then(({ data }) => () => {
            const items = Object.entries(data).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key}:</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ));
            return <dl>{items}</dl>;
          }),
        loading: () => 'Loading Service Request Status...',
      });

    const hasSrStatus = status !== 0 && (tlcCaseId || nypdCaseId);

    // A submission the backend has taken up is too late to delete, even
    // before its case number arrives: a task record is what says so.
    const hasGoneTo311 =
      (status != null && Number(status) !== 0) ||
      (tasks || []).length > 0 ||
      (reqnumber && reqnumber !== 'N/A until submitted to 311');

    const srStatus = () => {
      if (!hasSrStatus) {
        return null;
      }
      const TlcStatus = tlcCaseId && makeLoadableSrStatus(tlcCaseId);
      const NypdStatus = nypdCaseId && makeLoadableSrStatus(nypdCaseId);
      return (
        <React.Fragment>
          {TlcStatus && (
            <div>
              <strong>TLC Service Request:</strong>
              <TlcStatus />
            </div>
          )}
          {NypdStatus && (
            <div>
              <strong>NYPD Service Request:</strong>
              <NypdStatus />
            </div>
          )}
        </React.Fragment>
      );
    };

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
          {medallionNo || license}
          {licenseState ? ` (${licenseState})` : ''} {typeofcomplaint} near{' '}
          {/* eslint-disable-next-line camelcase */}
          {(loc1_address || '').split(',')[0]} on {humanTimeString}
          {!hasGoneTo311 && (
            <React.Fragment>
              {' '}
              <button
                type="button"
                title="Edit Submission"
                style={{
                  margin: '1px',
                  background: 'white',
                }}
                onClick={evt => {
                  // Do not let the click also toggle the <details> open.
                  evt.preventDefault();
                  this.props.onEditSubmission(this.props.submission);
                }}
              >
                <span role="img" aria-label="Edit Submission">
                  ✏️
                </span>
              </button>
              <button
                type="button"
                title="Delete Submission"
                style={{
                  margin: '1px',
                  color: 'red', // Ubuntu Chrome shows black otherwise
                  background: 'white',
                }}
                onClick={evt => {
                  // Do not let the click also toggle the <details> open.
                  evt.preventDefault();
                  this.props.onDeleteSubmission({ objectId });
                }}
              >
                <span role="img" aria-label="Delete Submission">
                  ❌
                </span>
              </button>
            </React.Fragment>
          )}
          {tlcCaseId && (
            <React.Fragment>
              <br />
              TLC Service Request Number:{' '}
              <a
                href={`https://portal.311.nyc.gov/sr-details/?srnum=${tlcCaseId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tlcCaseId}
              </a>
            </React.Fragment>
          )}
          {nypdCaseId && (
            <React.Fragment>
              <br />
              NYPD SR #:{' '}
              <a
                href={`https://portal.311.nyc.gov/sr-details/?srnum=${nypdCaseId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {nypdCaseId}
              </a>
            </React.Fragment>
          )}
        </summary>

        {this.state.isDetailsOpen && (
          <React.Fragment>
            <p>{reportDescription}</p>
            <ImagesAndVideos />

            {srStatus()}
          </React.Fragment>
        )}
      </details>
    );
  }
}

SubmissionDetails.propTypes = {
  isDetailsOpen: PropTypes.bool,
  onDeleteSubmission: PropTypes.func.isRequired,
  onEditSubmission: PropTypes.func.isRequired,
  submission: PropTypes.shape({
    medallionNo: PropTypes.string,
    license: PropTypes.string,
    state: PropTypes.string,
    typeofcomplaint: PropTypes.string,
    loc1_address: PropTypes.string,
    timeofreport: PropTypes.string,
    reportDescription: PropTypes.string,
    status: PropTypes.number,
    reqnumber: PropTypes.string,

    photoData: PropTypes.object,
    photoData0: PropTypes.object,
    photoData1: PropTypes.object,
    photoData2: PropTypes.object,

    videoData0: PropTypes.string,
    videoData1: PropTypes.string,
    videoData2: PropTypes.string,

    objectId: PropTypes.string,
    tasks: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
};

SubmissionDetails.defaultProps = {
  isDetailsOpen: false,
};

export default SubmissionDetails;
