/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import '@babel/polyfill';
import React from 'react';
import renderer from 'react-test-renderer';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import App from '../../components/App.js';
import Home from './Home.js';
import boroughBoundariesFeatureCollection from '../../../public/borough-boundaries-clipped-to-shoreline.geo.json';

jest.mock(
  'react-modal',
  () =>
    ({ children, isOpen }) =>
      isOpen ? children : null,
);

require('timezone-mock').register('US/Eastern');
require('jest-mock-now')();

const typeofcomplaintValues = [
  'Blocked the bike lane',
  'Blocked the crosswalk',
  'Drove recklessly',
  'Parked illegally',
  'Ran a red light or stop sign',
];

const insertCss = () => {};

function renderHome({ initialState, homeRef } = {}) {
  return renderer.create(
    <StyleContext.Provider value={{ insertCss }}>
      <App context={{ fetch: () => {}, pathname: '' }}>
        <Home
          ref={homeRef}
          initialState={initialState}
          typeofcomplaintValues={typeofcomplaintValues}
          boroughBoundariesFeatureCollection={
            boroughBoundariesFeatureCollection
          }
        />
      </App>
    </StyleContext.Provider>,
  );
}

describe('Home', () => {
  test('renders submission form and Previous Submissions when logged in with photos', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
      });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('hides form fields when logged in with no photos uploaded', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const tree = renderHome({ initialState });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('renders auth prompt and hides form when logged out', () => {
    const tree = renderHome();

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('renders Log In modal UI', () => {
    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        isAuthModalOpen: true,
        authModalTab: 'login',
      });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('renders Sign Up modal UI', () => {
    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        isAuthModalOpen: true,
        authModalTab: 'signup',
        isPasswordRevealed: true,
      });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('renders with undefined allPlateResults and photos', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        allPlateResults: undefined,
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
      });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('renders with allPlateResults entry missing plate and photos', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    // Entry exists but has no .plate — .toUpperCase() on undefined throws
    renderer.act(() => {
      homeRef.current.setState({
        allPlateResults: [{ region: {} }],
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
      });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('renders plate overlays on uploaded images and selects plate on click', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
        plateDataByAttachmentName: {
          'photo.jpg': {
            results: [
              {
                plate: 'abc123',
                region: { code: 'us-ny' },
                box: { xmin: 100, ymin: 200, xmax: 300, ymax: 250 },
              },
            ],
            image_width: 1000,
            image_height: 500,
          },
        },
      });
    });

    const overlay = tree.root.findByProps({
      'aria-label': 'Select license plate ABC123',
    });
    expect(overlay.props.className).toBe('plate-overlay');
    expect(overlay.props.style).toEqual({
      left: '10%',
      top: '40%',
      width: '20%',
      height: '10%',
    });
    expect(overlay.props.children.props.className).toBe(
      'plate-overlay-tooltip',
    );
    expect(overlay.props.children.props.children).toEqual(['ABC123', ' (NY)']);

    renderer.act(() => {
      overlay.props.onClick();
    });
    expect(homeRef.current.state.plate).toBe('ABC123');
    expect(homeRef.current.state.licenseState).toBe('NY');

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('renders Edit Profile UI', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({ isEditProfileOpen: true });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('shows loading summary and auto-load checkbox when refreshing cached submissions', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const homeRef = React.createRef();
    const tree = renderHome({ initialState, homeRef });
    renderer.act(() => {
      homeRef.current.setState({
        submissions: [{ objectId: 'cached-1' }, { objectId: 'cached-2' }],
        isPreviousSubmissionsLoading: true,
        hasLoadedPreviousSubmissions: true,
        isPreviousSubmissionsOpen: true,
      });
    });

    expect(homeRef.current.getPreviousSubmissionsSummary()).toBe(
      '2, loading...',
    );
    expect(
      tree.root.findByProps({ id: 'isLoadPreviousSubmissionsEnabled' }),
    ).toBeTruthy();

    renderer.act(() => {
      homeRef.current.setState({ isPreviousSubmissionsLoading: false });
    });
    expect(homeRef.current.getPreviousSubmissionsSummary()).toBe(2);

    tree.unmount();
  });
});
