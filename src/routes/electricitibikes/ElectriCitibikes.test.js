/* eslint-env jest */
/* eslint-disable padded-blocks, no-unused-expressions */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import { ElectriCitibikeList } from './ElectriCitibikes';

import {
  data,
  latitude,
  longitude,
  updatedAt,
  boroughBoundariesFeatureCollection,
} from './test_state';

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
          boroughBoundariesFeatureCollection={
            boroughBoundariesFeatureCollection
          }
        />,
      )
      .toJSON();

    expect(wrapper).toMatchSnapshot();
  });
});
