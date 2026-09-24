/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import renderer from 'react-test-renderer';
// jsdom doesn't provide the setImmediate global, so use Node's directly.
import { setImmediate } from 'timers';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import axios from 'axios';
import exifr from 'exifr/dist/full.umd.js';
import * as blobUtil from 'blob-util';
import { toast } from 'react-toastify';
import Modal from 'react-modal';
import App from '../../components/App.js';
import Home from './Home.js';
import boroughBoundariesFeatureCollection from '../../boroughBoundaries.js';

jest.mock('react-modal', () =>
  Object.assign(({ children, isOpen }) => (isOpen ? children : null), {
    setAppElement: jest.fn(),
  }),
);

// jest.spyOn can't replace exifr's exports: the module's properties are
// read-only under Jest (they are writable when it is required from Node
// directly). The semi-automatic mode tests set the two functions they need.
jest.mock('exifr/dist/full.umd.js', () => ({
  __esModule: true,
  default: { gps: jest.fn(), parse: jest.fn() },
}));

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

// jsdom has no navigator.geolocation, so promisedLocation() rejects and the
// component falls back to ipapi.co over the network, making these tests
// depend on a third-party service (and crash on its rate limits). Stub
// geolocation with NYC's default coordinates so the fallback is never hit.
beforeAll(() => {
  navigator.geolocation = {
    getCurrentPosition(success) {
      success({
        coords: { latitude: 40.7128, longitude: -74.006 },
      });
    },
  };
});

function renderHome({ initialState, homeRef, ...props } = {}) {
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
          {...props}
        />
      </App>
    </StyleContext.Provider>,
  );
}

// Stand-in for a text <input> DOM node: reading/writing `value` works, and
// writing it moves the caret to the end of the field, just like the real thing.
function createFakeInput({ value, caret }) {
  let currentValue = value;
  const input = {
    selectionStart: caret,
    selectionEnd: caret,
    setSelectionRange(selectionStart, selectionEnd) {
      input.selectionStart = selectionStart;
      input.selectionEnd = selectionEnd;
    },
  };
  Object.defineProperty(input, 'value', {
    get: () => currentValue,
    set: newValue => {
      currentValue = newValue;
      input.selectionStart = newValue.length;
      input.selectionEnd = newValue.length;
    },
  });
  return input;
}

// Stand-in for React re-rendering a controlled input: it writes to the DOM
// node's value only when it differs from the value being rendered. That write
// is what moves the caret to the end of the field.
function reRenderControlledInput(input, value) {
  if (input.value !== value) {
    input.value = value; // eslint-disable-line no-param-reassign
  }
}

