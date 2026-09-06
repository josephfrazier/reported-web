import React from 'react';
import SubmissionsMap from './SubmissionsMap.js';
import Layout from '../../components/Layout/Layout.js';

function action() {
  return {
    title: 'Complaint Map',
    chunks: ['submissions-map'],
    component: (
      <Layout>
        <SubmissionsMap />
      </Layout>
    ),
  };
}

export default action;
