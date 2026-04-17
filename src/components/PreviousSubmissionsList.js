import React from 'react';
import PropTypes from 'prop-types';
import { CSVLink } from 'react-csv';
import SubmissionDetails from './SubmissionDetails.js';
import SubmissionsMap from './SubmissionsMap.js';

const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

class PreviousSubmissionsList extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showMap: false,
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.props.submissions !== nextProps.submissions ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission ||
      this.state.showMap !== nextState.showMap
    );
  }

  render() {
    const { submissions, onDeleteSubmission } = this.props;
    const { showMap } = this.state;

    if (submissions.length === 0) {
      return 'Loading submissions...';
    }

    return (
      <>
        <CSVLink
          separator="	"
          data={submissions.map(submission =>
            objectMap(submission, value =>
              typeof value === 'object' ? JSON.stringify(value) : value,
            ),
          )}
        >
          Download as CSV
        </CSVLink>
        {' | '}
        <button
          type="button"
          onClick={() => this.setState(state => ({ showMap: !state.showMap }))}
        >
          {showMap ? 'List View' : 'Map View'}
        </button>
        {showMap ? (
          <SubmissionsMap submissions={submissions} />
        ) : (
          <ul>
            {submissions.map(submission => (
              <li key={submission.objectId}>
                <SubmissionDetails
                  submission={submission}
                  onDeleteSubmission={onDeleteSubmission}
                />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
}

PreviousSubmissionsList.propTypes = {
  submissions: PropTypes.arrayOf(
    PropTypes.shape({
      objectId: PropTypes.string,
    }),
  ).isRequired,
  onDeleteSubmission: PropTypes.func.isRequired,
};

export default PreviousSubmissionsList;
