import React from 'react';
import { CSVLink } from 'react-csv';
import SubmissionDetails from './SubmissionDetails';

const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

class PreviousSubmissionsList extends React.Component {
  shouldComponentUpdate(nextProps) {
    return (
      this.props.submissions !== nextProps.submissions ||
      this.props.onDeleteSubmission !== nextProps.onDeleteSubmission
    );
  }

  render() {
    const { submissions, onDeleteSubmission } = this.props;

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

export default PreviousSubmissionsList;
