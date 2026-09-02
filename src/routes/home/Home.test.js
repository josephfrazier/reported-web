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
      'at least 2, loading more...',
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
        expect(body.get('email')).toBe('test@example.com');
        expect(body.get('password')).toBe('test-password');
        expect(body.get('attachmentData')).toBe(index === 0 ? photo : video);
      });

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
      expect(submitBody.get('attachmentData[]')).toBe(photo);

      expect(homeRef.current.state.attachmentData).toEqual([]);

      cleanup();
    });
  });
});
