/* eslint-env jest */
/* eslint-disable padded-blocks, no-unused-expressions */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import { ElectriCitibikeList } from './ElectriCitibikes.js';

import { data, latitude, longitude, updatedAt } from './test_state.json';

require('timezone-mock').register('US/Eastern');

describe('ElectriCitibikeList', () => {
  test('renders children correctly', () => {
    const wrapper = renderer
      .create(
        <ElectriCitibikeList
          data={data}
          latitude={latitude}
          longitude={longitude}
          updatedAt={updatedAt}
        />,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});
