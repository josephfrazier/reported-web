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

function renderHome({ localStorageKey, homeRef } = {}) {
  return renderer.create(
    <StyleContext.Provider value={{ insertCss }}>
      <App context={{ fetch: () => {}, pathname: '' }}>
        <Home
          ref={homeRef}
          localStorageKey={localStorageKey}
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
  test('renders submission form and Previous Submissions when logged in', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    let tree;
    renderer.act(() => {
      tree = renderHome({ localStorageKey: storageKey });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    localStorage.removeItem(storageKey);
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

  test('renders with undefined allPlateResults', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ localStorageKey: storageKey, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({ allPlateResults: undefined });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    localStorage.removeItem(storageKey);
  });

  test('renders with allPlateResults entry missing plate', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ localStorageKey: storageKey, homeRef });
    });
    // Entry exists but has no .plate — .toUpperCase() on undefined throws
    renderer.act(() => {
      homeRef.current.setState({ allPlateResults: [{ region: {} }] });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    localStorage.removeItem(storageKey);
  });

  test('renders plate overlays on uploaded images and selects plate on click', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ localStorageKey: storageKey, homeRef });
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
    expect(overlay.props.className).toBe('plateOverlay');
    expect(overlay.props.style).toEqual({
      left: '10%',
      top: '40%',
      width: '20%',
      height: '10%',
    });
    expect(overlay.props.children.props.className).toBe('plateOverlayTooltip');
    expect(overlay.props.children.props.children).toEqual(['ABC123', ' (NY)']);

    renderer.act(() => {
      overlay.props.onClick();
    });
    expect(homeRef.current.state.plate).toBe('ABC123');
    expect(homeRef.current.state.licenseState).toBe('NY');

    tree.unmount();
    localStorage.removeItem(storageKey);
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('renders Edit Profile UI', () => {
    const storageKey = 'reportedWebHomeState';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        email: 'test@example.com',
        loginSuccessful: true,
      }),
    );

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ localStorageKey: storageKey, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({ isEditProfileOpen: true });
    });

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
    localStorage.removeItem(storageKey);
  });
});