// Renders the form (which needs a photo attached) and returns the plate input.
function renderPlateInput() {
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

  return {
    homeRef,
    plateInput: tree.root.findByProps({ name: 'plate' }),
    cleanup: () => {
      tree.unmount();
      global.URL.createObjectURL = originalCreateObjectURL;
    },
  };
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

  test('shows the Parse server banner when the server enables it', () => {
    const parseServerUrl = 'https://reported-parse.webabot.com/parse';

    const tree = renderHome({
      parseServerUrl,
      showParseServerBanner: true,
    });

    // findByProps throws if the banner isn't rendered
    const banner = tree.root.findByProps({
      className: 'non-production-banner',
    });
    expect(banner.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'code',
          props: { children: parseServerUrl },
        }),
      ]),
    );

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('handles geolocation and its ipapi fallback both failing', async () => {
    const geolocationStub = navigator.geolocation;
    navigator.geolocation = {
      getCurrentPosition(success, failure) {
        failure(new Error('Geolocation permission denied'));
      },
    };
    const axiosGet = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(new Error('ipapi.co rate limited'));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // This must not leave an unhandled rejection behind.
    await renderer.act(async () => {
      await homeRef.current.geolocateAndSetCoords();
    });

    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
    axiosGet.mockRestore();
    navigator.geolocation = geolocationStub;
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

  test('tells react-modal which element holds the page content', () => {
    Modal.setAppElement.mockClear();
    let tree;
    renderer.act(() => {
      tree = renderHome();
    });

    expect(Modal.setAppElement).toHaveBeenCalledTimes(1);

    tree.unmount();
  });

  test('closes the map modal on Escape', () => {
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
        isMapOpen: true,
      });
    });

    const closeButton = tree.root.findAll(
      node => node.type === 'button' && node.props.children === 'Close',
    );
    expect(closeButton).toHaveLength(1);

    renderer.act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(homeRef.current.state.isMapOpen).toBe(false);
    expect(
      tree.root.findAll(
        node => node.type === 'button' && node.props.children === 'Close',
      ),
    ).toHaveLength(0);

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('focuses the map search input once it is in the document', () => {
    jest.useFakeTimers();
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      Home.handleSearchInputMounted(input);

      jest.advanceTimersByTime(20);

      expect(document.activeElement).toBe(input);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      document.body.removeChild(input);
    }
  });

  test('keeps retrying until the map attaches the search input', () => {
    jest.useFakeTimers();
    const input = document.createElement('input');
    try {
      Home.handleSearchInputMounted(input);

      jest.advanceTimersByTime(20); // first attempt, input not attached yet
      expect(document.activeElement).not.toBe(input);

      document.body.appendChild(input);
      jest.advanceTimersByTime(100); // next retry, input now attached

      expect(document.activeElement).toBe(input);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      document.body.removeChild(input);
    }
  });

  test('ignores the null ref the search input passes when unmounting', () => {
    jest.useFakeTimers();
    try {
      Home.handleSearchInputMounted(null);

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
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
            // No uploadWidth/uploadHeight, as in plate data cached before
            // src/alpr.js started reporting them: fall back to the API's.
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

  test('renders plate overlays on uploaded videos and selects plate on click', () => {
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
          new File(['video'], 'video.mp4', { type: 'video/mp4' }),
        ],
        plateDataByAttachmentName: {
          'video.mp4': {
            results: [
              {
                plate: 'abc123',
                region: { code: 'us-ny' },
                box: { xmin: 100, ymin: 200, xmax: 300, ymax: 250 },
              },
            ],
            // uploadWidth/uploadHeight are the screenshot frame's pixel
            // dimensions (the video's intrinsic size), so box coordinates
            // turn into percentages the same way they do for images.
            uploadWidth: 1000,
            uploadHeight: 500,
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

    renderer.act(() => {
      overlay.props.onClick();
    });
    expect(homeRef.current.state.plate).toBe('ABC123');
    expect(homeRef.current.state.licenseState).toBe('NY');

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('scrolls the License/Medallion label into view when a plate overlay is clicked', () => {
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

    // react-test-renderer doesn't attach refs to host elements, so stand in
    // for the label with a fake element that has a scrollIntoView to spy on.
    const scrollIntoView = jest.fn();
    homeRef.current.plateLabelRef.current = { scrollIntoView };

    const overlay = tree.root.findByProps({
      'aria-label': 'Select license plate ABC123',
    });
    renderer.act(() => {
      overlay.props.onClick();
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'smooth',
    });

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('skips the duplicate-submission warning and plate lookups when an overlay selects the already-selected plate', () => {
    jest.useFakeTimers();

    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    // Keep the geolocation fallback and reverse-geocoding quiet, and spy on
    // the vehicle/violation lookups an unchanged selection must not trigger.
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { features: [{ properties: {} }] } });
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({
        plate: 'ABC123',
        licenseState: 'NY',
        // A same-day submission for this plate, so selecting it again would
        // show the duplicate-submission warning without the guard.
        submissions: [
          {
            license: 'ABC123',
            timeofreport: new Date().toISOString(),
          },
        ],
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
    axiosGet.mockClear();
    axiosPost.mockClear();
    toastWarn.mockClear();

    const overlay = tree.root.findByProps({
      'aria-label': 'Select license plate ABC123',
    });
    renderer.act(() => {
      overlay.props.onClick();
    });

    expect(toastWarn).not.toHaveBeenCalled();

    // Wait out the debounce windows: had the click scheduled the
    // vehicle-type/violations lookups, they would have fired by now.
    renderer.act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(axiosGet).not.toHaveBeenCalled();

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastWarn.mockRestore();
    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('skips geosearch for the default coordinates and leaves the address empty', async () => {
    jest.useFakeTimers();

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('Request failed with status code 503'));
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // The mount-time warmup uses the default coordinates, which are a
    // fallback rather than a chosen location: no geosearch request should
    // be made, no warning should appear even though geosearch would fail
    // if it were called, and the address should stay empty so the "Where"
    // button prompts the user to pick a location.
    expect(axiosPost).not.toHaveBeenCalled();
    expect(toastWarn).not.toHaveBeenCalled();
    expect(homeRef.current.state.formatted_address).toBe('');

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastWarn.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test('warns but still allows submitting when geosearch fails', async () => {
    jest.useFakeTimers();

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('Request failed with status code 503'));
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // The user picks a location; the geosearch for it is debounced, so let
    // it fire and reject.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.7129,
        longitude: -74.0061,
      });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(toastWarn).toHaveBeenCalledWith(
      "We couldn't find the address right now, but you can still submit. The Description sent to 311 will include a Google Maps link to the location.",
      { toastId: 'geosearch-warning' },
    );
    // The "Where" button should not claim the lookup is still in progress,
    // and the submission can still proceed.
    expect(homeRef.current.state.formatted_address).toBe('');
    expect(homeRef.current.state.coordsAreInNyc).toBe(true);

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastWarn.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test('ignores a geosearch failure for coordinates the user has moved on from', async () => {
    jest.useFakeTimers();

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    let rejectGeosearch;
    const axiosPost = jest.spyOn(axios, 'post').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          rejectGeosearch = reject;
        }),
    );
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // Let the geosearch for the first location fire, then move to different
    // coordinates before its request fails.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.7129,
        longitude: -74.0061,
      });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.73,
        longitude: -74.01,
      });
    });
    await renderer.act(async () => {
      rejectGeosearch(new Error('Request failed with status code 503'));
    });

    // The failure is for coordinates the user has moved on from, so it must
    // not blank the newer lookup's in-progress address or warn about it.
    expect(toastWarn).not.toHaveBeenCalled();
    expect(homeRef.current.state.formatted_address).toBe('Finding Address...');

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastWarn.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test('reuses a reverse-geocoded address instead of asking geosearch again', async () => {
    jest.useFakeTimers();

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        features: [
          {
            properties: {
              housenumber: '123',
              street: 'Main St',
              borough: 'Manhattan',
            },
          },
        ],
      },
    });

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    const firstLocation = { latitude: 40.7129, longitude: -74.0061 };
    const secondLocation = { latitude: 40.73, longitude: -74.01 };

    renderer.act(() => {
      homeRef.current.setCoords(firstLocation);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(homeRef.current.state.formatted_address).toBe(
      '123 Main St, Manhattan',
    );
    expect(homeRef.current.geosearchAddressCache.get(firstLocation)).toBe(
      '123 Main St, Manhattan',
    );

    // Somewhere else, so a lookup that isn't memoized still goes out.
    renderer.act(() => {
      homeRef.current.setCoords(secondLocation);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(axiosPost).toHaveBeenCalledTimes(2);

    // Back to the first location. Batch mode geocodes every violation before
    // the user loads one, so returning to a location it already resolved must
    // fill the field from the memo rather than re-asking geosearch.
    renderer.act(() => {
      homeRef.current.setCoords(firstLocation);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(axiosPost).toHaveBeenCalledTimes(2);
    expect(homeRef.current.state.formatted_address).toBe(
      '123 Main St, Manhattan',
    );

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    tree.unmount();
  });

  test('still submits when geosearch fails', async () => {
    jest.useFakeTimers();

    const initialState = {
      email: 'test@example.com',
      password: 'test-password',
      loginSuccessful: true,
    };

    // The form fields (including the "Where" button) only render once a
    // photo is attached, and rendering one calls URL.createObjectURL.
    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    // The submit success path scrolls to the top of the page; the rendered
    // tree isn't attached to the jsdom document, so provide a stand-in.
    const originalQuerySelector = document.querySelector;
    document.querySelector = jest.fn(() => ({ scrollTo: jest.fn() }));

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
      if (url === '/api/geosearch') {
        return Promise.reject(new Error('Request failed with status code 503'));
      }
      return Promise.resolve({
        data: {
          submission: {
            objectId: 'objectId123',
            timeofreport: '2020-01-01T00:00:00.000Z',
            timeofreported: '2020-01-01T00:00:00.000Z',
          },
        },
      });
    });
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);
    const toastSuccess = jest
      .spyOn(toast, 'success')
      .mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });

    // Let the mount-time geolocation resolve before the user picks a
    // location; otherwise its default coordinates would overwrite theirs.
    await renderer.act(async () => {});

    // The user picks a location anyway (the map works without geosearch) and
    // fills the form; geosearch still can't resolve the address.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.7129,
        longitude: -74.0061,
      });
      homeRef.current.setState({
        plate: 'ABC123',
        reportDescription: 'The address could not be found',
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
        isAlprEnabled: false,
        isReverseGeocodingEnabled: false,
      });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    // With no address resolved, the "Where" button should prompt the user to
    // pick a location instead of showing empty text.
    expect(tree.root.findByProps({ name: 'where' }).props.children).toBe(
      'Click to choose address on map',
    );

    const form = tree.root
      .findAllByType('form')
      .find(formEl => typeof formEl.props.onSubmit === 'function');
    await renderer.act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    expect(toastWarn).toHaveBeenCalled();
    expect(axiosPost.mock.calls.some(([url]) => url === '/submit')).toBe(true);
    expect(toastSuccess).toHaveBeenCalled();

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastWarn.mockRestore();
    toastSuccess.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
    document.querySelector = originalQuerySelector;
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('restores cached vehicle/violations results when re-selecting a previously-looked-up plate', async () => {
    jest.useFakeTimers();

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    const axiosGet = jest.spyOn(axios, 'get').mockImplementation(url => {
      if (url.startsWith('/getVehicleType/')) {
        return Promise.resolve({
          data: {
            result: {
              vehicleYear: 2020,
              vehicleMake: 'Toyota',
              vehicleModel: 'Camry',
              vehicleBody: 'Sedan',
            },
          },
        });
      }
      return Promise.resolve({
        data: {
          data: [
            {
              vehicle: {
                violations: [
                  {
                    vehicle_make: 'Toyota',
                    vehicle_color: 'Blue',
                    sanitized: { vehicle_body_type: 'Sedan' },
                  },
                ],
                fines: { total_fined: 10, total_outstanding: 20 },
                tweet_parts: [],
              },
            },
          ],
        },
      });
    });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { features: [{ properties: {} }] } });

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: 'NY' });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });

    const { vehicleInfoComponent, violationSummaryComponent } =
      homeRef.current.state;
    expect(vehicleInfoComponent).not.toBe(
      'Looking up make/model for ABC123 in New York',
    );
    expect(violationSummaryComponent).not.toBe(
      'Looking up violations for ABC123 in New York',
    );

    // The cache stores the raw HTTP responses, not rendered components.
    expect(homeRef.current.plateLookupCache.get('ABC123:NY')).toEqual({
      vehicleInfoResponse: {
        result: {
          vehicleYear: 2020,
          vehicleMake: 'Toyota',
          vehicleModel: 'Camry',
          vehicleBody: 'Sedan',
        },
      },
      violationsResponse: {
        data: [
          {
            vehicle: {
              violations: [
                {
                  vehicle_make: 'Toyota',
                  vehicle_color: 'Blue',
                  sanitized: { vehicle_body_type: 'Sedan' },
                },
              ],
              fines: { total_fined: 10, total_outstanding: 20 },
              tweet_parts: [],
            },
          },
        ],
      },
    });

    // Selecting a different plate still fires fresh lookups...
    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'XYZ789', licenseState: 'NY' });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(axiosGet).toHaveBeenCalledWith('/getVehicleType/XYZ789/NY');

    axiosGet.mockClear();

    // ...but selecting a previously-looked-up plate again restores its
    // results immediately from the cache, without waiting out the debounce
    // or hitting the APIs.
    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: 'NY' });
    });
    expect(homeRef.current.state.vehicleInfoComponent).toEqual(
      vehicleInfoComponent,
    );
    expect(homeRef.current.state.violationSummaryComponent).toEqual(
      violationSummaryComponent,
    );

    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(axiosGet).not.toHaveBeenCalled();
    expect(homeRef.current.state.vehicleInfoComponent).toEqual(
      vehicleInfoComponent,
    );
    expect(homeRef.current.state.violationSummaryComponent).toEqual(
      violationSummaryComponent,
    );

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('does not cache results under plates typed while a lookup was pending', async () => {
    jest.useFakeTimers();

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    const axiosGet = jest.spyOn(axios, 'get').mockImplementation(url => {
      if (url.startsWith('/getVehicleType/')) {
        return Promise.resolve({
          data: {
            result: {
              vehicleYear: 2020,
              vehicleMake: 'Toyota',
              vehicleModel: 'Camry',
              vehicleBody: 'Sedan',
            },
          },
        });
      }
      return Promise.resolve({
        data: {
          data: [
            {
              vehicle: {
                violations: [
                  {
                    vehicle_make: 'Toyota',
                    vehicle_color: 'Blue',
                    sanitized: { vehicle_body_type: 'Sedan' },
                  },
                ],
                fines: { total_fined: 10, total_outstanding: 20 },
                tweet_parts: [],
              },
            },
          ],
        },
      });
    });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { features: [{ properties: {} }] } });

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // Type TEST quickly: the debounced lookups fire once, for TEST, but the
    // intermediate T/TE/TES selections share that lookup's promise.
    for (const plate of ['T', 'TE', 'TES', 'TEST']) {
      renderer.act(() => {
        homeRef.current.setLicensePlate({ plate, licenseState: 'NY' });
      });
    }
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(homeRef.current.plateLookupCache.has('TEST:NY')).toBe(true);
    expect(homeRef.current.plateLookupCache.has('TES:NY')).toBe(false);
    expect(homeRef.current.plateLookupCache.has('TE:NY')).toBe(false);
    expect(homeRef.current.plateLookupCache.has('T:NY')).toBe(false);

    // Deleting back through the intermediate plates shows "Looking up..."
    // instead of restoring TEST's results.
    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'TES', licenseState: 'NY' });
    });
    expect(homeRef.current.state.vehicleInfoComponent).toBe(
      'Looking up make/model for TES in New York',
    );
    expect(homeRef.current.state.violationSummaryComponent).toBe(
      'Looking up violations for TES in New York',
    );

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('reuses the cached empty vehicle response when re-selecting a partial plate', async () => {
    jest.useFakeTimers();

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    const axiosGet = jest.spyOn(axios, 'get').mockImplementation(url => {
      if (url.startsWith('/getVehicleType/')) {
        const licensePlate = url.split('/')[2];
        if (licensePlate === 'TEST') {
          return Promise.resolve({
            data: {
              result: {
                vehicleYear: 2020,
                vehicleMake: 'Toyota',
                vehicleModel: 'Camry',
                vehicleBody: 'Sedan',
              },
            },
          });
        }
        // Like the real LookupAPlate API, plates without vehicle records
        // (e.g. partial plates typed one character at a time) return an
        // empty result instead of an error.
        return Promise.resolve({ data: { result: {} } });
      }
      // Like the real howsmydriving API, partial plates return no vehicle.
      return Promise.resolve({ data: { data: [] } });
    });
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { features: [{ properties: {} }] } });

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // Type TEST one character at a time, pausing after each so that every
    // intermediate plate is looked up.
    for (const plate of ['T', 'TE', 'TES', 'TEST']) {
      renderer.act(() => {
        homeRef.current.setLicensePlate({ plate, licenseState: 'NY' });
      });
      // eslint-disable-next-line no-await-in-loop -- each plate's lookup must complete before the next keystroke, to mimic slow typing.
      await renderer.act(async () => {
        jest.advanceTimersByTime(1500);
      });
    }

    // Empty responses are cached like any other response...
    expect(
      homeRef.current.plateLookupCache.get('TES:NY').vehicleInfoResponse,
    ).toEqual({ result: {} });

    axiosGet.mockClear();

    // ...so deleting back through a partial plate re-renders the error UI
    // without hitting the API again.
    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'TES', licenseState: 'NY' });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(axiosGet).not.toHaveBeenCalled();
    expect(homeRef.current.state.vehicleInfoComponent).not.toBe(
      'Looking up make/model for TES in New York',
    );

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('positions plate overlays with the uploaded image dimensions', () => {
    // Three sizes are in play for one photo, and only one of them is the space
    // `box` is measured in:
    //   3024x4032  the original file, which is what the browser renders
    //   2048x2731  what src/alpr.js uploaded, and what `box` is relative to
    //   1919x2560  what Plate Recognizer reports as image_width/image_height,
    //              having resized the upload again before processing it
    // Dividing by the rendered size drags overlays ~1.5x up and to the left;
    // dividing by image_width pushes them ~6.7% down and to the right.
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

    const plateDataByAttachmentName = {
      'photo.jpg': {
        results: [
          {
            plate: 'kna6960',
            region: { code: 'us-ny' },
            box: { xmin: 1114, ymin: 1266, xmax: 1188, ymax: 1304 },
          },
        ],
        uploadWidth: 2048,
        uploadHeight: 2731,
        image_width: 1919,
        image_height: 2560,
      },
    };

    renderer.act(() => {
      homeRef.current.setState({
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
        plateDataByAttachmentName,
      });
    });

    // Report a rendered size larger than the uploaded one, the way loading the
    // original file would, then re-render so any size cached from it is used.
    const img = tree.root
      .findAllByType('img')
      .find(node => node.props.alt === 'photo.jpg');
    if (img.props.onLoad) {
      renderer.act(() => {
        img.props.onLoad({
          target: { naturalWidth: 3024, naturalHeight: 4032 },
        });
      });
    }
    renderer.act(() => {
      homeRef.current.setState({ plateDataByAttachmentName });
    });

    const overlay = tree.root.findByProps({
      'aria-label': 'Select license plate KNA6960',
    });
    expect(overlay.props.style).toEqual({
      left: '54.39453125%',
      top: '46.35664591724643%',
      width: '3.61328125%',
      height: '1.3914317099963385%',
    });

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('shows the highest-resolution crop beside the plate input when multiple crops match the plate', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
      plate: 'ABC123',
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
          'small.jpg': {
            results: [
              {
                plate: 'abc123',
                box: { xmin: 100, ymin: 100, xmax: 200, ymax: 110 },
                plateCropDataUrl: 'data:image/jpeg;base64,small',
              },
            ],
          },
          'big.jpg': {
            results: [
              {
                plate: 'ABC123',
                box: { xmin: 100, ymin: 100, xmax: 400, ymax: 250 },
                plateCropDataUrl: 'data:image/jpeg;base64,big',
              },
              {
                // Not the selected plate, so its larger box must be ignored.
                plate: 'XYZ789',
                box: { xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 },
                plateCropDataUrl: 'data:image/jpeg;base64,other',
              },
            ],
          },
        },
      });
    });

    const thumbnail = tree.root.findByProps({
      alt: 'Detected license plate',
    });
    expect(thumbnail.props.src).toBe('data:image/jpeg;base64,big');

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

  test('renders Preferences UI', () => {
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
      homeRef.current.setState({ isPreferencesOpen: true });
    });

    expect(tree.toJSON()).toMatchSnapshot();
    expect(tree.root.findByProps({ name: 'isAlprEnabled' })).toBeTruthy();
    expect(
      tree.root.findByProps({ name: 'isReverseGeocodingEnabled' }),
    ).toBeTruthy();
    expect(
      tree.root.findByProps({ name: 'isLoadPreviousSubmissionsEnabled' }),
    ).toBeTruthy();
    // Nothing from the Edit Profile form leaks into the Preferences panel,
    // and the main submission form is hidden while the panel is open.
    expect(tree.root.findAllByType('form')).toHaveLength(0);
    expect(() => tree.root.findByProps({ name: 'FirstName' })).toThrow();

    tree.unmount();
  });

  test('opens only one of Edit Profile/Preferences at a time', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });

    const preferencesButton = tree.root.findAll(
      node => node.type === 'button' && node.props.children === 'Preferences',
    )[0];
    renderer.act(() => {
      preferencesButton.props.onClick();
    });
    expect(homeRef.current.state.isPreferencesOpen).toBe(true);
    expect(homeRef.current.state.isEditProfileOpen).toBe(false);

    const editProfileButton = tree.root.findAll(
      node => node.type === 'button' && node.props.children === 'Edit Profile',
    )[0];
    renderer.act(() => {
      editProfileButton.props.onClick();
    });
    expect(homeRef.current.state.isEditProfileOpen).toBe(true);
    expect(homeRef.current.state.isPreferencesOpen).toBe(false);

    tree.unmount();
  });

  test('shows loading summary when refreshing cached submissions', () => {
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
      'at least 2, loading more...',
    );

    renderer.act(() => {
      homeRef.current.setState({ isPreviousSubmissionsLoading: false });
    });
    expect(homeRef.current.getPreviousSubmissionsSummary()).toBe(2);

    tree.unmount();
  });

  test('keeps the caret in place when typing a letter into the middle of the plate', () => {
    const { homeRef, plateInput, cleanup } = renderPlateInput();

    // The user typed "b" between the "A" and the "Z" of "AZ".
    const input = createFakeInput({ value: 'AbZ', caret: 2 });
    renderer.act(() => {
      plateInput.props.onChange({ target: input });
    });
    reRenderControlledInput(input, homeRef.current.state.plate);

    expect(homeRef.current.state.plate).toBe('ABZ');
    expect(input.value).toBe('ABZ');
    // ...and the caret stays after the "B", rather than jumping to the end.
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);

    cleanup();
  });

  test('keeps the caret in place when typing a digit into the middle of the plate', () => {
    const { homeRef, plateInput, cleanup } = renderPlateInput();

    // The user typed "2" between the "A" and the "Z" of "AZ". Digits are
    // unaffected by toUpperCase(), so this case already worked.
    const input = createFakeInput({ value: 'A2Z', caret: 2 });
    renderer.act(() => {
      plateInput.props.onChange({ target: input });
    });
    reRenderControlledInput(input, homeRef.current.state.plate);

    expect(homeRef.current.state.plate).toBe('A2Z');
    expect(input.value).toBe('A2Z');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);

    cleanup();
  });

  test('keeps the caret after characters that grow when uppercased', () => {
    const { homeRef, plateInput, cleanup } = renderPlateInput();

    // "ß".toUpperCase() is "SS", so the caret has to move right by one to stay
    // after the character the user just typed.
    const input = createFakeInput({ value: 'AßZ', caret: 2 });
    renderer.act(() => {
      plateInput.props.onChange({ target: input });
    });
    reRenderControlledInput(input, homeRef.current.state.plate);

    expect(homeRef.current.state.plate).toBe('ASSZ');
    expect(input.value).toBe('ASSZ');
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);

    cleanup();
  });

  test('tolerates inputs that do not report a selection', () => {
    const { homeRef, plateInput, cleanup } = renderPlateInput();

    // selectionStart/selectionEnd are null for input types that don't support
    // text selection, and setSelectionRange throws on them.
    const input = createFakeInput({ value: 'abc', caret: null });
    input.setSelectionRange = () => {
      throw new Error('setSelectionRange should not be called');
    };
    renderer.act(() => {
      plateInput.props.onChange({ target: input });
    });

    expect(homeRef.current.state.plate).toBe('ABC');
    expect(input.value).toBe('ABC');

    cleanup();
  });

  describe('background attachment uploads', () => {
    // Renders the form as a logged-in user, disables the network-backed
    // extraction pipelines, and adds the given files through the same code
    // path as the file <input>. Returns spies for asserting on the
    // background upload and submit requests.
    async function renderWithFiles({ files, uploadError }) {
      const initialState = {
        email: 'test@example.com',
        password: 'test-password',
        loginSuccessful: true,
      };

      const originalCreateObjectURL = global.URL.createObjectURL;
      global.URL.createObjectURL = jest.fn(() => 'blob:mock');

      // The submit success path scrolls to the top of the page; the rendered
      // tree isn't attached to the jsdom document, so provide a stand-in.
      const originalQuerySelector = document.querySelector;
      document.querySelector = jest.fn(() => ({ scrollTo: jest.fn() }));

      const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockImplementation((url, body) => {
          if (url === '/api/uploadAttachment') {
            if (uploadError) {
              const uploadPromise = Promise.reject(uploadError);
              // Mark the rejection as handled so the test runner doesn't
              // flag it: the component only catches it at submit time.
              uploadPromise.catch(() => {});
              return uploadPromise;
            }
            return Promise.resolve({
              data: { id: `uploaded-${body.get('attachmentData').name}` },
            });
          }
          return Promise.resolve({
            data: {
              submission: {
                objectId: 'objectId123',
                timeofreport: '2020-01-01T00:00:00.000Z',
                timeofreported: '2020-01-01T00:00:00.000Z',
              },
            },
          });
        });
      const toastSuccess = jest
        .spyOn(toast, 'success')
        .mockImplementation(() => null);
      const toastWarn = jest
        .spyOn(toast, 'warn')
        .mockImplementation(() => null);
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      let tree;
      const homeRef = React.createRef();
      renderer.act(() => {
        tree = renderHome({ initialState, homeRef });
      });
      renderer.act(() => {
        homeRef.current.setState({
          isAlprEnabled: false,
          isReverseGeocodingEnabled: false,
          // A location other than the defaultLatitude/defaultLongitude
          // constants, so the submit handler passes its guard
          latitude: 40.7129,
          longitude: -74.0061,
        });
      });

      // Add the files through the same path the file <input> uses, so the
      // background uploads start exactly as they do in the browser.
      await renderer.act(async () => {
        await homeRef.current.handleAttachmentData({ attachmentData: files });
        // Let the extraction pipeline settle so it doesn't touch state after
        // the tree is unmounted.
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
      });

      return {
        homeRef,
        axiosPost,
        submit: () => {
          const form = tree.root
            .findAllByType('form')
            .find(formEl => typeof formEl.props.onSubmit === 'function');
          return renderer.act(async () => {
            await form.props.onSubmit({ preventDefault() {} });
          });
        },
        cleanup: () => {
          tree.unmount();
          axiosGet.mockRestore();
          axiosPost.mockRestore();
          toastSuccess.mockRestore();
          toastWarn.mockRestore();
          consoleError.mockRestore();
          document.querySelector = originalQuerySelector;
          global.URL.createObjectURL = originalCreateObjectURL;
        },
      };
    }

    test('uploads files to /api/uploadAttachment in the background when files are added', async () => {
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const video = new File(['video'], 'video.mp4', { type: 'video/mp4' });
      const { axiosPost, cleanup } = await renderWithFiles({
        files: [photo, video],
      });

      const uploadCalls = axiosPost.mock.calls.filter(
        ([url]) => url === '/api/uploadAttachment',
      );
      expect(uploadCalls).toHaveLength(2);
      uploadCalls.forEach(([, body], index) => {
        const original = index === 0 ? photo : video;
        const uploaded = body.get('attachmentData');
        expect(body.get('email')).toBe('test@example.com');
        expect(body.get('password')).toBe('test-password');
        // The upload carries a copy of the file's bytes, not the File from
        // the file input: the network is handed a File whose contents are
        // already in memory, since some browsers send an empty body for the
        // original (see the "Unexpected end of form" section of the README).
        expect(uploaded).not.toBe(original);
        expect(uploaded.name).toBe(original.name);
        expect(uploaded.type).toBe(original.type);
        expect(uploaded.size).toBe(original.size);
      });
      const [, firstUpload] = uploadCalls[0];
      const uploadedBytes = await blobUtil.blobToArrayBuffer(
        firstUpload.get('attachmentData'),
      );
      expect(Buffer.from(uploadedBytes)).toEqual(Buffer.from('photo'));

      // Nothing has been submitted yet: the uploads happen before the user
      // clicks Submit.
      expect(
        axiosPost.mock.calls.filter(([url]) => url === '/submit'),
      ).toHaveLength(0);

      cleanup();
    });

    test('submits the pre-uploaded attachment IDs instead of re-sending the files', async () => {
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { homeRef, axiosPost, submit, cleanup } = await renderWithFiles({
        files: [photo],
      });
      await submit();

      const submitCall = axiosPost.mock.calls.find(
        ([url]) => url === '/submit',
      );
      expect(submitCall).toBeDefined();
      const [, submitBody] = submitCall;
      expect(JSON.parse(submitBody.get('attachmentIds'))).toEqual([
        'uploaded-photo.jpg',
      ]);
      expect(submitBody.get('attachmentData')).toBeNull();

      // The upload must have started before the submit request went out,
      // i.e. in the background rather than as part of submitting.
      const uploadCallIndex = axiosPost.mock.calls.findIndex(
        ([url]) => url === '/api/uploadAttachment',
      );
      const submitCallIndex = axiosPost.mock.calls.findIndex(
        ([url]) => url === '/submit',
      );
      expect(uploadCallIndex).toBeLessThan(submitCallIndex);

      // The success path cleared the submitted files.
      expect(homeRef.current.state.attachmentData).toEqual([]);

      cleanup();
    });

    test('falls back to submitting the files themselves when a background upload failed', async () => {
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { homeRef, axiosPost, submit, cleanup } = await renderWithFiles({
        files: [photo],
        uploadError: new Error('upload failed'),
      });
      await submit();

      const submitCall = axiosPost.mock.calls.find(
        ([url]) => url === '/submit',
      );
      expect(submitCall).toBeDefined();
      const [, submitBody] = submitCall;
      expect(submitBody.get('attachmentIds')).toBeNull();
      // object-to-formdata serializes array items under `<name>[]`, which is
      // the field name the server's multer `upload.array` expects.
      const submitted = submitBody.get('attachmentData[]');
      expect(submitted).not.toBe(photo);
      expect(submitted.name).toBe(photo.name);
      expect(submitted.type).toBe(photo.type);
      const submittedBytes = await blobUtil.blobToArrayBuffer(submitted);
      expect(Buffer.from(submittedBytes)).toEqual(Buffer.from('photo'));

      expect(homeRef.current.state.attachmentData).toEqual([]);

      cleanup();
    });
  });

  describe('semi-automatic mode', () => {
    // A JPEG `size` bytes long. The header is what mime-bytes'
    // detectFromBuffer() reads to call the file an image, and the length is
    // what identifies the photo further in: the ALPR request carries the
    // bytes, not the file name, so the mocked route tells them apart by size.
    const jpeg = ({ name, size }) =>
      new File(
        [
          new Uint8Array([
            0xff,
            0xd8,
            0xff,
            0xe0,
            ...new Array(size - 4).fill(0),
          ]),
        ],
        name,
        { type: 'image/jpeg' },
      );

    const plateResult = ({ plate, candidates = [] }) => ({
      plate,
      score: 0.9,
      candidates,
      box: { xmin: 400, ymin: 400, xmax: 500, ymax: 500 },
      // The overlay's box is in the pixel space of the uploaded image, so the
      // frame's own dimensions come back with the results.
      region: { code: 'us-ny' },
      vehicle: { box: { xmin: 300, ymin: 300, xmax: 600, ymax: 600 } },
    });

    // One ALPR response per photo, keyed by its byte length: what it read, and
    // the size of the frame the box is in. Two photos of one medallion plate
    // (the candidates are what fold them together), a different car at the same
    // curb, and one more a minute later.
    const plateResultsForSize = size => {
      const resultsBySize = {
        4: [
          plateResult({
            plate: 't696817c',
            candidates: [{ plate: 't6968i7c', score: 0.4 }],
          }),
        ],
        5: [
          plateResult({
            plate: 't6968i7c',
            candidates: [{ plate: 't696817c', score: 0.6 }],
          }),
        ],
        6: [plateResult({ plate: 'lda8765' })],
        7: [plateResult({ plate: 'k73jau' })],
      };

      return {
        results: resultsBySize[size],
        uploadWidth: 1000,
        uploadHeight: 1000,
      };
    };

    // When each photo was shot, keyed by byte length: a second apart, a second
    // apart again, then a minute later — far enough that the last one groups on
    // its own.
    const createDatesBySize = {
      4: '2024-01-01T12:00:00.000Z',
      5: '2024-01-01T12:00:01.000Z',
      6: '2024-01-01T12:00:02.000Z',
      7: '2024-01-01T12:01:00.000Z',
    };

    // Renders the form as a logged-in user with semi-automatic mode on, adds
    // the given files through the same entry point the folder and loose-file
    // inputs (and the drop and paste handlers) use, and lets the batch pass
    // finish. Returns the spied axios so the tests can count ALPR and geosearch
    // requests, and helpers that drive the rendered batch UI.
    async function renderBatchWithFiles(files) {
      const initialState = {
        email: 'test@example.com',
        password: 'test-password',
        loginSuccessful: true,
      };

      const originalCreateObjectURL = global.URL.createObjectURL;
      global.URL.createObjectURL = jest.fn(() => 'blob:mock');

      // The submit success path scrolls to the top of the page; the rendered
      // tree isn't attached to the jsdom document, so provide a stand-in.
      const originalQuerySelector = document.querySelector;
      document.querySelector = jest.fn(() => ({ scrollTo: jest.fn() }));

      const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockImplementation((url, body) => {
          if (url === '/platerecognizer') {
            const { size } = body.get('attachmentFile');
            return Promise.resolve({ data: plateResultsForSize(size) });
          }
          if (url === '/api/geosearch') {
            return Promise.resolve({
              data: {
                features: [
                  {
                    properties: {
                      housenumber: '123',
                      street: 'Main St',
                      borough: 'Manhattan',
                    },
                  },
                ],
              },
            });
          }
          if (url === '/api/uploadAttachment') {
            return Promise.resolve({
              data: { id: `uploaded-${body.get('attachmentData').name}` },
            });
          }
          return Promise.resolve({
            data: {
              submission: {
                objectId: 'objectId123',
                timeofreport: '2020-01-01T00:00:00.000Z',
                timeofreported: '2020-01-01T00:00:00.000Z',
              },
            },
          });
        });
      const toastSuccess = jest
        .spyOn(toast, 'success')
        .mockImplementation(() => null);
      const toastWarn = jest
        .spyOn(toast, 'warn')
        .mockImplementation(() => null);
      const toastError = jest
        .spyOn(toast, 'error')
        .mockImplementation(() => null);
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      let tree;
      const homeRef = React.createRef();
      renderer.act(() => {
        tree = renderHome({ initialState, homeRef });
      });
      renderer.act(() => {
        homeRef.current.setState({ isSemiAutomaticMode: true });
      });

      if (files.length > 0) {
        await renderer.act(async () => {
          await homeRef.current.addFilesToBatch(files);
          // Let the extraction pipeline settle so it doesn't touch state after
          // the tree is unmounted.
          await new Promise(resolve => setImmediate(resolve));
          await new Promise(resolve => setImmediate(resolve));
        });
      }

      const findButton = text =>
        tree.root
          .findAllByType('button')
          .find(({ children }) => children.includes(text));

      return {
        homeRef,
        axiosPost,
        toastWarn,
        platerecognizerCalls: () =>
          axiosPost.mock.calls.filter(([url]) => url === '/platerecognizer'),
        geosearchCalls: () =>
          axiosPost.mock.calls.filter(([url]) => url === '/api/geosearch'),
        clickButton: text =>
          renderer.act(() => {
            findButton(text).props.onClick();
          }),
        // Tick or untick one photo in a loaded group's attachment picker, by
        // the photo's name, the way its checkbox does.
        toggleAttachment: (name, checked) => {
          const label = tree.root
            .findAllByType('label')
            .find(({ children }) => children.includes(name));
          renderer.act(() => {
            label.findByType('input').props.onChange({ target: { checked } });
          });
        },
        submit: () => {
          const form = tree.root
            .findAllByType('form')
            .find(formEl => typeof formEl.props.onSubmit === 'function');
          return renderer.act(async () => {
            await form.props.onSubmit({ preventDefault() {} });
          });
        },
        cleanup: () => {
          tree.unmount();
          axiosGet.mockRestore();
          axiosPost.mockRestore();
          toastSuccess.mockRestore();
          toastWarn.mockRestore();
          toastError.mockRestore();
          consoleError.mockRestore();
          document.querySelector = originalQuerySelector;
          global.URL.createObjectURL = originalCreateObjectURL;
        },
      };
    }

    test('groups the batch, looks each place up once, and loads a violation from what it extracted', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 6 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      // Every photo carries the same GPS, so the batch's lookups all land on
      // one address.
      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const {
        homeRef,
        platerecognizerCalls,
        geosearchCalls,
        clickButton,
        submit,
        cleanup,
      } = await renderBatchWithFiles(photos);

      const { batchViolations } = homeRef.current.state;
      expect(batchViolations).toHaveLength(3);
      expect(batchViolations.map(v => [v.plate, v.photos.length])).toEqual([
        ['T696817C', 2],
        ['LDA8765', 1],
        ['K73JAU', 1],
      ]);

      // One ALPR request per photo, and one geosearch request for the whole
      // batch: every violation is at the same coordinates, so the memo serves
      // the second and third lookups.
      expect(platerecognizerCalls()).toHaveLength(4);
      expect(geosearchCalls()).toHaveLength(1);

      clickButton('Load next violation');

      const { state } = homeRef.current;
      expect(state.currentViolationIndex).toBe(0);
      expect(state.plate).toBe('T696817C');
      expect(state.licenseState).toBe('NY');
      // The group's photos, in capture order.
      expect(state.attachmentData).toHaveLength(2);
      expect(state.attachmentData[0]).toBe(photos[0]);
      expect(state.attachmentData[1]).toBe(photos[1]);
      expect(state.latitude).toBe(40.7129);
      expect(state.longitude).toBe(-74.0061);
      // From the batch's geocode, not a fresh request.
      expect(state.formatted_address).toBe('123 Main St, Manhattan');
      // 2024-01-01T12:00:00Z, less the -05:00 offset the camera recorded.
      expect(state.CreateDate).toBe('2024-01-01T07:00');

      // Loading a violation re-uses what the batch already extracted:
      // neither ALPR nor geosearch is asked again.
      expect(platerecognizerCalls()).toHaveLength(4);
      expect(geosearchCalls()).toHaveLength(1);

      await submit();

      // The submitted violation leaves the queue, and the next one loads in
      // its place rather than leaving an empty form behind.
      const afterSubmit = homeRef.current.state;
      expect(afterSubmit.batchViolations).toHaveLength(2);
      expect(afterSubmit.currentViolationIndex).toBe(0);
      expect(afterSubmit.plate).toBe('LDA8765');
      expect(afterSubmit.attachmentData).toHaveLength(1);
      expect(afterSubmit.attachmentData[0]).toBe(photos[2]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('attaches at most 3 pictures and 3 videos of a group, and swaps them in and out', async () => {
      const pictures = ['p1', 'p2', 'p3', 'p4'].map(
        name => new File(['picture'], `${name}.jpg`, { type: 'image/jpeg' }),
      );
      const videos = ['v1', 'v2', 'v3', 'v4'].map(
        name => new File(['video'], `${name}.mp4`, { type: 'video/mp4' }),
      );
      const photos = [...pictures, ...videos].map(file => ({
        file,
        name: file.name,
      }));
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: 1704110400000,
      };

      const { homeRef, toastWarn, clickButton, toggleAttachment, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        // The batch resolves this location before the user gets to it, which is
        // what keeps loading a violation from asking geosearch again.
        homeRef.current.geosearchAddressCache.set({
          latitude: 40.7129,
          longitude: -74.0061,
          address: '123 Main St, Manhattan',
        });
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [violation],
        });
      });
      clickButton('Load next violation');

      const attachmentNames = () =>
        homeRef.current.state.attachmentData.map(file => file.name);

      // The first three pictures and the first three videos, in capture order.
      expect(attachmentNames()).toEqual([
        'p1.jpg',
        'p2.jpg',
        'p3.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);

      // A fourth picture is refused rather than attached and then silently
      // dropped: createSubmission.js keeps only images.slice(0, 3).
      toggleAttachment('p4.jpg', true);
      expect(attachmentNames()).toEqual([
        'p1.jpg',
        'p2.jpg',
        'p3.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);
      expect(toastWarn.mock.calls[0][0]).toBe(
        'A report can include at most 3 pictures. Uncheck one to swap it in.',
      );

      // Unticking a picture frees its slot, and the fourth takes it — keeping
      // the group's own order rather than moving to the end.
      toggleAttachment('p1.jpg', false);
      toggleAttachment('p4.jpg', true);
      expect(attachmentNames()).toEqual([
        'p2.jpg',
        'p3.jpg',
        'p4.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);

      // Videos have the same cap as pictures.
      toggleAttachment('v4.mp4', true);
      expect(attachmentNames()).toEqual([
        'p2.jpg',
        'p3.jpg',
        'p4.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);
      expect(toastWarn.mock.calls[1][0]).toBe(
        'A report can include at most 3 videos. Uncheck one to swap it in.',
      );

      cleanup();
    });
  });
});
