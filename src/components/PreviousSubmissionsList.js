import React from 'react';
import PropTypes from 'prop-types';
import { CSVLink } from 'react-csv';
import SubmissionDetails from './SubmissionDetails.js';

const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

class PreviousSubmissionsList extends React.Component {
  shouldComponentUpdate(nextProps) {
    return (
      this.props.submissions !== nextProps.submissions ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission ||
      this.props.isLoading !== nextProps.isLoading ||
      this.props.hasLoadedPreviousSubmissions !==
        nextProps.hasLoadedPreviousSubmissions
    );
  }

  render() {
    const {
      submissions,
      onDeleteSubmission,
      isLoading,
      hasLoadedPreviousSubmissions,
    } = this.props;

    if (isLoading) {
      return 'Loading submissions...';
    }

    if (hasLoadedPreviousSubmissions && submissions.length === 0) {
      return 'No previous submissions found.';
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
      </>
    );
  }
}

PreviousSubmissionsList.propTypes = {
  hasLoadedPreviousSubmissions: PropTypes.bool.isRequired,
  isLoading: PropTypes.bool.isRequired,
  submissions: PropTypes.arrayOf(
    PropTypes.shape({
      objectId: PropTypes.string,
    }),
  ).isRequired,
  onDeleteSubmission: PropTypes.func.isRequired,
};

export default PreviousSubmissionsList;
