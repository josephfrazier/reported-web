/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import renderer from 'react-test-renderer';
// jsdom doesn't provide the setImmediate global, so use Node's directly.
import { setImmediate } from 'timers';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import axios from 'axios';
import exifr from 'exifr/dist/full.umd.js';
import { zipSync } from 'fflate';
import * as blobUtil from 'blob-util';
import { toast } from 'react-toastify';
import Modal from 'react-modal';
import Dropzone from '@josephfrazier/react-dropzone';
import { MAP } from 'react-google-maps/lib/constants';
import App from '../../components/App.js';
import plateReadRetry from '../../plateReadRetry.js';
import Home, { NycAddressAutocomplete } from './Home.js';
import boroughBoundariesFeatureCollection from '../../boroughBoundaries.js';
import {
  readCachedSubmissions,
  writeCachedSubmissions,
} from './submissionsCache.js';
import { HOME_STATE_COOKIE } from '../../homeStateCookie.js';

jest.mock('react-modal', () =>
  Object.assign(({ children, isOpen }) => (isOpen ? children : null), {
    setAppElement: jest.fn(),
  }),
);

// exifr reads the metadata out of real image bytes, which no test here has.
// Mocked rather than spied on: the imported object's properties are getters
// under Jest (they are writable when the module is required from Node
// directly), so `jest.spyOn` cannot replace them. A test that wants an
// extraction to succeed gives these implementations; every other test leaves
// them returning nothing, which fails an extraction exactly as junk bytes do.
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

// `withStyles` returns a wrapper that carries the CSS helpers; statics such
// as `handleSearchInputMounted` stay on the class it wraps, which the wrapper
// exposes as `ComposedComponent`.
const HomeWithoutStyle = Home.ComposedComponent;

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

// Bytes that look like a picture to the detector in `Home.js`, which reads the
// extension before it reads any metadata: ASCII bytes come back as
// `text/plain`, which is not an image, so every extractor throws before exifr
// is reached. A JPEG start-of-image marker does that; the label after it is
// how a test's exifr stubs tell one photo from another.
const photoBytes = label =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(label, 'utf8')]);

function renderHome({ initialState, homeRef, ...props } = {}) {
  let tree;
  // ToastContainer's mount effect updates its own state. Without act, that
  // update lands outside a test render and React warns about it. The act
  // callback returns nothing so that act does not treat the renderer as a
  // promise to await.
  renderer.act(() => {
    tree = renderer.create(
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
  });
  return tree;
}

// Mounts Home, hands the photos to the extraction pass the way the file input
// does, and returns once that pass has finished. Stubs axios and console.error
// for the duration; `cleanup` puts them back and unmounts.
async function renderAndExtract(files) {
  const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
  const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
    if (url === '/api/geosearch') {
      return Promise.resolve({ data: { features: [] } });
    }
    if (url === '/api/uploadAttachment') {
      return Promise.resolve({ data: { id: 'a'.repeat(64) } });
    }
    return Promise.resolve({ data: {} });
  });
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  let tree;
  const homeRef = React.createRef();
  renderer.act(() => {
    tree = renderHome({ homeRef });
  });
  renderer.act(() => {
    // The plate read is not what these tests are about, and it would send a
    // request per photo.
    homeRef.current.setState({ isAlprEnabled: false });
  });

  // The pass runs inside a setState callback, through jsdom's FileReader and
  // the stubbed reads, so it needs real time rather than a microtask.
  // `setCoords` then asks geosearch for an address 500ms later; waiting that
  // out keeps every request inside the stubs, instead of one going out after
  // they are gone.
  const settle = () =>
    renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

  await renderer.act(async () => {
    await homeRef.current.handleAttachmentData({ attachmentData: files });
  });
  await settle();

  return {
    homeRef,
    settle,
    cleanup: () => {
      exifr.gps.mockReset();
      exifr.parse.mockReset();
      axiosGet.mockRestore();
      axiosPost.mockRestore();
      consoleError.mockRestore();
      tree.unmount();
    },
  };
}

// The same, with the plate read answering. `platesBySize` gives each photo's
// reading by its byte length -- `photoBytes(label).length` -- so a test can
// say what each photo in a set read, or leave it reading nothing.
async function renderWithPlateReads(files, { platesBySize = {} } = {}) {
  const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
  const axiosPost = jest
    .spyOn(axios, 'post')
    .mockImplementation((url, body) => {
      if (url === '/platerecognizer') {
        const { size } = body.get('attachmentFile');
        const plate = platesBySize[size];

        return Promise.resolve({
          data: {
            results: plate
              ? [
                  {
                    plate: plate.toLowerCase(),
                    score: 0.9,
                    box: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
                    region: { code: 'us-ny' },
                    candidates: [],
                  },
                ]
              : [],
            uploadWidth: 1000,
            uploadHeight: 1000,
          },
        });
      }
      if (url === '/api/geosearch') {
        return Promise.resolve({ data: { features: [] } });
      }
      if (url === '/api/uploadAttachment') {
        return Promise.resolve({ data: { id: 'a'.repeat(64) } });
      }
      return Promise.resolve({ data: {} });
    });
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => {});

  const originalCreateObjectURL = global.URL.createObjectURL;
  global.URL.createObjectURL = jest.fn(() => 'blob:mock');

  let tree;
  const homeRef = React.createRef();
  renderer.act(() => {
    // Logged in, because the plate is a field on the form and the overlays
    // hang off the attachments the form draws.
    tree = renderHome({
      initialState: { email: 'test@example.com', loginSuccessful: true },
      homeRef,
    });
  });

  const settle = () =>
    renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

  await renderer.act(async () => {
    await homeRef.current.handleAttachmentData({ attachmentData: files });
  });
  await settle();

  return {
    homeRef,
    tree,
    settle,
    cleanup: () => {
      exifr.gps.mockReset();
      exifr.parse.mockReset();
      axiosGet.mockRestore();
      axiosPost.mockRestore();
      consoleError.mockRestore();
      global.URL.createObjectURL = originalCreateObjectURL;
      tree.unmount();
    },
  };
}

// A photo with `label` in its bytes, whose length is what the plate stub above
// tells the photos apart by.
const labelledPhoto = label =>
  new File([photoBytes(label)], `${label}.jpg`, { type: 'image/jpeg' });

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

// The rendered tree keeps every JSX child as its own entry, so a sentence with
// interpolations in it is not one string in there: the error message serializes
// as "Could not look up make/model of ", "ABC123", " in", " ", "ON", ",". Join
// the text back together before asserting on a sentence, the way a reader sees
// it.
function renderedText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(renderedText).join('');
  return renderedText(node.children);
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
    // No review app source outside a Heroku review app, so no link.
    expect(banner.findAllByType('a')).toHaveLength(0);

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('links the banner to the PR the review app was deployed from', () => {
    const parseServerUrl = 'https://reported-parse.webabot.com/parse';
    const reviewAppUrl =
      'https://github.com/josephfrazier/reported-web/pull/1046';

    const reviewAppLabel = 'PR #1046 (review-app-source-link)';

    const tree = renderHome({
      parseServerUrl,
      showParseServerBanner: true,
      reviewAppUrl,
      reviewAppLabel,
    });

    const banner = tree.root.findByProps({
      className: 'non-production-banner',
    });
    const link = banner.findByType('a');

    expect(link.props.href).toBe(reviewAppUrl);
    expect(link.children).toEqual([reviewAppLabel]);

    expect(tree.toJSON()).toMatchSnapshot();

    tree.unmount();
  });

  test('links the footer commit hash to the commit on GitHub', () => {
    const commitHash = '31df5a75cd5c5ca347b9693c9be65eb484e910f2';

    const tree = renderHome({ commitHash });

    const link = tree.root.findByProps({
      href: `https://github.com/josephfrazier/reported-web/commit/${commitHash}`,
    });

    expect(link.type).toBe('a');
    expect(link.children).toEqual([commitHash]);
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noopener noreferrer');

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
      HomeWithoutStyle.handleSearchInputMounted(input);

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
      HomeWithoutStyle.handleSearchInputMounted(input);

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
      HomeWithoutStyle.handleSearchInputMounted(null);

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
    expect(overlay.props.children.props.children).toBe('ABC123 (NY)');

    renderer.act(() => {
      overlay.props.onClick();
    });
    expect(homeRef.current.state.plate).toBe('ABC123');
    expect(homeRef.current.state.licenseState).toBe('NY');

    tree.unmount();
    global.URL.createObjectURL = originalCreateObjectURL;
  });

  test('highlights the overlay for the selected plate, typed or clicked', () => {
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
              {
                plate: 'xyz789',
                region: { code: 'us-nj' },
                box: { xmin: 400, ymin: 200, xmax: 600, ymax: 250 },
              },
            ],
            uploadWidth: 1000,
            uploadHeight: 500,
          },
        },
      });
    });

    const overlayFor = plate =>
      tree.root.findByProps({
        'aria-label': `Select license plate ${plate}`,
      });

    expect(overlayFor('ABC123').props.className).toBe('plate-overlay');
    expect(overlayFor('XYZ789').props.className).toBe('plate-overlay');

    // Typing the plate selects its overlay without choosing a state.
    renderer.act(() => {
      tree.root.findByProps({ name: 'plate' }).props.onChange({
        target: createFakeInput({ value: 'ABC123', caret: 6 }),
      });
    });

    expect(homeRef.current.state.plate).toBe('ABC123');
    expect(overlayFor('ABC123').props.className).toBe(
      'plate-overlay plate-overlay-selected',
    );
    expect(overlayFor('ABC123').props.children.props.children).toBe(
      '✓ ABC123 (NY)',
    );
    expect(overlayFor('XYZ789').props.className).toBe('plate-overlay');
    expect(overlayFor('XYZ789').props.children.props.children).toBe(
      'XYZ789 (NJ)',
    );

    // Clicking another overlay moves the highlight to that plate.
    renderer.act(() => {
      overlayFor('XYZ789').props.onClick();
    });

    expect(overlayFor('ABC123').props.className).toBe('plate-overlay');
    expect(overlayFor('XYZ789').props.className).toBe(
      'plate-overlay plate-overlay-selected',
    );

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

  test('moves the form to the place the newest located photo gave', async () => {
    jest.useFakeTimers();

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    // What the extraction pass hands over once every photo has been read: the
    // early photo's fix is the stale one, and the late photo's is the place
    // the submission should carry.
    renderer.act(() => {
      homeRef.current.applyPhotoPlace([
        { latitude: 40.7128, longitude: -74.006, createDateMs: 1000 },
        { latitude: 40.73, longitude: -74.01, createDateMs: 3000 },
      ]);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(homeRef.current.state.latitude).toBe(40.73);
    expect(homeRef.current.state.longitude).toBe(-74.01);
    expect(homeRef.current.state.addressProvenance).toBe(
      '(extracted from picture/video)',
    );

    // A pass that found no coordinates anywhere leaves the form where it is.
    renderer.act(() => {
      homeRef.current.applyPhotoPlace([{ createDateMs: 4000 }]);
    });

    expect(homeRef.current.state.latitude).toBe(40.73);
    expect(homeRef.current.state.longitude).toBe(-74.01);

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test("takes the form's place from the newest photo, not the last to answer", async () => {
    // The older photo is listed last, and each photo is read in the order the
    // list gives, so the older photo is also the last to answer. That is the
    // whole point: the form used to take its place from the last answer, and
    // the newest photo has to win even though it answered first.
    const older = new File([photoBytes('older')], 'older.jpg', {
      type: 'image/jpeg',
    });
    const newer = new File([photoBytes('newer')], 'newer.jpg', {
      type: 'image/jpeg',
    });

    exifr.gps.mockImplementation(async buffer => {
      const which = Buffer.from(buffer).toString('utf8');
      return which.includes('older')
        ? { latitude: 40.7, longitude: -73.98 }
        : { latitude: 40.73, longitude: -74.01 };
    });
    exifr.parse.mockImplementation(async buffer => {
      const which = Buffer.from(buffer).toString('utf8');
      return {
        CreateDate: new Date(which.includes('older') ? 1000 : 3000),
        OffsetTimeDigitized: '+00:00',
      };
    });

    const { homeRef, cleanup } = await renderAndExtract([newer, older]);

    expect(homeRef.current.state.latitude).toBe(40.73);
    expect(homeRef.current.state.longitude).toBe(-74.01);

    cleanup();
  });

  test("takes the form's time from the earliest photo, not the last to answer", async () => {
    // Listed earliest first, so it is also the first to answer -- the other way
    // round from the test above, because this rule runs the other way: the
    // form used to take its time from the last answer, and the earliest photo
    // has to win even though it answered first.
    const earlier = new File([photoBytes('earlier')], 'earlier.jpg', {
      type: 'image/jpeg',
    });
    const later = new File([photoBytes('later')], 'later.jpg', {
      type: 'image/jpeg',
    });

    exifr.parse.mockImplementation(async buffer => {
      const which = Buffer.from(buffer).toString('utf8');
      return {
        CreateDate: new Date(
          which.includes('earlier')
            ? Date.UTC(2024, 0, 1, 12, 0, 10)
            : Date.UTC(2024, 0, 1, 12, 0, 40),
        ),
        OffsetTimeDigitized: '+00:00',
      };
    });

    const { homeRef, cleanup } = await renderAndExtract([earlier, later]);

    expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:00:10');

    cleanup();
  });

  // Three photos, each taken ten seconds and a little way from the last, so a
  // submission's time and place land on different photos: the earliest for the
  // time, the last one with coordinates for the place.
  const threePhotosApart = () => {
    const places = {
      early: { latitude: 40.7, longitude: -73.98 },
      middle: { latitude: 40.72, longitude: -73.96 },
      late: { latitude: 40.74, longitude: -73.94 },
    };
    const seconds = { early: 10, middle: 20, late: 30 };

    const photos = ['early', 'middle', 'late'].map(
      name =>
        new File([photoBytes(name)], `${name}.jpg`, { type: 'image/jpeg' }),
    );

    exifr.gps.mockImplementation(async buffer => {
      const which = Buffer.from(buffer).toString('utf8');
      return Object.entries(places).find(([name]) => which.includes(name))[1];
    });
    exifr.parse.mockImplementation(async buffer => {
      const which = Buffer.from(buffer).toString('utf8');
      const name = Object.keys(seconds).find(each => which.includes(each));
      return {
        CreateDate: new Date(Date.UTC(2024, 0, 1, 12, 0, seconds[name])),
        OffsetTimeDigitized: '+00:00',
      };
    });

    return photos;
  };

  const dropPhoto = async (homeRef, settle, name) => {
    const photo = {
      file: homeRef.current.state.attachmentData.find(
        file => file.name === name,
      ),
      name,
    };
    await renderer.act(async () => {
      homeRef.current.deletePhoto(photo);
    });
    await settle();
  };

  test('moves the time and place onto the photos left when one is dropped', async () => {
    const { homeRef, settle, cleanup } =
      await renderAndExtract(threePhotosApart());

    // The submission is as old as its earliest photo, and sits where the last
    // photo that knows where it was was taken.
    expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:00:10');
    expect(homeRef.current.state.latitude).toBe(40.74);

    // Drop the earliest: the time moves onto the one that is left, and the
    // place was already the last photo's.
    await dropPhoto(homeRef, settle, 'early.jpg');
    expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:00:20');
    expect(homeRef.current.state.latitude).toBe(40.74);

    // Drop the last: now the place has to move too.
    await dropPhoto(homeRef, settle, 'late.jpg');
    expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:00:20');
    expect(homeRef.current.state.latitude).toBe(40.72);

    cleanup();
  });

  test('leaves a place the user set alone when a photo is dropped', async () => {
    const { homeRef, settle, cleanup } =
      await renderAndExtract(threePhotosApart());

    // The user moves the pin. Every photo in the set can be wrong about where
    // the car was -- a camera that has just woken up reports its last fix --
    // and the correction is theirs to keep.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.9,
        longitude: -73.9,
        addressProvenance: '(manually set)',
      });
    });

    await dropPhoto(homeRef, settle, 'early.jpg');

    expect(homeRef.current.state.latitude).toBe(40.9);
    expect(homeRef.current.state.longitude).toBe(-73.9);
    // The time was still the photos', so it followed them.
    expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:00:20');

    cleanup();
  });

  test('leaves a time the user typed alone when a photo is dropped', async () => {
    const { homeRef, settle, cleanup } =
      await renderAndExtract(threePhotosApart());

    renderer.act(() => {
      homeRef.current.setCreateDate({
        millisecondsSinceEpoch: Date.UTC(2024, 5, 1, 9, 0, 0),
        offset: 0,
      });
    });

    await dropPhoto(homeRef, settle, 'late.jpg');

    expect(homeRef.current.state.CreateDate).toBe('2024-06-01T09:00:00');
    // The place was still the photos', so it followed them.
    expect(homeRef.current.state.latitude).toBe(40.72);

    cleanup();
  });

  test('takes the plate with the photo that read it', async () => {
    // One photo whose read named the car, and one that read nothing at all.
    const named = labelledPhoto('named');
    const silent = labelledPhoto('silent');

    const { homeRef, settle, cleanup } = await renderWithPlateReads(
      [named, silent],
      { platesBySize: { [photoBytes('named').length]: 'T696817C' } },
    );

    expect(homeRef.current.state.plate).toBe('T696817C');

    // What is left says nothing about a plate, so the field goes back to
    // empty rather than keeping one from a picture the report no longer holds.
    await dropPhoto(homeRef, settle, 'named.jpg');

    expect(homeRef.current.state.plate).toBe('');

    cleanup();
  });

  test('keeps a plate the photos left still read', async () => {
    const first = labelledPhoto('first');
    const second = labelledPhoto('second');

    const { homeRef, settle, cleanup } = await renderWithPlateReads(
      [first, second],
      {
        platesBySize: {
          [photoBytes('first').length]: 'T696817C',
          [photoBytes('second').length]: 'T696817C',
        },
      },
    );

    await dropPhoto(homeRef, settle, 'first.jpg');

    // The photo that read it is gone, and the one left read the same plate:
    // the report says the same thing it did.
    expect(homeRef.current.state.plate).toBe('T696817C');

    cleanup();
  });

  test('leaves a plate the user typed alone when a photo is dropped', async () => {
    const named = labelledPhoto('named');
    const silent = labelledPhoto('silent');

    const { homeRef, tree, settle, cleanup } = await renderWithPlateReads(
      [named, silent],
      { platesBySize: { [photoBytes('named').length]: 'T696817C' } },
    );

    // Typing over the reading, as the field reports it.
    renderer.act(() => {
      tree.root.findByProps({ name: 'plate' }).props.onChange({
        target: createFakeInput({ value: 'ABC1234', caret: 7 }),
      });
    });
    expect(homeRef.current.state.plate).toBe('ABC1234');

    await dropPhoto(homeRef, settle, 'named.jpg');

    // A plate the user typed is theirs: no photo has to be attached for it to
    // be right, and the app cannot read it again from anywhere.
    expect(homeRef.current.state.plate).toBe('ABC1234');

    cleanup();
  });

  test('posts no file but the attachments', async () => {
    const taxi = labelledPhoto('taxi');
    const behind = labelledPhoto('behind');

    const { homeRef, tree, cleanup } = await renderWithPlateReads(
      [taxi, behind],
      {
        platesBySize: {
          [photoBytes('taxi').length]: 'T696817C',
          [photoBytes('behind').length]: '8YJ1234',
        },
      },
    );

    // A plate picked off a picture: what the provenance is there to remember.
    renderer.act(() => {
      tree.root
        .findByProps({ 'aria-label': 'Select license plate 8YJ1234' })
        .props.onClick();
    });

    const posted = homeRef.current.getPerSubmissionState();
    const files = Object.entries(posted)
      .filter(([, value]) => value instanceof File)
      .map(([key]) => key);

    // The submit posts this state, and axios sends every `File` in a body as a
    // multipart file part. The attachments go in their own field, added where
    // the request is made, so nothing in here may be a File: the server's
    // multer takes files only in that field, and a File anywhere else fails
    // the submission outright -- MulterError: Unexpected file field -- so the
    // report cannot be sent at all.
    expect(files).toEqual([]);

    cleanup();
  });

  test('drops a plate picked off a photo that is then dropped', async () => {
    // Two cars in one report: one photo read the taxi's medallion, the other
    // read the car behind it, and the user picks the second plate off the
    // picture it was read from.
    const taxi = labelledPhoto('taxi');
    const behind = labelledPhoto('behind');

    const { homeRef, tree, settle, cleanup } = await renderWithPlateReads(
      [taxi, behind],
      {
        platesBySize: {
          [photoBytes('taxi').length]: 'T696817C',
          [photoBytes('behind').length]: '8YJ1234',
        },
      },
    );

    renderer.act(() => {
      tree.root
        .findByProps({ 'aria-label': 'Select license plate 8YJ1234' })
        .props.onClick();
    });
    expect(homeRef.current.state.plate).toBe('8YJ1234');

    // The photo it was picked from goes. The choice was evidence from that
    // picture, so the field falls back to what the photos left read.
    await dropPhoto(homeRef, settle, 'behind.jpg');

    expect(homeRef.current.state.plate).toBe('T696817C');

    cleanup();
  });

  test('resets to the default place when the last photo is dropped', async () => {
    const [early] = threePhotosApart();
    const { homeRef, settle, cleanup } = await renderAndExtract([early]);

    // The user moves the pin, and then takes the last photo away. A place the
    // user set outranks the photos, but with none left there is nothing for it
    // to describe, so the form goes back to the default place the "Where"
    // button prompts from.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.9,
        longitude: -73.9,
        addressProvenance: '(manually set)',
      });
    });

    await dropPhoto(homeRef, settle, 'early.jpg');

    expect(homeRef.current.state.latitude).toBe(40.7128);
    expect(homeRef.current.state.longitude).toBe(-74.006);

    cleanup();
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

  test('reuses the address it looked up for coordinates it has seen', async () => {
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
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    const coordinates = { latitude: 40.7129, longitude: -74.0061 };
    const elsewhere = { latitude: 40.73, longitude: -74.01 };
    const searches = () =>
      axiosPost.mock.calls.filter(([url]) => url === '/api/geosearch');

    renderer.act(() => {
      homeRef.current.setCoords(coordinates);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(homeRef.current.state.formatted_address).toBe(
      '123 Main St, Manhattan',
    );
    expect(searches()).toHaveLength(1);

    // Somewhere else is a different address, so that lookup still goes out:
    // the memo answers for coordinates it has seen, not for every pair.
    renderer.act(() => {
      homeRef.current.setCoords(elsewhere);
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(searches()).toHaveLength(2);

    // The same coordinates again, as moving the map off a curb and back gives.
    // The address is a function of them alone, so this is answered from what
    // was already looked up rather than asked again.
    renderer.act(() => {
      homeRef.current.setCoords(coordinates);
    });
    // Past the debounce, so a request that was going to be made would be.
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(homeRef.current.state.formatted_address).toBe(
      '123 Main St, Manhattan',
    );
    expect(searches()).toHaveLength(2);

    jest.useRealTimers();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    consoleError.mockRestore();
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

  test('does not look up an empty plate', async () => {
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

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'TEST', licenseState: 'NY' });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });

    axiosGet.mockClear();

    // Clearing the field looks nothing up: /getVehicleType//NY is a 404, and
    // an empty plate has no make/model to show anyway.
    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: '', licenseState: 'NY' });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(axiosGet).not.toHaveBeenCalled();
    expect(homeRef.current.state.vehicleInfoComponent).toBe(null);
    expect(homeRef.current.state.violationSummaryComponent).toBe(null);

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

  test('shows the highest-confidence crop beside the plate input when multiple crops match the plate', () => {
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
                // Its box is smaller, but this is the most confident read, so
                // its crop is the one to show.
                plate: 'abc123',
                score: 0.98,
                box: { xmin: 100, ymin: 100, xmax: 200, ymax: 110 },
                plateCropDataUrl: 'data:image/jpeg;base64,confident',
              },
            ],
          },
          'big.jpg': {
            results: [
              {
                plate: 'ABC123',
                score: 0.4,
                box: { xmin: 100, ymin: 100, xmax: 400, ymax: 250 },
                plateCropDataUrl: 'data:image/jpeg;base64,big',
              },
              {
                // Not the selected plate, so its larger box and confidence
                // must be ignored.
                plate: 'XYZ789',
                score: 1,
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
    expect(thumbnail.props.src).toBe('data:image/jpeg;base64,confident');

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

  test('sets withhold_contact_info_from_nypd from the checkbox', () => {
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

    const checkbox = tree.root.findByProps({
      name: 'withhold_contact_info_from_nypd',
    });
    // The checkbox is labeled "Withhold my contact info from NYPD service
    // requests" and is unchecked by default: the withhold flag is only set
    // when the user opts out.
    expect(checkbox.props.checked).toBe(false);
    expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(false);

    // Checking the box sets the withhold flag, and counts as having seen
    // the feature notice...
    renderer.act(() => {
      checkbox.props.onChange({
        target: {
          type: 'checkbox',
          checked: true,
          name: 'withhold_contact_info_from_nypd',
        },
      });
    });
    expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(true);
    expect(homeRef.current.state.hasSeenWithholdNotice).toBe(true);

    // ...and unchecking it clears the flag.
    renderer.act(() => {
      tree.root
        .findByProps({ name: 'withhold_contact_info_from_nypd' })
        .props.onChange({
          target: {
            type: 'checkbox',
            checked: false,
            name: 'withhold_contact_info_from_nypd',
          },
        });
    });
    expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(false);

    tree.unmount();
  });

  test('shows the withhold notice once, until dismissed or the box is checked', () => {
    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });

    const findBanner = () =>
      tree.root.findByProps({ className: 'withhold-notice-banner' });

    // Shown to logged-in users who haven't withheld and haven't seen it.
    expect(findBanner()).toBeTruthy();

    // Its button opens Edit Profile (and scrolls the withhold field into
    // view, which jsdom doesn't implement).
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = jest.fn();
    renderer.act(() => {
      tree.root.findByProps({ children: 'Show me how' }).props.onClick();
    });
    expect(homeRef.current.state.isEditProfileOpen).toBe(true);
    Element.prototype.scrollIntoView = originalScrollIntoView;

    // Dismissing hides it and remembers, so it stays gone (the flag is
    // part of the persistent state, i.e. the cookie).
    renderer.act(() => {
      tree.root.findByProps({ children: 'Dismiss' }).props.onClick();
    });
    expect(homeRef.current.state.hasSeenWithholdNotice).toBe(true);
    expect(() => findBanner()).toThrow();

    tree.unmount();
  });

  test('hides the withhold notice when logged out, withholding, or already seen', () => {
    // Logged out: no banner.
    let tree = renderHome();
    expect(() =>
      tree.root.findByProps({ className: 'withhold-notice-banner' }),
    ).toThrow();
    tree.unmount();

    // Logged in but already withholding: no banner.
    tree = renderHome({
      initialState: {
        email: 'test@example.com',
        loginSuccessful: true,
        withhold_contact_info_from_nypd: true,
      },
    });
    expect(() =>
      tree.root.findByProps({ className: 'withhold-notice-banner' }),
    ).toThrow();
    tree.unmount();

    // Logged in but already seen (restored from the cookie via SSR
    // initialState): no banner.
    tree = renderHome({
      initialState: {
        email: 'test@example.com',
        loginSuccessful: true,
        hasSeenWithholdNotice: true,
      },
    });
    expect(() =>
      tree.root.findByProps({ className: 'withhold-notice-banner' }),
    ).toThrow();
    tree.unmount();

    // Checking the box counts as seen: unchecking it afterwards does not
    // bring the banner back.
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({
        homeRef,
        initialState: { email: 'test@example.com', loginSuccessful: true },
      });
    });
    renderer.act(() => {
      homeRef.current.setState({ isEditProfileOpen: true });
    });
    renderer.act(() => {
      tree.root
        .findByProps({ name: 'withhold_contact_info_from_nypd' })
        .props.onChange({
          target: {
            type: 'checkbox',
            checked: true,
            name: 'withhold_contact_info_from_nypd',
          },
        });
    });
    expect(() =>
      tree.root.findByProps({ className: 'withhold-notice-banner' }),
    ).toThrow();
    renderer.act(() => {
      tree.root
        .findByProps({ name: 'withhold_contact_info_from_nypd' })
        .props.onChange({
          target: {
            type: 'checkbox',
            checked: false,
            name: 'withhold_contact_info_from_nypd',
          },
        });
    });
    expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(false);
    expect(() =>
      tree.root.findByProps({ className: 'withhold-notice-banner' }),
    ).toThrow();
    tree.unmount();
  });

  test('shows the email-updates checkbox only while withholding, and sets its flag', () => {
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

    // Hidden while contact info isn't withheld: email updates to the NYPD SR
    // are only possible when the reporter's email would otherwise be absent.
    expect(() =>
      tree.root.findByProps({ name: 'receive_nypd_sr_updates_by_email' }),
    ).toThrow();

    renderer.act(() => {
      homeRef.current.setState({ withhold_contact_info_from_nypd: true });
    });
    expect(tree.toJSON()).toMatchSnapshot();

    const checkbox = tree.root.findByProps({
      name: 'receive_nypd_sr_updates_by_email',
    });
    expect(checkbox.props.checked).toBe(false);
    expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(false);

    // Checking the box sets the flag...
    renderer.act(() => {
      checkbox.props.onChange({
        target: {
          type: 'checkbox',
          checked: true,
          name: 'receive_nypd_sr_updates_by_email',
        },
      });
    });
    expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(true);

    // Hiding the checkbox (by un-withholding) doesn't clear the flag: it
    // stays in state (and the cookie) like the other per-submission
    // checkboxes, ready to reappear checked if withholding is re-enabled.
    renderer.act(() => {
      homeRef.current.setState({ withhold_contact_info_from_nypd: false });
    });
    expect(() =>
      tree.root.findByProps({ name: 'receive_nypd_sr_updates_by_email' }),
    ).toThrow();
    expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(true);

    // ...and unchecking it clears the flag once it's visible again.
    renderer.act(() => {
      homeRef.current.setState({ withhold_contact_info_from_nypd: true });
    });
    renderer.act(() => {
      tree.root
        .findByProps({ name: 'receive_nypd_sr_updates_by_email' })
        .props.onChange({
          target: {
            type: 'checkbox',
            checked: false,
            name: 'receive_nypd_sr_updates_by_email',
          },
        });
    });
    expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(false);

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

  test('drops a deleted submission from the cached submissions', async () => {
    localStorage.clear();
    writeCachedSubmissions([
      { objectId: 'deleted-submission' },
      { objectId: 'kept-submission' },
    ]);

    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const homeRef = React.createRef();
    const tree = renderHome({ initialState, homeRef });
    renderer.act(() => {
      homeRef.current.setState({
        submissions: [
          { objectId: 'deleted-submission' },
          { objectId: 'kept-submission' },
        ],
      });
    });

    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    await renderer.act(async () => {
      homeRef.current.onDeleteSubmission({ objectId: 'deleted-submission' });
      await new Promise(resolve => setImmediate(resolve));
    });

    // The cache must lose it too, or it would reappear on the next page load
    // until the background fetch replaces the cached list.
    expect(readCachedSubmissions()).toEqual([{ objectId: 'kept-submission' }]);
    expect(homeRef.current.state.submissions).toEqual([
      { objectId: 'kept-submission' },
    ]);

    confirm.mockRestore();
    axiosPost.mockRestore();
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

  describe('the report time', () => {
    // The state carries seconds and the `datetime-local` field shows minutes.
    // The two differ on purpose: iOS Safari rejects a value that carries
    // seconds with "enter a valid value" (see "Fix datetime-local input on iOS
    // by removing seconds", for issue #11), and that is a constraint on what
    // the field is given rather than on the time being reported.
    const renderTime = () => {
      const initialState = {
        email: 'test@example.com',
        loginSuccessful: true,
      };

      const originalCreateObjectURL = global.URL.createObjectURL;
      global.URL.createObjectURL = jest.fn(() => 'blob:mock');

      const homeRef = React.createRef();
      let tree;
      renderer.act(() => {
        tree = renderHome({ initialState, homeRef });
      });
      // The form's fields are rendered with the report's first attachment.
      renderer.act(() => {
        homeRef.current.setState({
          attachmentData: [
            new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
          ],
        });
      });

      return {
        homeRef,
        field: tree.root.findByProps({ name: 'CreateDate' }),
        cleanup: () => {
          tree.unmount();
          global.URL.createObjectURL = originalCreateObjectURL;
        },
      };
    };

    test('keeps the seconds in state, ready to be submitted', () => {
      const { homeRef, cleanup } = renderTime();

      expect(homeRef.current.state.CreateDate).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      );

      cleanup();
    });

    test('gives the field only the minutes, which is all it accepts', () => {
      const { homeRef, field, cleanup } = renderTime();

      const { CreateDate } = homeRef.current.state;
      expect(field.props.value).toBe(CreateDate.slice(0, 16));
      expect(field.props.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      // Shorter than the state it came from, which is the whole point: the
      // state carries seconds and the field would reject them. Comparing the
      // two is what keeps this from passing when the seconds are gone from
      // both.
      expect(field.props.value.length).toBeLessThan(CreateDate.length);

      cleanup();
    });

    test('takes a hand edit at the minute the field offers', () => {
      const { homeRef, field, cleanup } = renderTime();

      // What a `datetime-local` field hands its handler. The value has no
      // seconds because the field has none to offer.
      renderer.act(() => {
        field.props.onChange({
          target: {
            name: 'CreateDate',
            type: 'datetime-local',
            value: '2024-01-01T12:34',
          },
        });
      });

      expect(homeRef.current.state.CreateDate).toBe('2024-01-01T12:34');

      cleanup();
    });
  });

  describe('background attachment uploads', () => {
    // Renders the form as a logged-in user, disables the network-backed
    // extraction pipelines, and adds the given files through the same code
    // path as the file <input>. Returns spies for asserting on the
    // background upload and submit requests.
    async function renderWithFiles({ files, uploadError, submitErrors = [] }) {
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
      let submitCalls = 0;
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
          if (url === '/submit') {
            submitCalls += 1;
            const error = submitErrors[submitCalls - 1];
            if (error) {
              const rejection = Promise.reject(error);
              rejection.catch(() => {});
              return rejection;
            }
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
      const toastError = jest
        .spyOn(toast, 'error')
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
        // The report's own Submit button, for its disabled state.
        submitButton: () => {
          const form = tree.root
            .findAllByType('form')
            .find(formEl => typeof formEl.props.onSubmit === 'function');
          return form.findByProps({ type: 'submit' });
        },
        toastError,
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
        // No credentials in the body: the route authenticates from the
        // session cookie the browser sends.
        expect(body.get('email')).toBeNull();
        expect(body.get('password')).toBeNull();
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
      // The withhold and email-updates flags are sent alongside the rest of
      // the per-submission state, so the server can store them (sparsely)
      // when true.
      expect(submitBody.get('withhold_contact_info_from_nypd')).toBe('false');
      expect(submitBody.get('receive_nypd_sr_updates_by_email')).toBe('false');

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

    // The server holds a pre-uploaded attachment for an hour and loses every
    // one of them to a restart, so an id the page still holds can name a file
    // that is no longer there. The page has the bytes, so it sends them.
    test('sends the files when the server no longer has the attachments it was given', async () => {
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { homeRef, axiosPost, submit, toastError, cleanup } =
        await renderWithFiles({
          files: [photo],
          submitErrors: [
            {
              response: {
                data: {
                  error: {
                    message:
                      'Attachment not found; please re-add your files and try again',
                  },
                },
              },
            },
          ],
        });

      await submit();

      // The failure and the second read of the files are two more turns of the
      // chain, so let it finish before the tree goes away.
      await renderer.act(async () => {
        for (let i = 0; i < 4; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      const submitCalls = axiosPost.mock.calls.filter(
        ([url]) => url === '/submit',
      );
      expect(submitCalls).toHaveLength(2);

      // The first attempt is the ids one, and the retry carries the files
      // instead: the ids are what the server has lost.
      const [, firstBody] = submitCalls[0];
      expect(JSON.parse(firstBody.get('attachmentIds'))).toEqual([
        'uploaded-photo.jpg',
      ]);
      expect(firstBody.get('attachmentData[]')).toBeNull();

      const [, secondBody] = submitCalls[1];
      expect(secondBody.get('attachmentIds')).toBeNull();
      const submitted = secondBody.get('attachmentData[]');
      expect(submitted).not.toBe(photo);
      const submittedBytes = await blobUtil.blobToArrayBuffer(submitted);
      expect(Buffer.from(submittedBytes)).toEqual(Buffer.from('photo'));

      // The retry succeeded, so nothing was reported to the user and the
      // report left the form.
      expect(toastError).not.toHaveBeenCalled();
      expect(homeRef.current.state.attachmentData).toEqual([]);

      cleanup();
    });

    test('reports a submit failure that sending the files cannot fix', async () => {
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { axiosPost, submit, toastError, cleanup } = await renderWithFiles({
        files: [photo],
        submitErrors: [
          {
            response: {
              data: { error: { message: 'Something else went wrong' } },
            },
          },
        ],
      });

      await submit();

      await renderer.act(async () => {
        for (let i = 0; i < 4; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      // One attempt: there is nothing to try again with.
      expect(
        axiosPost.mock.calls.filter(([url]) => url === '/submit'),
      ).toHaveLength(1);
      expect(toastError.mock.calls[0][0]).toBe(
        'Error: Something else went wrong ',
      );

      cleanup();
    });

    test('caches the new submission so it survives into the next page load', async () => {
      localStorage.clear();
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { submit, cleanup } = await renderWithFiles({ files: [photo] });
      await submit();

      expect(readCachedSubmissions()).toEqual([
        {
          objectId: 'objectId123',
          timeofreport: '2020-01-01T00:00:00.000Z',
          timeofreported: '2020-01-01T00:00:00.000Z',
          // /submissions always includes the key, so the cached entry does too.
          tasks: [],
        },
      ]);

      cleanup();
    });

    test('caches the new submission ahead of the ones already cached', async () => {
      localStorage.clear();
      writeCachedSubmissions([{ objectId: 'olderSubmission' }]);

      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { submit, cleanup } = await renderWithFiles({ files: [photo] });
      await submit();

      expect(readCachedSubmissions().map(({ objectId }) => objectId)).toEqual([
        'objectId123',
        'olderSubmission',
      ]);

      cleanup();
    });

    test('does not cache anything when the submit request fails', async () => {
      localStorage.clear();
      const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
      const { axiosPost, submit, cleanup } = await renderWithFiles({
        files: [photo],
      });
      axiosPost.mockImplementation(() =>
        Promise.reject(new Error('submit failed')),
      );

      await submit();

      expect(readCachedSubmissions()).toBeNull();

      cleanup();
    });

    test('holds Submit while there are more than 3 pictures or 3 videos', async () => {
      const pictures = ['p1', 'p2', 'p3', 'p4'].map(
        name => new File(['picture'], `${name}.jpg`, { type: 'image/jpeg' }),
      );

      const { homeRef, submit, submitButton, toastError, cleanup } =
        await renderWithFiles({ files: pictures });

      // All four are attached: nothing here drops one, which is the point.
      expect(homeRef.current.state.attachmentData).toHaveLength(4);

      // The location is set rather than looked up, so that the refusal this
      // test is about is the one that comes back.
      renderer.act(() => {
        homeRef.current.setState({ latitude: 40.7129, longitude: -74.0061 });
      });

      expect(submitButton().props.disabled).toBe(true);

      // `createSubmission.js` keeps only the first three of each kind, so
      // without this the fourth would vanish between the form and the report.
      await submit();
      expect(toastError.mock.calls[0][0]).toBe(
        'A report can include at most 3 pictures and 3 videos. Remove the extra ones to submit it.',
      );

      // Three is a report, and Submit comes back.
      renderer.act(() => {
        const [first] = homeRef.current.state.attachmentData;
        homeRef.current.setState(state => ({
          attachmentData: state.attachmentData.filter(file => file !== first),
        }));
      });
      expect(submitButton().props.disabled).toBe(false);

      cleanup();
    });
  });

  test('asks for the previous submissions without posting anything', async () => {
    const axiosPost = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { submissions: [] } });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const homeRef = React.createRef();
    let tree;
    renderer.act(() => {
      tree = renderHome({ initialState: { loginSuccessful: true }, homeRef });
    });

    await renderer.act(async () => {
      await homeRef.current.loadPreviousSubmissions();
    });

    const call = axiosPost.mock.calls.find(([url]) => url === '/submissions');

    expect(call[0]).toBe('/submissions');
    // The route reads no body: it authenticates with the session cookie and
    // answers with this reader's submissions. It used to be handed the whole
    // form state, and axios sends every `File` in a body as a multipart file
    // part: with a plate picked off a photo in that state, the server's multer
    // refused the request outright and the previous submissions never loaded.
    expect(call[1]).toBeUndefined();

    tree.unmount();
    axiosPost.mockRestore();
    consoleError.mockRestore();
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
        // A third photo of the first car and a second of the second, so that a
        // car's photos can have another car's reading land between them.
        8: [
          plateResult({
            plate: 't696817c',
            candidates: [{ plate: 't6968i7c', score: 0.4 }],
          }),
        ],
        9: [plateResult({ plate: 'lda8765' })],
        // Two cars in the one frame, read where they are rather than from a
        // closeup: the frame is the only photo of each of them, and the two
        // readings sit in the same response.
        10: [
          plateResult({ plate: 'aaa111' }),
          plateResult({ plate: 'bbb222' }),
        ],
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
      8: '2024-01-01T12:00:03.000Z',
      9: '2024-01-01T12:00:04.000Z',
      10: '2024-01-01T12:02:00.000Z',
    };

    // Renders the form as a logged-in user with semi-automatic mode on, adds
    // the given files through the same entry point the folder and loose-file
    // inputs (and the drop and paste handlers) use, and lets the batch pass
    // finish. Returns the spied axios so the tests can count ALPR and geosearch
    // requests, and helpers that drive the rendered batch UI.
    async function renderBatchWithFiles(
      files,
      {
        // Answers a coordinate with its own address. The default mock answers
        // every coordinate the same way, which cannot show a stale address:
        // whichever one is on screen looks right.
        addressAt = () => ({ housenumber: '123', street: 'Main St' }),
        // Holds an ALPR response back by photo size, so a test can make a
        // photo finish before one that was started earlier. Three concurrent
        // requests do that on their own.
        alprDelayMsBySize = {},
        // Answers the plate reads with these call numbers (counting from
        // one) the way a rate limit does: a rejection carrying a 429, which
        // leaves that photo with no `plateResults` at all. The reads run in
        // capture order, so call 1 belongs to the earliest photo. Failing
        // only the batch's calls, and not the later ones, is what makes a
        // second chance testable.
        failAlprCalls = [],
      } = {},
    ) {
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
      let alprCalls = 0;
      // When each read was asked for, on a clock the tests do not mock: `Date`
      // is frozen for this file, and a spacing test needs real elapsed time.
      const alprCallTimes = [];
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockImplementation((url, body) => {
          if (url === '/platerecognizer') {
            alprCalls += 1;
            alprCallTimes.push(Number(process.hrtime.bigint()) / 1e6);
            if (failAlprCalls.includes(alprCalls)) {
              return Promise.reject(
                Object.assign(
                  new Error('Request failed with status code 429'),
                  { response: { status: 429 } },
                ),
              );
            }

            const { size } = body.get('attachmentFile');
            const delayMs = alprDelayMsBySize[size] || 0;

            return new Promise(resolve => {
              setTimeout(
                () => resolve({ data: plateResultsForSize(size) }),
                delayMs,
              );
            });
          }
          if (url === '/api/geosearch') {
            return Promise.resolve({
              data: {
                features: [
                  {
                    properties: {
                      ...addressAt(body),
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

      // A queue row's merge checkbox, found by the plate its label names.
      const mergeBox = text =>
        tree.root.findAllByType('input').find(({ props }) => {
          const label = props['aria-label'];
          return (
            typeof label === 'string' &&
            label.startsWith('Merge ') &&
            label.includes(text)
          );
        });

      return {
        homeRef,
        tree,
        axiosPost,
        toastSuccess,
        toastWarn,
        toastError,
        platerecognizerCalls: () =>
          axiosPost.mock.calls.filter(([url]) => url === '/platerecognizer'),
        // When each read was asked for, in milliseconds since an arbitrary
        // start, so a test can measure the spacing between them.
        platerecognizerCallTimes: () => [...alprCallTimes],
        // Loading a violation reads its unread plates in the background, and
        // nothing in the form waits for that. The promise it left on the
        // instance is what to wait for here: it resolves when the last of a
        // violation's photos has been read again.
        settle: async () =>
          renderer.act(async () => {
            await (homeRef.current.plateReread || Promise.resolve());
          }),
        geosearchCalls: () =>
          axiosPost.mock.calls.filter(([url]) => url === '/api/geosearch'),
        uploadAttachmentCalls: () =>
          axiosPost.mock.calls.filter(
            ([url]) => url === '/api/uploadAttachment',
          ),
        clickButton: text =>
          renderer.act(() => {
            findButton(text).props.onClick();
          }),
        // The merge button on the heading's line. It is always rendered, and
        // disabled until two rows are ticked.
        mergeButton: () => findButton('Merge'),
        // Press the trash on a photo's tile: the control that deletes the
        // photo, rather than the tick, which only leaves it out of the report.
        clickAttachmentDelete: name =>
          renderer.act(() => {
            tree.root
              .findAllByType('button')
              .find(({ props }) => props['aria-label'] === `Delete ${name}`)
              .props.onClick();
          }),
        // What the CreateDate field is given. It has to stay minute-precision
        // even though the state behind it carries seconds, because iOS Safari
        // rejects a `datetime-local` value that has them.
        createDateInputValue: () =>
          tree.root.findByProps({ name: 'CreateDate' }).props.value,
        // Put a queue row in the merge selection. A row opened with nothing
        // ticked is in already, so this ticks what is not ticked rather than
        // flipping it: it says the row is in, whatever the selection held
        // before.
        tickMerge: text =>
          renderer.act(() => {
            const box = mergeBox(text);
            if (!box.props.checked) {
              box.props.onChange();
            }
          }),
        // Take a queue row out of the merge selection, which is how a test
        // gets back to the empty selection the queue ticks a row on.
        untickMerge: text =>
          renderer.act(() => {
            const box = mergeBox(text);
            if (box.props.checked) {
              box.props.onChange();
            }
          }),
        // Load a violation the way the queue does: click the row's own text.
        // The description is the control, and the Delete and merge buttons are
        // separate buttons that do not carry the plate.
        clickQueueLoad: plate =>
          renderer.act(() => {
            tree.root
              .findAllByType('button')
              .find(({ children }) => children.join('').includes(plate))
              .props.onClick();
          }),
        // Press the X on the queue row whose description carries `plate`. The
        // control shows an emoji rather than a word, so it is found by the
        // label it announces.
        clickRowDelete: plate =>
          renderer.act(() => {
            tree.root
              .findAllByType('button')
              .find(({ props }) => {
                const label = props['aria-label'];
                return (
                  typeof label === 'string' &&
                  label.startsWith('Delete ') &&
                  label.includes(plate)
                );
              })
              .props.onClick();
          }),
        // Tick or untick one photo in a loaded group's attachment picker, by
        // the name its checkbox announces: the label is the photo itself, so
        // the name is not in its text.
        toggleAttachment: (name, checked) => {
          const input = tree.root
            .findAllByType('input')
            .find(({ props }) => props['aria-label'] === `Attach ${name}`);
          renderer.act(() => {
            input.props.onChange({ target: { checked } });
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
        // The report's own Submit button, for its disabled state.
        submitButton: () => {
          const form = tree.root
            .findAllByType('form')
            .find(formEl => typeof formEl.props.onSubmit === 'function');
          return form.findByProps({ type: 'submit' });
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

    test('uploads the violation it loads, not the folder it came from', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 6 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, uploadAttachmentCalls, cleanup } =
        await renderBatchWithFiles(photos);

      const uploaded = uploadAttachmentCalls().map(
        ([, body]) => body.get('attachmentData').name,
      );

      // Four photos went in and grouped into three violations. Only the one
      // that loaded was uploaded, and only the photos its report holds: the
      // rest of the folder is never sent anywhere.
      expect(homeRef.current.state.batchViolations).toHaveLength(3);
      expect(uploaded.length).toBeLessThan(photos.length);
      expect(uploaded).toEqual(
        homeRef.current.state.attachmentData.map(file => file.name),
      );

      cleanup();
    });

    test('groups the batch, looks each place up once, and loads the first violation as it settles', async () => {
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
        createDateInputValue,
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

      // The first violation is loaded as soon as it settles, without waiting to
      // be asked: nothing is clicked here.
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
      // Seconds and all: the EXIF time is 12:00:00Z, less the -05:00 the
      // camera recorded. They are what the batch groups on, and the
      // `datetime-local` field shows only the first 16 characters.
      expect(state.CreateDate).toBe('2024-01-01T07:00:00');

      // And the field itself still shows only minutes.
      expect(createDateInputValue()).toBe('2024-01-01T07:00');

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

    test('loads a violation when its row is clicked, and ignores a click on the one already loaded', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 6 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, clickQueueLoad, cleanup } =
        await renderBatchWithFiles(photos);

      expect(homeRef.current.state.batchViolations).toHaveLength(3);

      // Jump to the last violation, out of the queue's own order.
      clickQueueLoad('K73JAU');
      expect(homeRef.current.state.currentViolationIndex).toBe(2);
      expect(homeRef.current.state.plate).toBe('K73JAU');
      expect(homeRef.current.state.attachmentData).toEqual([photos[3]]);

      // And back to the first.
      clickQueueLoad('T696817C');
      expect(homeRef.current.state.currentViolationIndex).toBe(0);
      expect(homeRef.current.state.plate).toBe('T696817C');
      expect(homeRef.current.state.attachmentData).toEqual([
        photos[0],
        photos[1],
      ]);

      // Loading the violation that is already loaded must be a no-op. Loading
      // resets the attachment selection to the group's default, so a reload
      // here would silently undo a swap made with the picker -- stand in for
      // one by leaving a single photo attached.
      homeRef.current.setState({ attachmentData: [photos[0]] });
      clickQueueLoad('T696817C');
      expect(homeRef.current.state.currentViolationIndex).toBe(0);
      expect(homeRef.current.state.attachmentData).toEqual([photos[0]]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('asks for a rate-limited plate read to be retried', async () => {
      const photos = [jpeg({ name: 'a.jpg', size: 4 })];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { platerecognizerCalls, cleanup } =
        await renderBatchWithFiles(photos);

      // What a repeat is worth is `plateReadRetry`'s, and that module's own
      // test drives a real axios instance through those options. This is the
      // other half: that the plate read asks for it. Whether the repeat then
      // happens cannot be watched from here -- mocking `axios.post` replaces
      // the very method whose interceptors do the retrying.
      const [[, , config]] = platerecognizerCalls();
      expect(config['axios-retry']).toBe(plateReadRetry);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('spaces the reads out once one of them is refused', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 6 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      // The first read is refused, and the three after it are held back just
      // long enough that the refusal is known before the fourth read is
      // started by whichever worker frees up first.
      const { platerecognizerCallTimes, cleanup } = await renderBatchWithFiles(
        photos,
        {
          failAlprCalls: [1],
          alprDelayMsBySize: { 5: 300, 6: 300, 7: 300 },
        },
      );

      // The batch's four reads; anything after them is the second chance the
      // load gives the photo that was refused.
      const times = platerecognizerCallTimes().slice(0, 4);
      expect(times).toHaveLength(4);

      // The first three start together, which is what the pool does until
      // something is refused.
      expect(times[2] - times[0]).toBeLessThan(200);

      // The read after the refusal waits out the second the API asked for
      // instead of spending itself on the same limit.
      expect(times[3] - times[0]).toBeGreaterThanOrEqual(1000);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('reads a plate again when the violation is loaded, after a read the 429 refused', async () => {
      const photos = [jpeg({ name: 'a.jpg', size: 4 })];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      // The batch's one read is answered the way a rate limit answers it. The
      // photo is left with no `plateResults` at all, which is what used to be
      // final: the row read "(no plate read)" and the form opened with an
      // empty License field, however readable the picture was.
      const { homeRef, settle, platerecognizerCalls, cleanup } =
        await renderBatchWithFiles(photos, { failAlprCalls: [1] });

      await settle();

      // Two calls in all: the one the 429 refused, and the one the load made.
      // A read that had succeeded is not repeated -- the test below holds
      // that -- so the second call can only be the second chance.
      expect(platerecognizerCalls()).toHaveLength(2);
      expect(homeRef.current.state.batchViolations[0].plate).toBe('T696817C');
      expect(homeRef.current.state.plate).toBe('T696817C');

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('reads again only the photos the batch could not read', async () => {
      // Two photos of one medallion plate, a second apart, so they group into
      // one violation -- the second read is the one that fails.
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, settle, platerecognizerCalls, cleanup } =
        await renderBatchWithFiles(photos, { failAlprCalls: [2] });

      expect(homeRef.current.state.batchViolations).toHaveLength(1);

      await settle();

      // Three calls, not four: the photo that read is answered from the
      // cache, so only the one that failed is read again. A photo that read
      // cleanly and found nothing is not re-read either -- there is nothing
      // to learn from asking twice.
      expect(platerecognizerCalls()).toHaveLength(3);
      expect(homeRef.current.state.batchViolations[0].plate).toBe('T696817C');
      expect(homeRef.current.state.plate).toBe('T696817C');

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('divides a row the second chance shows to be two cars', async () => {
      // A photo of one car and a photo of another, a minute apart, which the
      // time window leaves in one row. Both reads are refused, so until the
      // second chance reads them the row has no plate to divide it by.
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, settle, platerecognizerCalls, cleanup } =
        await renderBatchWithFiles(photos, { failAlprCalls: [1, 2] });

      await settle();

      // The second chance read both photos, they disagree, and the row divides
      // into the two cars it was holding. Four calls in all: the batch's two,
      // and the two the second chance made.
      expect(platerecognizerCalls()).toHaveLength(4);
      expect(
        homeRef.current.state.batchViolations.map(violation => violation.plate),
      ).toEqual(['T696817C', 'K73JAU']);

      // The form was on the row when it divided, so it is on one of the two
      // now -- the one holding the photos it had attached -- with that car's
      // plate rather than an empty field.
      expect(homeRef.current.state.plate).toBe('T696817C');
      expect(homeRef.current.state.attachmentData).toEqual([photos[0]]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('shows the address of the violation that was clicked, not the last one', async () => {
      const photos = [
        jpeg({ name: 'near.jpg', size: 4 }),
        jpeg({ name: 'far.jpg', size: 7 }),
      ];

      // Two different places in Manhattan, a minute apart, so each photo is a
      // violation of its own with its own address.
      const gpsBySize = {
        4: { latitude: 40.7129, longitude: -74.0061 },
        7: { latitude: 40.758, longitude: -73.9855 },
      };
      exifr.gps.mockImplementation(
        async arrayBuffer => gpsBySize[arrayBuffer.byteLength],
      );
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, clickQueueLoad, cleanup } = await renderBatchWithFiles(
        photos,
        {
          addressAt: ({ lat }) =>
            lat === gpsBySize[4].latitude
              ? { housenumber: '123', street: 'Main St' }
              : { housenumber: '9', street: 'Elm St' },
        },
      );

      expect(homeRef.current.state.batchViolations).toHaveLength(2);

      // The first violation loads on its own, with the address for its place.
      expect(homeRef.current.state.formatted_address).toBe(
        '123 Main St, Manhattan',
      );

      // Clicking Load on the second has to bring its address with it.
      clickQueueLoad('K73JAU');
      expect(homeRef.current.state.formatted_address).toBe(
        '9 Elm St, Manhattan',
      );

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('keeps a violation together when its photos finish out of order', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      // `a` and `b` are one second apart and are one violation; `c` is a
      // minute later and is its own. Holding `b` back makes `c` finish first,
      // which is what three concurrent requests do on their own -- and `c` is
      // a minute ahead, so treating it as the boundary would call the first
      // violation final while `b` was still in flight.
      const { homeRef, cleanup } = await renderBatchWithFiles(photos, {
        alprDelayMsBySize: { 5: 30 },
      });

      expect(
        homeRef.current.state.batchViolations.map(v => [
          v.plate,
          v.photos.length,
        ]),
      ).toEqual([
        ['T696817C', 2],
        ['K73JAU', 1],
      ]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('lists the queue oldest first when photos arrive in more than one pick', async () => {
      const early = jpeg({ name: 'early.jpg', size: 4 });
      const late = jpeg({ name: 'late.jpg', size: 7 });

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      // `late.jpg` is shot a minute after `early.jpg` and is added first, so it
      // is the violation published first. The queue still has to read oldest
      // first, which means the later pick has to sort in front of it.
      const { homeRef, cleanup } = await renderBatchWithFiles([late]);

      expect(homeRef.current.state.plate).toBe('K73JAU');

      await renderer.act(async () => {
        await homeRef.current.addFilesToBatch([early]);
        await new Promise(resolve => setImmediate(resolve));
      });

      expect(homeRef.current.state.batchViolations.map(v => v.plate)).toEqual([
        'T696817C',
        'K73JAU',
      ]);

      // The loaded violation is followed by identity, so the re-sort does not
      // leave the form pointing at whichever violation took its index.
      expect(homeRef.current.state.currentViolationIndex).toBe(1);
      expect(homeRef.current.state.plate).toBe('K73JAU');

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    // A batch shot inside the linking window is one time-cluster, and the
    // readings are what tell the cars in it apart. They arrive one at a time,
    // in whatever order the pass gets through them, and a car's photos can
    // have another car's reading land between them. Every read has to be
    // weighed against the whole batch: a read that only re-groups the row it
    // lands in leaves the rows the earlier reads broke apart to stand, so a
    // cluster of two cars settles as one row per photo read.
    test('settles a time-cluster into one row per car, whatever order the reads arrive in', async () => {
      // Three photos of one car and two of another, all inside the linking
      // window, listed here in capture order.
      const photos = [
        jpeg({ name: 'first.jpg', size: 4 }),
        jpeg({ name: 'second.jpg', size: 5 }),
        jpeg({ name: 'other-car.jpg', size: 6 }),
        jpeg({ name: 'third.jpg', size: 8 }),
        jpeg({ name: 'other-car-again.jpg', size: 9 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, cleanup } = await renderBatchWithFiles(photos, {
        // These answers come back 4, 6, 5, 9, 8: the other car's reading lands
        // between the first car's first and second, and the first car's third
        // photo is answered last of all. Three reads run at once, so the
        // second and third photos start together and the fourth and fifth take
        // the slots the first two leave.
        alprDelayMsBySize: { 4: 0, 5: 200, 6: 100, 8: 800, 9: 400 },
      });

      const { batchViolations } = homeRef.current.state;
      expect(
        batchViolations.map(violation => [
          violation.plate,
          violation.photos.map(photo => photo.name),
        ]),
      ).toEqual([
        ['T696817C', ['first.jpg', 'second.jpg', 'third.jpg']],
        ['LDA8765', ['other-car.jpg', 'other-car-again.jpg']],
      ]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('puts the rows on screen before a plate is read', async () => {
      const photos = [
        jpeg({ name: 'a.jpg', size: 4 }),
        jpeg({ name: 'b.jpg', size: 5 }),
        jpeg({ name: 'c.jpg', size: 6 }),
        jpeg({ name: 'd.jpg', size: 7 }),
      ];

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, cleanup } = await renderBatchWithFiles([]);

      // What the queue looked like when it was published. The batch's dates and
      // places are local work and the plates are not, so this is the moment the
      // rows can first be on screen -- and the whole point of publishing here
      // is that it is not after the last read, which for a batch shot inside
      // the linking window was the only moment the old rule allowed.
      const original = homeRef.current.publishBatchViolations;
      const passes = [];
      jest
        .spyOn(homeRef.current, 'publishBatchViolations')
        .mockImplementation(async options => {
          const result = await original.call(homeRef.current, options);
          const { batchPhotos, batchViolations } = homeRef.current.state;
          passes.push({
            reads: batchPhotos.filter(photo => photo.plateRead).length,
            violations: batchViolations.length,
          });
          return result;
        });

      await renderer.act(async () => {
        await homeRef.current.addFilesToBatch(photos);
        // The per-photo passes are not awaited by the worker that starts them,
        // so let anything still settling finish before asserting on it.
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain; the rounds are the point.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      // One publish, of the whole batch, with every row in it and no plate read
      // yet: the four photos are one time-cluster, because the plate that
      // divides them has not been read.
      expect(passes).toEqual([{ reads: 0, violations: 1 }]);

      // And it is still the grouping that decides, once the plates are in: the
      // row divided as they arrived, so the queue ends up with one row per car.
      expect(
        homeRef.current.state.batchViolations.map(v => [
          v.plate,
          v.photos.length,
        ]),
      ).toEqual([
        ['T696817C', 2],
        ['LDA8765', 1],
        ['K73JAU', 1],
      ]);
      expect(homeRef.current.state.batchProgress).toBeNull();

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('merges the violations the user ticks together', async () => {
      // The shape this exists for: a far shot with no plate read, three
      // minutes before the closeup that names the car. The time window keeps
      // them apart, and only the user knows they are one report.
      const farAt = 1704108600000;
      const nearAt = 1704110400000;
      const photoAt = (name, createDateMs) => ({
        file: new File(['picture'], name, { type: 'image/jpeg' }),
        name,
        createDateMs,
      });
      const farPhoto = photoAt('far.jpg', farAt);
      const nearPhoto = photoAt('near.jpg', nearAt);
      const photos = [farPhoto, nearPhoto];
      const far = {
        photos: [farPhoto],
        plate: '',
        licenseState: '',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: farAt,
      };
      const near = {
        photos: [nearPhoto],
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: nearAt,
      };

      const { homeRef, tickMerge, clickButton, mergeButton, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [far, near],
        });
      });

      expect(homeRef.current.state.batchViolations).toHaveLength(2);

      // The button holds its place on the heading's line from the start, so
      // that ticking a row cannot move the list. It is disabled until there
      // are two rows to combine.
      expect(mergeButton().props.disabled).toBe(true);

      tickMerge('nothing readable');

      // One is not a merge.
      expect(mergeButton().props.disabled).toBe(true);

      tickMerge('T696817C');
      expect(mergeButton().props.disabled).toBe(false);
      clickButton('Merge');

      const { batchViolations, batchMergeSelection } = homeRef.current.state;

      expect(batchViolations).toHaveLength(1);
      // The plate survives: the far shot had none to offer.
      expect(batchViolations[0].plate).toBe('T696817C');
      // Both photos, oldest first, and the earlier one's time.
      expect(batchViolations[0].photos.map(photo => photo.name)).toEqual([
        'far.jpg',
        'near.jpg',
      ]);
      expect(batchViolations[0].createDateMs).toBe(farAt);
      expect(batchMergeSelection).toEqual([]);

      cleanup();
    });

    test('keeps a row the user merged when a read lands on it afterwards', async () => {
      // Two cars at one kerb, read apart by the grouping and put together by
      // the user: their report, for whatever reason they have.
      const first = jpeg({ name: 'first.jpg', size: 4 });
      const other = jpeg({ name: 'other.jpg', size: 6 });

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, tickMerge, clickButton, cleanup } =
        await renderBatchWithFiles([first, other]);

      expect(
        homeRef.current.state.batchViolations.map(violation => violation.plate),
      ).toEqual(['T696817C', 'LDA8765']);

      tickMerge('T696817C');
      tickMerge('LDA8765');
      clickButton('Merge');
      expect(homeRef.current.state.batchViolations).toHaveLength(1);

      // A read lands on one of the row's photos afterwards -- the second
      // chance a failed read gets when the row is opened, say. Grouping the
      // batch again would take the two cars apart; the row the user made is
      // left as it is.
      const [merged] = homeRef.current.state.batchViolations;
      const [photo] = merged.photos;
      renderer.act(() => {
        homeRef.current.setState(
          homeRef.current.applyPlateRead({
            photo,
            read: { ...photo, plateResults: photo.plateResults },
          }),
        );
      });

      const { batchViolations } = homeRef.current.state;
      expect(batchViolations).toHaveLength(1);
      expect(batchViolations[0].photos.map(p => p.name)).toEqual([
        'first.jpg',
        'other.jpg',
      ]);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    // A row is one violation, and a violation is what its photos say it is: a
    // reading still to come can take a photo, and the ones reading with it,
    // into a row of their own. Until the readings are in, the row is a guess.
    test('says a row may split while some of its photos are still being read', async () => {
      // Two photos of one car. The first is read at once, which is what puts a
      // plate on the row and makes it look settled; the second is held back.
      const first = jpeg({ name: 'a.jpg', size: 4 });
      const second = jpeg({ name: 'b.jpg', size: 5 });

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, tree, cleanup } = await renderBatchWithFiles([], {
        alprDelayMsBySize: { 5: 500 },
      });

      let adding;
      renderer.act(() => {
        adding = homeRef.current.addFilesToBatch([first, second]);
      });

      // The row is up as soon as the local metadata pass is done, with one
      // reading in and one still out.
      await renderer.act(async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
      });

      const reading = renderedText(tree.toJSON());
      expect(reading).toContain('T696817C (2 photos)');
      expect(reading).toContain('may split');

      await renderer.act(async () => {
        await adding;
      });

      // Every reading is in, so the row is what its photos say it is.
      expect(renderedText(tree.toJSON())).not.toContain('may split');

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('says a row is still reading while a reading it lost is tried again', async () => {
      const photo = jpeg({ name: 'a.jpg', size: 4 });

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, tree, settle, cleanup } = await renderBatchWithFiles(
        [photo],
        // The batch's own reading is refused, and the second chance is held
        // back so the queue can be read while it is out.
        { failAlprCalls: [1], alprDelayMsBySize: { 4: 500 } },
      );

      // The pass is over and the row's one photo has no reading: what the row
      // says now is what a second chance is doing. Opening the row starts it,
      // and the row opens itself as soon as it settles.
      expect(homeRef.current.state.batchProgress).toBeNull();

      await renderer.act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Not "nothing readable": a reading is out, and the row says so.
      expect(renderedText(tree.toJSON())).toContain('reading plates…');

      await settle();

      expect(renderedText(tree.toJSON())).toContain('T696817C');
      expect(renderedText(tree.toJSON())).not.toContain('may split');

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    // A row's tick is for merging it with another row, and a row opened with
    // nothing ticked is the one a merge usually starts from: it ticks itself,
    // so that putting it together with the row beside it is one tick rather
    // than two. Opening a row never adds to a selection that is already there.
    test('ticks the row opened when nothing is ticked', async () => {
      const photos = ['a', 'b'].map(name => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return { file, name: file.name, createDateMs: 1704110400000 };
      });
      const row = (photo, plate, createDateMs) => ({
        photos: [photo],
        plate,
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs,
      });
      // What a tick names: the row's time, its plate, and the photo it opens
      // with. See `batchViolationIdentity`.
      const identity = (photo, plate, createDateMs) =>
        `${createDateMs}-${plate}-${photo.name}`;

      const { homeRef, clickQueueLoad, tickMerge, untickMerge, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        homeRef.current.geosearchAddressCache.set({
          latitude: 40.7129,
          longitude: -74.0061,
          address: '123 Main St, Manhattan',
        });
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [
            row(photos[0], 'AAA111', 1704110400000),
            row(photos[1], 'BBB222', 1704110500000),
          ],
        });
      });

      // Nothing is opened yet, so nothing is ticked.
      expect(homeRef.current.state.batchMergeSelection).toEqual([]);

      // The first row opened ticks itself: nothing was ticked when it was
      // clicked.
      clickQueueLoad('AAA111');
      expect(homeRef.current.state.batchMergeSelection).toEqual([
        identity(photos[0], 'AAA111', 1704110400000),
      ]);

      // A selection is already there, so opening another row does not touch it.
      clickQueueLoad('BBB222');
      expect(homeRef.current.state.batchMergeSelection).toEqual([
        identity(photos[0], 'AAA111', 1704110400000),
      ]);

      tickMerge('BBB222');
      expect(homeRef.current.state.batchMergeSelection).toEqual([
        identity(photos[0], 'AAA111', 1704110400000),
        identity(photos[1], 'BBB222', 1704110500000),
      ]);

      // Empty again, so the next row opened ticks itself.
      untickMerge('AAA111');
      untickMerge('BBB222');
      expect(homeRef.current.state.batchMergeSelection).toEqual([]);

      clickQueueLoad('AAA111');
      expect(homeRef.current.state.batchMergeSelection).toEqual([
        identity(photos[0], 'AAA111', 1704110400000),
      ]);

      cleanup();
    });

    // One frame can hold several cars, and the row of each of them opens with
    // that same picture: what tells those rows apart, to the queue and to the
    // person reading it, is the plate.
    test('ticks the row a plate names, not every row showing its picture', async () => {
      const frame = new File(['picture'], 'wide.jpg', { type: 'image/jpeg' });
      const photo = {
        file: frame,
        name: frame.name,
        createDateMs: 1704110400000,
      };
      const row = plate => ({
        photos: [photo],
        plate,
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: 1704110400000,
      });

      const { homeRef, tickMerge, clickButton, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        homeRef.current.setState({
          batchPhotos: [photo],
          batchViolations: [row('AAA111'), row('BBB222'), row('CCC333')],
        });
      });

      tickMerge('BBB222');
      expect(homeRef.current.state.batchMergeSelection).toEqual([
        '1704110400000-BBB222-wide.jpg',
      ]);

      // Two ticks are two rows, so the merge has something to combine.
      tickMerge('AAA111');
      clickButton('Merge');
      expect(homeRef.current.state.batchViolations).toHaveLength(2);
      expect(
        homeRef.current.state.batchViolations.map(violation => violation.plate),
      ).toContain('CCC333');

      cleanup();
    });

    test('does not load a violation when its delete or merge control is used', async () => {
      const photos = ['a', 'b'].map(name => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return { file, name: file.name, createDateMs: 1704110400000 };
      });
      const violation = (photo, plate, createDateMs) => ({
        photos: [photo],
        plate,
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs,
      });

      const { homeRef, tickMerge, clickRowDelete, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [
            violation(photos[0], 'AAA111', 1704110400000),
            violation(photos[1], 'BBB222', 1704110500000),
          ],
        });
      });

      // Nothing is loaded, and neither control beside the description may
      // load one: they are siblings of it, not children.
      expect(homeRef.current.state.currentViolationIndex).toBe(-1);

      tickMerge('AAA111');
      expect(homeRef.current.state.batchMergeSelection).toHaveLength(1);
      expect(homeRef.current.state.currentViolationIndex).toBe(-1);

      clickRowDelete('AAA111');
      expect(homeRef.current.state.batchViolations).toHaveLength(1);
      expect(homeRef.current.state.currentViolationIndex).toBe(-1);

      cleanup();
    });

    // The row is the report: with nothing attached there is nothing to file,
    // so the violation goes rather than sitting there as an empty shell.
    const oneRowOf = async photos => {
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: 1704110400000,
      };

      const rendered = await renderBatchWithFiles([]);

      renderer.act(() => {
        rendered.homeRef.current.geosearchAddressCache.set({
          latitude: 40.7129,
          longitude: -74.0061,
          address: '123 Main St, Manhattan',
        });
        rendered.homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [violation],
        });
      });
      rendered.clickQueueLoad('T696817C');

      return { ...rendered, violation };
    };

    // The queue can come by its first row without a read landing to notice it:
    // the photos a report left behind are published as a row of their own, and
    // with the form sitting empty the row has to open itself, or the user is
    // left looking at a queue they have to click into.
    test('opens on the violation a submit leaves behind', async () => {
      const photos = ['p1', 'p2', 'p3', 'p4'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          // Read, as the batch's own pass leaves them: a row that has been
          // read is a violation the queue can open on.
          plateRead: 'read',
          createDateMs: 1704110400000 + index * 1000,
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });

      const { homeRef, submit, cleanup } = await oneRowOf(photos);

      // Three fit, so the fourth is left behind and the queue empties when the
      // report goes.
      await submit();
      await renderer.act(async () => {
        for (let i = 0; i < 3; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      const { batchViolations, currentViolationIndex, attachmentData } =
        homeRef.current.state;

      expect(batchViolations.map(violation => violation.photos.length)).toEqual(
        [1],
      );
      expect(currentViolationIndex).toBe(0);
      expect(attachmentData.map(file => file.name)).toEqual(['p4.jpg']);

      cleanup();
    });

    test('removes the violation when the X takes its last photo', async () => {
      const photos = ['p1', 'p2'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          createDateMs: 1704110400000 + index * 1000,
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });

      const { homeRef, clickAttachmentDelete, cleanup } =
        await oneRowOf(photos);

      clickAttachmentDelete('p1.jpg');

      // One photo is still a report, so the row stays.
      expect(homeRef.current.state.batchViolations).toHaveLength(1);
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['p2.jpg']);

      clickAttachmentDelete('p2.jpg');

      expect(homeRef.current.state.batchViolations).toEqual([]);
      // The photos went with the row: nothing is left to report from them.
      expect(homeRef.current.state.batchPhotos).toEqual([]);

      cleanup();
    });

    // The picker is the report's own selection, and a violation with more than
    // three photos is one whose picker exists: unticking every photo leaves the
    // violation where it is, with nothing attached, so that any of them can be
    // ticked again. None of its photos have been removed.
    test('keeps the violation when the picker unticks every photo', async () => {
      const photos = ['p1', 'p2', 'p3', 'p4'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          createDateMs: 1704110400000 + index * 1000,
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });

      const { homeRef, tree, cleanup } = await oneRowOf(photos);

      // The picker only appears for a violation with more than three photos.
      const pickerBox = name =>
        tree.root.findByProps({
          id: `batch-photo-${photos.findIndex(p => p.name === name)}`,
        });
      const untick = name =>
        renderer.act(() => {
          pickerBox(name).props.onChange({ target: { checked: false } });
        });

      untick('p1.jpg');
      untick('p2.jpg');
      untick('p3.jpg');

      expect(homeRef.current.state.attachmentData).toEqual([]);
      expect(homeRef.current.state.batchViolations).toHaveLength(1);
      expect(homeRef.current.state.batchPhotos).toEqual(photos);

      // And back again: the violation never went anywhere.
      renderer.act(() => {
        pickerBox('p4.jpg').props.onChange({ target: { checked: true } });
      });
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['p4.jpg']);

      cleanup();
    });

    // The picker shows the violation's photos rather than their names: a name
    // is hard to tell one photo from another by, and the picture is what the
    // report is about. Each carries its own box at the top-left, so ticking
    // one is a click on the picture.
    test('shows the violation photos as pictures, one box each', async () => {
      const photos = ['p1', 'p2', 'p3', 'p4'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          createDateMs: 1704110400000 + index * 1000,
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });

      const { tree, cleanup } = await oneRowOf(photos);

      // One choice per photo the violation holds, each its own picture, and
      // each with the trash that deletes it rather than leaving it out.
      const choices = tree.root
        .findAllByType('input')
        .filter(({ props }) => String(props.id).startsWith('batch-photo-'));
      expect(choices).toHaveLength(photos.length);

      choices.forEach((choice, index) => {
        const tile = choice.parent;
        const [picture] = tile.findAllByType('img');
        expect(picture.props.alt).toBe(photos[index].name);
        expect(picture.props.src).toBe('blob:mock');
        // The box, ticked for the three the violation loaded with: a picture
        // with three is what fits in a report.
        expect(choice.props.checked).toBe(index < 3);
        expect(
          tile
            .findAllByType('button')
            .some(
              ({ props }) =>
                props['aria-label'] === `Delete ${photos[index].name}`,
            ),
        ).toBe(true);
      });

      cleanup();
    });

    // The picker decides what the report holds, and the report's time and place
    // come from the photos it holds. A photo the picker ticks is the same
    // evidence as one attached on load, so it has to feed them the same way: a
    // report made only of photos the load never attached has none otherwise,
    // and the form falls back to the default place, which empties the address.
    test('takes the place from the photos ticked in the picker', async () => {
      const photos = ['p1', 'p2', 'p3', 'p4', 'p5'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          createDateMs: 1704110400000 + index * 1000,
          // The place `oneRowOf` has already had looked up.
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });

      const { homeRef, tree, cleanup } = await oneRowOf(photos);

      const pickerBox = name =>
        tree.root.findByProps({
          id: `batch-photo-${photos.findIndex(p => p.name === name)}`,
        });
      const tick = (name, checked) =>
        renderer.act(() => {
          pickerBox(name).props.onChange({ target: { checked } });
        });

      // Three pictures fit, so the first three are attached and the rest are
      // the picker's to choose. The place, and the address, came from them.
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg']);
      expect(homeRef.current.state.formatted_address).toBe(
        '123 Main St, Manhattan',
      );

      // A report made of two the load never attached.
      tick('p1.jpg', false);
      tick('p2.jpg', false);
      tick('p3.jpg', false);
      tick('p4.jpg', true);
      tick('p5.jpg', true);

      // The two the report now holds know where they were, and that is where
      // the report is -- with its address.
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['p4.jpg', 'p5.jpg']);
      expect(homeRef.current.state.latitude).toBe(40.7129);
      expect(homeRef.current.state.longitude).toBe(-74.0061);
      expect(homeRef.current.state.formatted_address).toBe(
        '123 Main St, Manhattan',
      );

      cleanup();
    });

    // The trash deletes the photo, and a photo is the batch's, not a row's:
    // one frame is evidence for every car in it, so deleting it takes it from
    // every row that holds it, and a row that was only that photo goes.
    test('deletes a shared photo from every row that holds it', async () => {
      const photo = name => ({
        file: new File(['picture'], name, { type: 'image/jpeg' }),
        name,
        createDateMs: 1704110400000,
        latitude: 40.7129,
        longitude: -74.0061,
      });
      const wide = photo('wide.jpg');
      const closeup = photo('closeup.jpg');
      const row = (plate, photos) => ({
        photos,
        plate,
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: 1704110400000,
      });

      const rendered = await renderBatchWithFiles([]);
      const { homeRef, clickQueueLoad, clickAttachmentDelete, cleanup } =
        rendered;

      renderer.act(() => {
        homeRef.current.geosearchAddressCache.set({
          latitude: 40.7129,
          longitude: -74.0061,
          address: '123 Main St, Manhattan',
        });
        homeRef.current.setState({
          batchPhotos: [wide, closeup],
          batchViolations: [
            row('AAA111', [wide, closeup]),
            row('BBB222', [wide]),
          ],
        });
      });
      clickQueueLoad('AAA111');

      clickAttachmentDelete('wide.jpg');

      // The row that held only the frame goes with it. The row that is left
      // keeps the photo of its own, and the frame is in neither the rows nor
      // the batch, so nothing can put it back.
      expect(
        homeRef.current.state.batchViolations.map(violation => violation.plate),
      ).toEqual(['AAA111']);
      expect(homeRef.current.state.batchViolations[0].photos).toEqual([
        closeup,
      ]);
      expect(homeRef.current.state.batchPhotos).toEqual([closeup]);

      // Nor can a reading that lands afterwards build it back into the rows:
      // the regrouping works from the photos the rows hold, and no row holds
      // it any more.
      renderer.act(() => {
        const [remaining] = homeRef.current.state.batchPhotos;
        homeRef.current.setState(
          homeRef.current.applyPlateRead({
            photo: remaining,
            read: { ...remaining },
          }),
        );
      });

      expect(
        homeRef.current.state.batchViolations.map(violation =>
          violation.photos.map(each => each.name),
        ),
      ).toEqual([['closeup.jpg']]);

      cleanup();
    });

    // Two rows read from one frame: submitting the first takes the frame out
    // of the batch with it, and the row that shared it is still a violation
    // with a report of its own to make. It has to stay on screen -- it used to
    // go with the frame, and come back when the next batch put photos into the
    // batch again, which reads as a violation resurrecting.
    test('keeps a row on screen when a submitted row takes the last photo', async () => {
      const frame = jpeg({ name: 'frame.jpg', size: 10 });

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, tree, submit, cleanup } = await renderBatchWithFiles([
        frame,
      ]);

      const settled = async () => {
        await renderer.act(async () => {
          for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
            await new Promise(resolve => setImmediate(resolve));
          }
        });
      };

      // The queue row itself, by the label its delete control announces --
      // not by the plate's name on screen, which the form's plate suggestions
      // carry whether or not the row is there.
      const rowOnScreen = plate =>
        tree.root.findAllByType('button').some(({ props }) => {
          const label = props['aria-label'];
          return (
            typeof label === 'string' &&
            label.startsWith('Delete ') &&
            label.includes(plate)
          );
        });

      expect(homeRef.current.state.batchViolations.map(v => v.plate)).toEqual([
        'AAA111',
        'BBB222',
      ]);

      await submit();
      await settled();

      // The frame went with the submitted report. The row that is left holds
      // it, so it is still in the queue, and still on screen.
      expect(homeRef.current.state.batchPhotos).toEqual([]);
      expect(homeRef.current.state.batchViolations.map(v => v.plate)).toEqual([
        'BBB222',
      ]);
      expect(rowOnScreen('BBB222')).toBe(true);

      // The next batch does not bring anything back with it: the row was here
      // all along, and the new one joins it.
      await renderer.act(async () => {
        await homeRef.current.addFilesToBatch([
          jpeg({ name: 'later.jpg', size: 4 }),
        ]);
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
      });
      await settled();

      // Oldest first, as the queue lists them: the new photo was taken before
      // the frame, so its row comes first.
      expect(homeRef.current.state.batchViolations.map(v => v.plate)).toEqual([
        'T696817C',
        'BBB222',
      ]);
      expect(rowOnScreen('BBB222')).toBe(true);

      exifr.gps.mockReset();
      exifr.parse.mockReset();
      cleanup();
    });

    test('gives the photos left out of a report a violation of their own', async () => {
      // What the metadata pass hands back for each photo: the camera's own
      // time and place. A violation takes its time and place from these, so a
      // fixture without them describes a violation the app cannot build.
      const photos = ['p1', 'p2', 'p3', 'p4'].map((name, index) => {
        const file = new File(['picture'], `${name}.jpg`, {
          type: 'image/jpeg',
        });
        return {
          file,
          name: file.name,
          createDateMs: 1704110400000 + index * 1000,
          latitude: 40.7129,
          longitude: -74.0061,
        };
      });
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs: 1704110400000,
      };

      const { homeRef, clickQueueLoad, submit, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
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
      clickQueueLoad('T696817C');

      // Only three pictures fit, so the fourth starts unattached.
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg']);

      await submit();

      // The regroup happens off the submit's own path, so let it land.
      await renderer.act(async () => {
        for (let i = 0; i < 3; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      const { batchPhotos, batchViolations } = homeRef.current.state;

      // Only the attached photos left the batch, which is what the picker
      // promises when it says the rest stay.
      expect(batchPhotos.map(photo => photo.name)).toEqual(['p4.jpg']);

      // And the one left behind has a violation already, rather than waiting
      // for the user to add another photo before it appears.
      expect(batchViolations).toHaveLength(1);
      expect(batchViolations[0].photos.map(photo => photo.name)).toEqual([
        'p4.jpg',
      ]);

      cleanup();
    });

    // A violation's time and place come from its earliest photo, so which
    // photos the report holds decides both. These two tests are the pair: the
    // form follows the photos until the user sets either by hand.
    // Four photos ten minutes apart, each somewhere new, so that which of them
    // a value came from is readable off the value itself.
    const fourPhotosApart = () =>
      [
        ['p1.jpg', 40.7, -74.0],
        ['p2.jpg', 40.71, -74.01],
        ['p3.jpg', 40.72, -74.02],
        ['p4.jpg', 40.73, -74.03],
      ].map(([name, latitude, longitude], index) => {
        const file = new File(['picture'], name, { type: 'image/jpeg' });
        return {
          file,
          name,
          createDateMs: Date.UTC(2024, 0, 1, 12, index * 10, 0),
          // The offset the camera recorded, so what the field shows is a
          // plain UTC time rather than one shifted by this machine's zone.
          createDateOffset: 0,
          latitude,
          longitude,
        };
      });

    // The address each photo's coordinates resolve to, so that following the
    // photos never asks the network.
    const cacheAddresses = (homeRef, photos) => {
      photos.forEach(photo => {
        homeRef.current.geosearchAddressCache.set({
          latitude: photo.latitude,
          longitude: photo.longitude,
          address: `where ${photo.name} was taken`,
        });
      });
    };

    test('moves the time and place onto the photos the report still holds', async () => {
      const photos = fourPhotosApart();
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: photos[0].latitude,
        longitude: photos[0].longitude,
        createDateMs: photos[0].createDateMs,
      };

      const {
        homeRef,
        clickQueueLoad,
        createDateInputValue,
        toggleAttachment,
        cleanup,
      } = await renderBatchWithFiles([]);

      renderer.act(() => {
        cacheAddresses(homeRef, photos);
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [violation],
        });
      });
      clickQueueLoad('T696817C');

      // Four photos, and a report carries three, so the newest is left out.
      // The time is the earliest attached photo's and the place is the latest
      // attached photo's, which is the third.
      expect(createDateInputValue()).toBe('2024-01-01T12:00');
      expect(homeRef.current.state.latitude).toBe(40.72);
      expect(homeRef.current.state.longitude).toBe(-74.02);

      // Dropping the newest moves the place back a photo, and leaves the time
      // where it was: the report is still of the same moment.
      toggleAttachment('p3.jpg', false);

      expect(createDateInputValue()).toBe('2024-01-01T12:00');
      expect(homeRef.current.state.latitude).toBe(40.71);
      expect(homeRef.current.state.longitude).toBe(-74.01);

      // Dropping the oldest is the other way round.
      toggleAttachment('p1.jpg', false);

      expect(createDateInputValue()).toBe('2024-01-01T12:10');
      expect(homeRef.current.state.latitude).toBe(40.71);

      cleanup();
    });

    test('leaves a time and place the user set by hand alone', async () => {
      const photos = fourPhotosApart();
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: photos[0].latitude,
        longitude: photos[0].longitude,
        createDateMs: photos[0].createDateMs,
      };

      const { homeRef, clickQueueLoad, toggleAttachment, cleanup } =
        await renderBatchWithFiles([]);

      renderer.act(() => {
        homeRef.current.geosearchAddressCache.set({
          latitude: 40.7,
          longitude: -74.0,
          address: 'where the first photo was taken',
        });
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [violation],
        });
      });
      clickQueueLoad('T696817C');

      // The user drags the pin and types a time: the two things the photos
      // would otherwise decide.
      renderer.act(() => {
        homeRef.current.setState({
          latitude: 40.9,
          longitude: -73.9,
          addressProvenance: '(manually set)',
          CreateDate: '2024-01-01T09:00',
        });
      });

      toggleAttachment('p1.jpg', false);

      // Dropping a photo does not take either back off them.
      expect(homeRef.current.state.latitude).toBe(40.9);
      expect(homeRef.current.state.longitude).toBe(-73.9);
      expect(homeRef.current.state.CreateDate).toBe('2024-01-01T09:00');

      cleanup();
    });

    test('moves the time and place when the X takes a photo out', async () => {
      const photos = fourPhotosApart();
      const violation = {
        photos,
        plate: 'T696817C',
        licenseState: 'NY',
        latitude: photos[0].latitude,
        longitude: photos[0].longitude,
        createDateMs: photos[0].createDateMs,
      };

      const {
        homeRef,
        clickQueueLoad,
        clickAttachmentDelete,
        createDateInputValue,
        cleanup,
      } = await renderBatchWithFiles([]);

      renderer.act(() => {
        cacheAddresses(homeRef, photos);
        homeRef.current.setState({
          batchPhotos: photos,
          batchViolations: [violation],
        });
      });
      clickQueueLoad('T696817C');

      expect(homeRef.current.state.latitude).toBe(40.72);
      expect(createDateInputValue()).toBe('2024-01-01T12:00');

      // The X is the only way out of a report of three or fewer, and it makes
      // the picker's promise: the report describes the photos that are left.
      // Dropping the newest moves the place back a photo...
      clickAttachmentDelete('p3.jpg');

      expect(homeRef.current.state.latitude).toBe(40.71);
      expect(createDateInputValue()).toBe('2024-01-01T12:00');

      // ...and dropping the oldest moves the time forward.
      clickAttachmentDelete('p1.jpg');

      expect(homeRef.current.state.latitude).toBe(40.71);
      expect(createDateInputValue()).toBe('2024-01-01T12:10');

      cleanup();
    });

    // The trash deletes a photo outright: it is not left behind to become a
    // violation of its own, and a submit afterwards has nothing of it to
    // publish.
    test.each([
      [['p1.jpg', 'p2.jpg'], 'p2.jpg'],
      [['p1.jpg', 'p2.jpg', 'p3.jpg'], 'p2.jpg'],
    ])(
      'does not bring a deleted photo back as a violation of its own (%s)',
      async (names, deleted) => {
        const photos = names.map((name, index) => {
          const file = new File(['picture'], name, { type: 'image/jpeg' });
          return {
            file,
            name,
            createDateMs: 1704110400000 + index * 1000,
            latitude: 40.7129,
            longitude: -74.0061,
          };
        });
        const violation = {
          photos,
          plate: 'T696817C',
          licenseState: 'NY',
          latitude: 40.7129,
          longitude: -74.0061,
          createDateMs: 1704110400000,
        };
        const kept = names.filter(name => name !== deleted);

        const {
          homeRef,
          clickQueueLoad,
          clickAttachmentDelete,
          submit,
          cleanup,
        } = await renderBatchWithFiles([]);

        renderer.act(() => {
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
        clickQueueLoad('T696817C');

        // Every one of them fits, so every one starts attached.
        expect(
          homeRef.current.state.attachmentData.map(file => file.name),
        ).toEqual(names);

        // The trash deletes one, from the report and from the violation.
        clickAttachmentDelete(deleted);
        expect(
          homeRef.current.state.attachmentData.map(file => file.name),
        ).toEqual(kept);
        expect(
          homeRef.current.state.batchPhotos.map(photo => photo.name),
        ).toEqual(kept);

        await submit();

        await renderer.act(async () => {
          for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
            await new Promise(resolve => setImmediate(resolve));
          }
        });

        const { batchPhotos, batchViolations } = homeRef.current.state;

        // The submitted photos have left the batch, and the deleted one is
        // nowhere: no photo, and no row made from it.
        expect(batchPhotos).toEqual([]);
        expect(batchViolations).toEqual([]);

        cleanup();
      },
    );

    // One wide shot of several cars is evidence for every car in it, so the
    // rows share the photo: it is in each of their reports, and what happens
    // to one row must not take it from the others.
    const sharedPhotoRows = async () => {
      const photo = (name, createDateMs) => ({
        file: new File(['picture'], name, { type: 'image/jpeg' }),
        name,
        createDateMs,
        latitude: 40.7129,
        longitude: -74.0061,
      });
      const wide = photo('wide.jpg', 1704110400000);
      const later = photo('later.jpg', 1704110600000);
      const row = (plate, photos, createDateMs) => ({
        photos,
        plate,
        licenseState: 'NY',
        latitude: 40.7129,
        longitude: -74.0061,
        createDateMs,
      });

      const rendered = await renderBatchWithFiles([]);
      const { homeRef } = rendered;

      renderer.act(() => {
        homeRef.current.geosearchAddressCache.set({
          latitude: 40.7129,
          longitude: -74.0061,
          address: '123 Main St, Manhattan',
        });
        homeRef.current.setState({
          batchPhotos: [wide, later],
          batchViolations: [
            row('AAA111', [wide], 1704110400000),
            row('BBB222', [wide], 1704110400000),
            row('FFF666', [later], 1704110600000),
          ],
        });
      });

      return { ...rendered, wide, later };
    };

    // A frame that reads as two cars is the only photo of each of them, so
    // each row holds it and neither has a photo of its own.
    const twoCarsInOneFrame = async () => {
      const frame = jpeg({ name: 'frame.jpg', size: 10 });
      const rendered = await renderBatchWithFiles([frame]);

      const plates = () =>
        rendered.homeRef.current.state.batchViolations.map(
          violation => violation.plate,
        );

      expect(plates()).toEqual(['AAA111', 'BBB222']);
      expect(
        rendered.homeRef.current.state.batchViolations[0].photos.map(
          photo => photo.name,
        ),
      ).toEqual([frame.name]);

      return { ...rendered, frame, plates };
    };

    test('keeps a deleted row deleted when the frame it was read from stays', async () => {
      const { homeRef, frame, plates, clickRowDelete, cleanup } =
        await twoCarsInOneFrame();

      clickRowDelete('AAA111');
      expect(plates()).toEqual(['BBB222']);

      // The frame stays for the row that is left, and the row that went must
      // not come back with it: the reading landing here regroups the batch,
      // the way the pass's own readings do.
      expect(
        homeRef.current.state.batchPhotos.map(photo => photo.name),
      ).toEqual([frame.name]);

      renderer.act(() => {
        const [photo] = homeRef.current.state.batchPhotos;
        homeRef.current.setState(
          homeRef.current.applyPlateRead({ photo, read: { ...photo } }),
        );
      });

      expect(plates()).toEqual(['BBB222']);

      // The second row takes the frame out of the batch with it, so the image
      // leaves rather than staying as a row the user cannot get rid of.
      clickRowDelete('BBB222');
      expect(plates()).toEqual([]);
      expect(homeRef.current.state.batchPhotos).toEqual([]);

      cleanup();
    });

    test('ticks the row whose box was clicked, not the row beside it', async () => {
      const { homeRef, clickButton, tickMerge, cleanup } =
        await twoCarsInOneFrame();

      // The form opened on the first row, so that one is ticked already.
      tickMerge('AAA111');
      tickMerge('BBB222');

      const { batchMergeSelection } = homeRef.current.state;
      expect(batchMergeSelection).toHaveLength(2);
      expect(batchMergeSelection[0]).toMatch(/AAA111-frame\.jpg$/);
      expect(batchMergeSelection[1]).toMatch(/BBB222-frame\.jpg$/);

      // Two ticks have to be two rows for the merge to have anything to
      // combine. Both rows hold the one frame, so a merge that took both ticks
      // for the same row would leave the queue as it was.
      clickButton('Merge');
      expect(homeRef.current.state.batchViolations).toHaveLength(1);

      cleanup();
    });

    test('leaves the other rows their shared photo when one row is deleted', async () => {
      const { homeRef, clickRowDelete, wide, cleanup } =
        await sharedPhotoRows();

      clickRowDelete('AAA111');

      const { batchViolations } = homeRef.current.state;
      expect(batchViolations.map(violation => violation.plate)).toEqual([
        'BBB222',
        'FFF666',
      ]);
      // The photo itself stays in the batch, and in the row that still needs
      // it: the row that went was one of the two that held it.
      expect(batchViolations[0].photos).toEqual([wide]);
      expect(
        homeRef.current.state.batchPhotos.map(photo => photo.name),
      ).toEqual(['wide.jpg', 'later.jpg']);

      cleanup();
    });

    // A submission consumes the attachments it sent, so the ids the page holds
    // for them are spent. The photo of one row can be the photo of another --
    // one frame, several cars -- and the next row's submit has to be able to
    // use it, which means uploading it again rather than sending an id for a
    // file the server has deleted.
    test('uploads a shared photo again once a report has used it', async () => {
      const {
        homeRef,
        clickQueueLoad,
        uploadAttachmentCalls,
        submit,
        cleanup,
      } = await sharedPhotoRows();

      clickQueueLoad('AAA111');
      const uploadsOfWide = () =>
        uploadAttachmentCalls().filter(
          ([, body]) => body.get('attachmentData').name === 'wide.jpg',
        ).length;

      // The upload reads the file before it goes out, so it lands a turn
      // after the row is opened.
      await renderer.act(async () => {
        for (let i = 0; i < 3; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      expect(uploadsOfWide()).toBe(1);

      await submit();
      await renderer.act(async () => {
        for (let i = 0; i < 3; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      // The queue loaded the row that is left, and that row holds the same
      // frame: it goes up again rather than being sent as the spent id.
      expect(
        homeRef.current.state.attachmentData.map(file => file.name),
      ).toEqual(['wide.jpg']);
      expect(uploadsOfWide()).toBe(2);

      cleanup();
    });

    test('submits one row that shares a photo without touching the others', async () => {
      const { homeRef, clickQueueLoad, submit, wide, cleanup } =
        await sharedPhotoRows();

      clickQueueLoad('AAA111');
      expect(homeRef.current.state.attachmentData).toEqual([wide.file]);

      await submit();

      await renderer.act(async () => {
        for (let i = 0; i < 3; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- one round per pending promise chain.
          await new Promise(resolve => setImmediate(resolve));
        }
      });

      const { batchViolations } = homeRef.current.state;

      // The row that was submitted is gone; the rows that shared its photo
      // are not, and neither gained a second copy of it.
      expect(batchViolations.map(violation => violation.plate)).toEqual([
        'BBB222',
        'FFF666',
      ]);
      expect(batchViolations[0].photos).toEqual([wide]);

      cleanup();
    });

    // A folder of photos arrives from a phone or a share sheet as a zip, so a
    // zip is a way of picking a batch rather than a file the batch could use:
    // it is opened out, and its photos are the batch.
    test('makes the batch from the photos inside a picked zip', async () => {
      const zip = new File(
        [
          zipSync({
            'photos/one.jpg': photoBytes('ab'),
            'photos/two.jpg': photoBytes('abc'),
            // `Buffer`, because this environment has neither TextEncoder nor
            // TextDecoder.
            'photos/notes.txt': Buffer.from('not a photo'),
          }),
        ],
        'photos.zip',
        { type: 'application/zip' },
      );

      exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
      exifr.parse.mockImplementation(async arrayBuffer => ({
        CreateDate: new Date(createDatesBySize[arrayBuffer.byteLength]),
        OffsetTimeDigitized: '-05:00',
      }));

      const { homeRef, toastSuccess, cleanup } = await renderBatchWithFiles([
        zip,
      ]);

      const { batchPhotos, batchViolations } = homeRef.current.state;

      // The photos, named as the zip had them, with the folder they shared
      // dropped; the text file is not an attachment and is not here.
      expect(batchPhotos.map(photo => photo.name)).toEqual([
        'one.jpg',
        'two.jpg',
      ]);

      // And they have been through the whole pass: read, grouped, and in the
      // queue as the cars they are.
      expect(batchViolations.map(violation => violation.plate)).toEqual([
        'LDA8765',
        'K73JAU',
      ]);

      expect(toastSuccess.mock.calls[0][0]).toBe('2 pictures from photos.zip');

      cleanup();
    });

    test('attaches a fourth picture, warns, and holds Submit until one is dropped', async () => {
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

      const {
        homeRef,
        toastWarn,
        toastError,
        submit,
        submitButton,
        clickQueueLoad,
        toggleAttachment,
        cleanup,
      } = await renderBatchWithFiles([]);

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
      clickQueueLoad('T696817C');

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
      expect(submitButton().props.disabled).toBe(false);

      // A fourth picture is attached, so that its thumbnail is there to look
      // at, and the warning says what it costs: Submit is off until the report
      // is back within its caps.
      toggleAttachment('p4.jpg', true);
      expect(attachmentNames()).toEqual([
        'p1.jpg',
        'p2.jpg',
        'p3.jpg',
        'p4.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);
      expect(toastWarn.mock.calls[0][0]).toBe(
        'A report can include at most 3 pictures. Uncheck one to swap it in.',
      );
      expect(submitButton().props.disabled).toBe(true);

      // Unticking a picture frees its slot, and Submit comes back.
      toggleAttachment('p1.jpg', false);
      expect(attachmentNames()).toEqual([
        'p2.jpg',
        'p3.jpg',
        'p4.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
      ]);
      expect(submitButton().props.disabled).toBe(false);

      // Videos have the same cap as pictures.
      toggleAttachment('v4.mp4', true);
      expect(attachmentNames()).toEqual([
        'p2.jpg',
        'p3.jpg',
        'p4.jpg',
        'v1.mp4',
        'v2.mp4',
        'v3.mp4',
        'v4.mp4',
      ]);
      expect(toastWarn.mock.calls[1][0]).toBe(
        'A report can include at most 3 videos. Uncheck one to swap it in.',
      );
      expect(submitButton().props.disabled).toBe(true);

      // Submitting anyway is refused with the same reason: the server keeps
      // only the first three of each kind, and silently dropping them is what
      // this replaces. The location is set here rather than waited for, so
      // that the refusal this test is about is the one that comes back.
      renderer.act(() => {
        homeRef.current.setState({ latitude: 40.7129, longitude: -74.0061 });
      });
      await submit();
      expect(toastError.mock.calls[0][0]).toBe(
        'A report can include at most 3 pictures and 3 videos. Remove the extra ones to submit it.',
      );

      cleanup();
    });
  });

  // A folder is how a camera roll arrives, and the form wants the pictures
  // and videos in it rather than everything the folder happens to hold.
  test('takes the pictures and videos inside a picked folder', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const folder = [
      new File([photoBytes('older')], 'album/older.jpg', {
        type: 'image/jpeg',
      }),
      new File([photoBytes('newer')], 'album/newer.jpg', {
        type: 'image/jpeg',
      }),
      new File([Buffer.from('x')], 'album/.DS_Store', { type: '' }),
      new File([Buffer.from('notes')], 'album/notes.txt', {
        type: 'text/plain',
      }),
    ];

    exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
    exifr.parse.mockImplementation(async () => ({
      CreateDate: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
      OffsetTimeDigitized: '+00:00',
    }));

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    await renderer.act(async () => {
      await homeRef.current.handleFolderInput({
        target: { files: folder, value: '' },
      });
    });
    // The extraction pass runs from a setState callback through jsdom's
    // FileReader, so it needs real time rather than a microtask.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

    // The pictures, as the folder named them; the text file and the macOS
    // entry are not attachments and are not here.
    expect(homeRef.current.state.attachmentData.map(file => file.name)).toEqual(
      ['album/older.jpg', 'album/newer.jpg'],
    );

    tree.unmount();
    exifr.gps.mockReset();
    exifr.parse.mockReset();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    consoleError.mockRestore();
  });

  // A folder of pictures arrives from a phone or a share sheet as a zip, so
  // the picker takes one and opens it out: what it holds are the attachments.
  test('opens a picked zip into the attachments it holds', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const toastSuccess = jest
      .spyOn(toast, 'success')
      .mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const zip = new File(
      [
        zipSync({
          'photos/older.jpg': photoBytes('older'),
          'photos/newer.jpg': photoBytes('newer'),
          // Not an attachment, with the metadata macOS writes into a zip.
          'photos/notes.txt': Buffer.from('not a photo'),
          '__MACOSX/._older.jpg': Buffer.from('resource fork'),
        }),
      ],
      'photos.zip',
      { type: 'application/zip' },
    );

    exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
    exifr.parse.mockImplementation(async () => ({
      CreateDate: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
      OffsetTimeDigitized: '+00:00',
    }));

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    await renderer.act(async () => {
      await homeRef.current.handleAttachmentInput(null, [[null, zip]]);
    });
    // The extraction pass runs from a setState callback through jsdom's
    // FileReader, so it needs real time rather than a microtask.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

    // The photos, named as the zip had them with the folder they shared
    // dropped; the text file and the macOS entry are not attachments.
    expect(homeRef.current.state.attachmentData.map(file => file.name)).toEqual(
      ['older.jpg', 'newer.jpg'],
    );
    expect(toastSuccess.mock.calls[0][0]).toBe('2 pictures from photos.zip');

    tree.unmount();
    exifr.gps.mockReset();
    exifr.parse.mockReset();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastSuccess.mockRestore();
    consoleError.mockRestore();
  });

  // A zip dragged onto the page is the same batch as one picked from the file
  // input, so it opens out the same way instead of joining the list as a
  // single attachment the grid cannot show.
  test('opens a dropped zip into the attachments it holds', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const toastSuccess = jest
      .spyOn(toast, 'success')
      .mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const zip = new File(
      [
        zipSync({
          'photos/older.jpg': photoBytes('older'),
          'photos/newer.jpg': photoBytes('newer'),
          'photos/notes.txt': Buffer.from('not a photo'),
          '__MACOSX/._older.jpg': Buffer.from('resource fork'),
        }),
      ],
      'photos.zip',
      { type: 'application/zip' },
    );

    exifr.gps.mockResolvedValue({ latitude: 40.7129, longitude: -74.0061 });
    exifr.parse.mockImplementation(async () => ({
      CreateDate: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
      OffsetTimeDigitized: '+00:00',
    }));

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });

    await renderer.act(async () => {
      await tree.root.findByType(Dropzone).props.onDrop([zip]);
    });
    // The extraction pass runs from a setState callback through jsdom's
    // FileReader, so it needs real time rather than a microtask.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

    // The photos took the zip's place; the archive itself is not an
    // attachment, and neither is the text file or the macOS entry.
    expect(homeRef.current.state.attachmentData.map(file => file.name)).toEqual(
      ['older.jpg', 'newer.jpg'],
    );
    expect(toastSuccess.mock.calls[0][0]).toBe('2 pictures from photos.zip');

    tree.unmount();
    exifr.gps.mockReset();
    exifr.parse.mockReset();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastSuccess.mockRestore();
    consoleError.mockRestore();
  });
  describe('session handling', () => {
    test('does not send stored credentials on mount', async () => {
      // A legacy cookie may still hold email+password; the client must not
      // re-authenticate with them. The server migrates them from the cookie
      // itself (see src/session.js).
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ data: {} });
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => null);
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: {
          email: 'test@example.com',
          password: 'test-password',
          loginSuccessful: false,
        },
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(
        axiosPost.mock.calls.filter(([url]) => url === '/api/logIn'),
      ).toHaveLength(0);
      // The legacy password never reaches React state.
      expect(homeRef.current.state.password).toBe('');

      tree.unmount();
      axiosPost.mockRestore();
      consoleError.mockRestore();
    });

    test('restores withhold_contact_info_from_nypd from the login response when present', async () => {
      const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
        if (url === '/api/logIn') {
          return Promise.resolve({
            data: {
              email: 'test@example.com',
              FirstName: 'Test',
              LastName: 'User',
              Phone: '5551234567',
              testify: true,
              can_be_shared_publicly: true,
              withhold_contact_info_from_nypd: true,
              receive_nypd_sr_updates_by_email: true,
            },
          });
        }
        return Promise.resolve({ data: { submissions: [] } });
      });
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: {
          email: 'test@example.com',
          password: 'test-password',
          loginSuccessful: true,
          // The cookie disagrees with the DB, which must win.
          can_be_shared_publicly: false,
          withhold_contact_info_from_nypd: false,
          receive_nypd_sr_updates_by_email: false,
        },
      });

      await renderer.act(async () => {
        await homeRef.current.handleLogIn();
      });

      expect(homeRef.current.state.can_be_shared_publicly).toBe(true);
      expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(true);
      expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(true);

      tree.unmount();
      axiosPost.mockRestore();
    });

    test('falls back to the cookie for withhold when the login response omits it', async () => {
      const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
        if (url === '/api/logIn') {
          return Promise.resolve({
            data: {
              email: 'test@example.com',
              FirstName: 'Test',
              LastName: 'User',
              Phone: '5551234567',
              testify: false,
            },
          });
        }
        return Promise.resolve({ data: { submissions: [] } });
      });
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: {
          email: 'test@example.com',
          password: 'test-password',
          loginSuccessful: true,
          can_be_shared_publicly: false,
          withhold_contact_info_from_nypd: true,
          receive_nypd_sr_updates_by_email: true,
        },
      });

      await renderer.act(async () => {
        await homeRef.current.handleLogIn();
      });

      expect(homeRef.current.state.can_be_shared_publicly).toBe(false);
      expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(true);
      expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(true);

      tree.unmount();
      axiosPost.mockRestore();
    });

    test('logging out revokes the session server-side', async () => {
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ data: {} });
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: {
          email: 'test@example.com',
          loginSuccessful: true,
          withhold_contact_info_from_nypd: true,
          receive_nypd_sr_updates_by_email: true,
        },
      });
      renderer.act(() => {
        homeRef.current.handleLogOut();
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(axiosPost).toHaveBeenCalledWith('/api/logOut');
      expect(homeRef.current.state.loginSuccessful).toBe(false);
      expect(homeRef.current.state.email).toBe('');
      // Reset with the rest of the profile fields, like testify.
      expect(homeRef.current.state.withhold_contact_info_from_nypd).toBe(false);
      expect(homeRef.current.state.receive_nypd_sr_updates_by_email).toBe(
        false,
      );

      tree.unmount();
      axiosPost.mockRestore();
    });

    test('includes withhold_contact_info_from_nypd when saving the profile', async () => {
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ data: {} });
      const originalQuerySelector = document.querySelector;
      document.querySelector = jest.fn(() => ({ scrollTo() {} }));
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: { email: 'test@example.com', loginSuccessful: true },
      });
      renderer.act(() => {
        homeRef.current.setState({
          can_be_shared_publicly: true,
          withhold_contact_info_from_nypd: true,
          receive_nypd_sr_updates_by_email: true,
        });
      });

      await renderer.act(async () => {
        await homeRef.current.handleSaveProfile({ preventDefault() {} });
      });

      expect(axiosPost).toHaveBeenCalledWith(
        '/saveUser',
        expect.objectContaining({
          testify: false,
          can_be_shared_publicly: true,
          withhold_contact_info_from_nypd: true,
          receive_nypd_sr_updates_by_email: true,
        }),
      );

      tree.unmount();
      axiosPost.mockRestore();
      document.querySelector = originalQuerySelector;
    });

    test('an expired session clears the login state and reopens the auth modal', async () => {
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: { email: 'test@example.com', loginSuccessful: true },
      });
      renderer.act(() => {
        homeRef.current.handleSessionExpired();
      });

      expect(homeRef.current.state.loginSuccessful).toBe(false);
      expect(homeRef.current.state.isAuthModalOpen).toBe(true);
      expect(homeRef.current.state.authError).toMatch(/session expired/i);

      tree.unmount();
    });

    test('an expired-session notice is not shown to logged-out visitors', async () => {
      const homeRef = React.createRef();

      const tree = renderHome({
        homeRef,
        initialState: { loginSuccessful: false },
      });
      renderer.act(() => {
        homeRef.current.handleSessionExpired();
      });

      expect(homeRef.current.state.isAuthModalOpen).toBe(false);
      expect(homeRef.current.state.loginSuccessful).toBe(false);

      tree.unmount();
    });
  });

  describe('the legacy localStorage migration', () => {
    const clearLegacyState = () => {
      localStorage.removeItem('Function');
      localStorage.removeItem('reportedWebHomeState');
      document.cookie = `${HOME_STATE_COOKIE}=; max-age=0; path=/`;
    };

    afterEach(clearLegacyState);

    test('reports the migration so it can be counted', () => {
      clearLegacyState();
      localStorage.setItem(
        'reportedWebHomeState',
        JSON.stringify({ plate: 'ABC1234' }),
      );
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ data: {} });

      const tree = renderHome();

      expect(axiosPost).toHaveBeenCalledWith('/api/legacyStateMigrated');
      // The migration still does its real job: the state is in the cookie now.
      expect(document.cookie).toContain(`${HOME_STATE_COOKIE}=`);

      axiosPost.mockRestore();
      tree.unmount();
    });

    test('does not report when there is no legacy state to migrate', () => {
      clearLegacyState();
      const axiosPost = jest
        .spyOn(axios, 'post')
        .mockResolvedValue({ data: {} });

      const tree = renderHome();

      expect(axiosPost).not.toHaveBeenCalledWith('/api/legacyStateMigrated');

      axiosPost.mockRestore();
      tree.unmount();
    });
  });
});

// A report's location has to be in NYC, so the map's search box must not offer
// places outside it. Google's SearchBox widget cannot filter its predictions
// -- its `bounds` only bias them -- so the box mounts the Autocomplete widget
// with `strictBounds`, which reads those bounds as a filter. What this suite
// can hold onto is the contract the component keeps with Google: the widget,
// the bounds and the option. Whether Google honors `strictBounds` is Google's
// to keep, and no test here should depend on the live API for an answer.
describe('NycAddressAutocomplete', () => {
  const NYC_BOUNDS = {
    east: -73.700272,
    north: 40.915256,
    south: 40.496044,
    west: -74.255735,
  };

  class FakeAutocomplete {
    constructor(input, options) {
      this.input = input;
      this.options = options;
      this.addListener = jest.fn();
      FakeAutocomplete.instances.push(this);
    }
  }
  FakeAutocomplete.instances = [];

  // react-google-maps hands the map down through legacy context, so the test
  // provides one the same way: an object whose `controls` the component can
  // mount its input into.
  class MapContext extends React.Component {
    static childContextTypes = { [MAP]: PropTypes.object };

    getChildContext() {
      return {
        [MAP]: {
          controls: {
            [window.google.maps.ControlPosition.TOP_LEFT]: this.props.controls,
          },
        },
      };
    }

    render() {
      return this.props.children;
    }
  }
  MapContext.propTypes = {
    children: PropTypes.node.isRequired,
    controls: PropTypes.object.isRequired,
  };

  let controlContainer;
  let controls;
  let pageContainer;
  let originalGoogle;

  beforeEach(() => {
    FakeAutocomplete.instances = [];

    // Stands in for the map's `controls[TOP_LEFT]` MVCArray: pushing a node
    // puts it in the control container, and removing it takes the node out of
    // the DOM again, as Google's own array of control nodes does.
    controlContainer = document.createElement('div');
    document.body.appendChild(controlContainer);
    controls = {
      nodes: [],
      push(node) {
        controlContainer.appendChild(node);
        this.nodes.push(node);
        return this.nodes.length;
      },
      getArray() {
        return [...this.nodes];
      },
      removeAt(index) {
        const [node] = this.nodes.splice(index, 1);
        controlContainer.removeChild(node);
        return node;
      },
    };

    originalGoogle = window.google;
    window.google = {
      maps: {
        ControlPosition: { TOP_LEFT: 7 },
        places: { Autocomplete: FakeAutocomplete },
      },
    };

    pageContainer = document.createElement('div');
    document.body.appendChild(pageContainer);
  });

  afterEach(() => {
    window.google = originalGoogle;
    controlContainer.remove();
    pageContainer.remove();
  });

  const mountSearchBox = (props = {}) => {
    act(() => {
      ReactDOM.render(
        <MapContext controls={controls}>
          <NycAddressAutocomplete
            onAutocompleteMounted={props.onAutocompleteMounted || jest.fn()}
            onSearchInputMounted={props.onSearchInputMounted || jest.fn()}
            onPlacesChanged={props.onPlacesChanged || jest.fn()}
          />
        </MapContext>,
        pageContainer,
      );
    });

    return FakeAutocomplete.instances[0];
  };

  test('asks Google for NYC predictions only', () => {
    mountSearchBox();

    expect(FakeAutocomplete.instances[0].options).toEqual({
      bounds: NYC_BOUNDS,
      componentRestrictions: { country: 'us' },
      strictBounds: true,
    });
  });

  test('mounts the search input as the map control', () => {
    mountSearchBox();

    const input = controls.getArray()[0];

    expect(input.tagName).toBe('INPUT');
    expect(controlContainer.contains(input)).toBe(true);
  });

  test('hands the widget over and listens for a chosen place', () => {
    const onAutocompleteMounted = jest.fn();
    const onPlacesChanged = jest.fn();

    const autocomplete = mountSearchBox({
      onAutocompleteMounted,
      onPlacesChanged,
    });

    expect(onAutocompleteMounted).toHaveBeenCalledWith(autocomplete);
    expect(autocomplete.addListener).toHaveBeenCalledWith(
      'place_changed',
      onPlacesChanged,
    );
  });

  test('gives the map control back when the modal closes', () => {
    mountSearchBox();
    const input = controls.getArray()[0];

    act(() => {
      ReactDOM.unmountComponentAtNode(pageContainer);
    });

    expect(controls.getArray()).toEqual([]);
    expect(controlContainer.contains(input)).toBe(false);
  });
});

describe('license state', () => {
  // The form only renders for a logged-in reader with a photo attached.
  function renderForm(initialState = {}) {
    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    const homeRef = React.createRef();
    let tree;
    renderer.act(() => {
      tree = renderHome({
        initialState: {
          email: 'test@example.com',
          loginSuccessful: true,
          ...initialState,
        },
        homeRef,
      });
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
      tree,
      stateInput: tree.root.findByProps({ name: 'licenseState' }),
      plateInput: tree.root.findByProps({ name: 'plate' }),
      cleanup: () => {
        renderer.act(() => tree.unmount());
        global.URL.createObjectURL = originalCreateObjectURL;
      },
    };
  }

  // Regression test: a plate read whose region code would not parse reported
  // the state as '', and the state field showed that as an empty value --
  // "Could not look up make/model of T683780C in , click here for details".
  // A read with nothing to say about the state reports null instead, which
  // leaves whichever state the reader already had.
  test('keeps the current state when a plate read has none to report', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const { homeRef, cleanup } = renderForm();
    const { current: home } = homeRef;
    expect(home.state.licenseState).toBe('NY');

    renderer.act(() => {
      home.setLicensePlate({ plate: 'T683780C', licenseState: null });
    });
    expect(home.state.licenseState).toBe('NY');

    // Clearing the field still clears it: accepting a state the list does not
    // offer is what the field is for.
    renderer.act(() => {
      home.setLicensePlate({ plate: 'T683780C', licenseState: '' });
    });
    expect(home.state.licenseState).toBe('');

    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });
    cleanup();
    axiosGet.mockRestore();
  });

  // A plate read carries whichever region code the reader saw, and the state
  // dataset has no name for some of them -- a Canadian province, a federal
  // fleet code. The lookup messages looked the name up unguarded, so a plate
  // like that lost the state from the sentence:
  //
  //   Looking up make/model for ABC123 in undefined
  //   Could not look up make/model of ABC123 in , click here for details
  //
  // The first is a template literal, which prints the word; the second is a
  // JSX child, which renders nothing at all.
  test('names a state the dataset has no name for by its code', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const { homeRef, tree, cleanup } = renderForm();

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: 'ON' });
    });

    const rendered = renderedText(tree.toJSON());
    expect(rendered).toContain('Looking up make/model for ABC123 in ON');
    expect(rendered).toContain('Looking up violations for ABC123 in ON');

    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });
    cleanup();
    axiosGet.mockRestore();
  });

  // The same message once the lookup has failed, which is where the missing
  // name reads as "in ," right before the comma.
  test('names a state the dataset has no name for when a lookup fails', async () => {
    const axiosGet = jest
      .spyOn(axios, 'get')
      .mockRejectedValue(new Error('lookup failed'));
    const { homeRef, tree, cleanup } = renderForm();

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: 'ON' });
    });

    // The vehicle lookup is debounced by 1000ms, so the failed lookup that
    // swaps in the error message needs longer than the usual settle.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    const rendered = renderedText(tree.toJSON());
    expect(rendered).toContain('Could not look up make/model of ABC123 in ON,');

    cleanup();
    axiosGet.mockRestore();
  });

  // The list is US-centric, so a plate can arrive with a state it does not
  // have, or with none at all; neither is a reason to refuse the submission.
  test('leaves the state field optional', () => {
    const { stateInput, cleanup } = renderForm();

    expect(stateInput.props.required).toBeUndefined();

    cleanup();
  });

  // LookupAPlate matches a plate together with its state, so a plate with no
  // state is nothing it can answer. The reader is asked for the state rather
  // than being sent on a request that could not come back with anything.
  test('asks for the state rather than looking a plate up without one', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const { homeRef, tree, cleanup } = renderForm();

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: '' });
    });

    // Past the 1000ms debounce, so a lookup would have gone out by now.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    const rendered = renderedText(tree.toJSON());
    expect(rendered).toContain(
      'Enter the state to look up make/model for ABC123',
    );
    expect(rendered).toContain(
      'Enter the state to look up violations for ABC123',
    );

    // Neither lookup was asked for. Other requests may legitimately be in
    // flight, so this looks for the two that would have carried the plate.
    const lookupCalls = axiosGet.mock.calls.filter(([url]) =>
      /getVehicleType|howsmydrivingny/.test(String(url)),
    );
    expect(lookupCalls).toEqual([]);

    cleanup();
    axiosGet.mockRestore();
  });

  // The other half of that guard: a plate that does have a state is still
  // looked up.
  test('looks a plate up once it has a state', async () => {
    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const { homeRef, cleanup } = renderForm();

    renderer.act(() => {
      homeRef.current.setLicensePlate({ plate: 'ABC123', licenseState: 'NY' });
    });

    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
    });

    const lookupCalls = axiosGet.mock.calls.filter(([url]) =>
      String(url).includes('/getVehicleType/'),
    );
    expect(lookupCalls).toHaveLength(1);
    expect(String(lookupCalls[0][0])).toContain('/getVehicleType/ABC123/NY');

    cleanup();
    axiosGet.mockRestore();
  });

  // Regression test: the state is not part of what counts as a duplicate, so
  // changing it says nothing about one. Every keystroke in this field used to
  // run the check and warn, one toast per character typed.
  test('says nothing about a prior submission for a state change alone', async () => {
    const warn = jest.spyOn(toast, 'warn').mockImplementation(() => {});
    // The prior submission has to fall on the day the form is reporting for,
    // so both dates are pinned rather than left to the mocked clock.
    const day = '2016-11-17T20:00:00';
    const { stateInput, cleanup } = renderForm({
      plate: 'ABC123',
      CreateDate: day,
      submissions: [{ license: 'ABC123', timeofreport: day }],
    });

    // Typing "CAL" a character at a time, as the field reports it.
    for (const value of ['C', 'CA', 'CAL']) {
      const input = createFakeInput({ value, caret: value.length });
      renderer.act(() => {
        stateInput.props.onChange({ target: input });
      });
    }

    // Past the debounce, so anything scheduled would have fired by now.
    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    expect(warn).not.toHaveBeenCalled();

    cleanup();
    warn.mockRestore();
  });

  // The other half: a plate that has just become one with an earlier
  // submission does warn, once the typing stops rather than mid-word.
  test('warns once when the plate becomes one already submitted', async () => {
    const warn = jest.spyOn(toast, 'warn').mockImplementation(() => {});
    const day = '2016-11-17T20:00:00';
    const { plateInput, cleanup } = renderForm({
      plate: '',
      CreateDate: day,
      submissions: [{ license: 'ABC123', timeofreport: day }],
    });

    // Typing "ABC123" a character at a time, as the field reports it.
    for (const value of ['A', 'AB', 'ABC', 'ABC1', 'ABC12', 'ABC123']) {
      const input = createFakeInput({ value, caret: value.length });
      renderer.act(() => {
        plateInput.props.onChange({ target: input });
      });
    }

    // Nothing while the reader is still typing.
    expect(warn).not.toHaveBeenCalled();

    await renderer.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    });

    expect(warn).toHaveBeenCalledTimes(1);

    cleanup();
    warn.mockRestore();
  });

  // The state is held and sent as the abbreviation, so it takes whatever case
  // it is typed in, the way the plate field does.
  test('uppercases the state as it is typed', () => {
    const { homeRef, stateInput, cleanup } = renderForm();

    // The user replaced the whole field with "ca".
    const input = createFakeInput({ value: 'ca', caret: 2 });
    renderer.act(() => {
      stateInput.props.onChange({ target: input });
    });
    reRenderControlledInput(input, homeRef.current.state.licenseState);

    expect(homeRef.current.state.licenseState).toBe('CA');
    expect(input.value).toBe('CA');

    cleanup();
  });

  // Uppercasing inside an onChange handler is what sends the caret to the end
  // of a controlled field, which is why this goes through the same helper the
  // plate field uses.
  test('keeps the caret in place when typing a letter into the middle of the state', () => {
    const { homeRef, stateInput, cleanup } = renderForm();

    // The user typed "a" between the "N" and the "Y" of "NY".
    const input = createFakeInput({ value: 'NaY', caret: 2 });
    renderer.act(() => {
      stateInput.props.onChange({ target: input });
    });
    reRenderControlledInput(input, homeRef.current.state.licenseState);

    expect(homeRef.current.state.licenseState).toBe('NAY');
    expect(input.value).toBe('NAY');
    // ...and the caret stays after the "A", rather than jumping to the end.
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);

    cleanup();
  });
});

// A phone's GPS can be late: the first photos can carry the fix from
// wherever the phone was last used. The user sets the place once by hand,
// and the box by the "Where" field keeps it on every report until they
// uncheck it.
describe('a locked address', () => {
  const chosenPlace = {
    latitude: 40.9,
    longitude: -73.9,
    formatted_address: '1 Main St, Manhattan',
    addressProvenance: '(manually set)',
  };

  const expectChosenPlace = homeRef => {
    expect(homeRef.current.state.latitude).toBe(chosenPlace.latitude);
    expect(homeRef.current.state.longitude).toBe(chosenPlace.longitude);
    expect(homeRef.current.state.formatted_address).toBe(
      chosenPlace.formatted_address,
    );
  };

  test('keeps the place the user picked when a photo reports another one', () => {
    const homeRef = React.createRef();
    const tree = renderHome({ homeRef });

    renderer.act(() => {
      homeRef.current.setState({ ...chosenPlace, isLocationLocked: true });
    });

    renderer.act(() => {
      homeRef.current.applyPhotoPlace([
        { latitude: 40.73, longitude: -74.01, createDateMs: 3000 },
      ]);
    });

    expectChosenPlace(homeRef);

    tree.unmount();
  });

  test('lets the map move a locked place, and keeps it locked', () => {
    const homeRef = React.createRef();
    const tree = renderHome({ homeRef });

    renderer.act(() => {
      homeRef.current.setState({ ...chosenPlace, isLocationLocked: true });
    });

    // The map reports a new centre. A locked place would ignore this from the
    // photos or the GPS; from the map it is the user's own move.
    renderer.act(() => {
      homeRef.current.setCoords(
        {
          latitude: 40.75,
          longitude: -73.95,
          addressProvenance: '(manually set)',
        },
        { fromMap: true },
      );
    });

    expect(homeRef.current.state.latitude).toBe(40.75);
    expect(homeRef.current.state.longitude).toBe(-73.95);
    expect(homeRef.current.state.isLocationLocked).toBe(true);

    // The lock still holds against the photos.
    renderer.act(() => {
      homeRef.current.applyPhotoPlace([
        { latitude: 40.73, longitude: -74.01, createDateMs: 3000 },
      ]);
    });

    expect(homeRef.current.state.latitude).toBe(40.75);
    expect(homeRef.current.state.longitude).toBe(-73.95);

    tree.unmount();
  });

  test('keeps the place the user picked when a late GPS fix arrives', async () => {
    const homeRef = React.createRef();
    const tree = renderHome({ homeRef });

    renderer.act(() => {
      homeRef.current.setState({ ...chosenPlace, isLocationLocked: true });
    });

    // The geolocation stub answers with the default coordinates, which an
    // unlocked form would take.
    await renderer.act(async () => {
      await homeRef.current.geolocateAndSetCoords();
    });

    expectChosenPlace(homeRef);

    tree.unmount();
  });

  test('stays where the user put it across a submission', async () => {
    jest.useFakeTimers();

    const initialState = {
      email: 'test@example.com',
      loginSuccessful: true,
    };

    const originalCreateObjectURL = global.URL.createObjectURL;
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');

    const originalQuerySelector = document.querySelector;
    document.querySelector = jest.fn(() => ({ scrollTo: jest.fn() }));

    const axiosGet = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
      if (url === '/api/geosearch') {
        return Promise.resolve({ data: { features: [] } });
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
    const toastWarn = jest.spyOn(toast, 'warn').mockImplementation(() => null);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ initialState, homeRef });
    });

    // Let the mount-time geolocation resolve before the user picks a place.
    await renderer.act(async () => {});

    renderer.act(() => {
      homeRef.current.setState({
        ...chosenPlace,
        isLocationLocked: true,
        plate: 'ABC123',
        reportDescription: 'Cars are double parked',
        attachmentData: [
          new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
        ],
        isAlprEnabled: false,
        isReverseGeocodingEnabled: false,
      });
    });

    const form = tree.root
      .findAllByType('form')
      .find(formEl => typeof formEl.props.onSubmit === 'function');
    await renderer.act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    expect(axiosPost.mock.calls.some(([url]) => url === '/submit')).toBe(true);
    // The reset that follows a submission puts the form back on the default
    // coordinates. The lock keeps the address, ready for the next report.
    expectChosenPlace(homeRef);

    jest.useRealTimers();
    global.URL.createObjectURL = originalCreateObjectURL;
    document.querySelector = originalQuerySelector;
    axiosGet.mockRestore();
    axiosPost.mockRestore();
    toastSuccess.mockRestore();
    toastWarn.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test('moves again once its box is unchecked', async () => {
    jest.useFakeTimers();

    const axiosPost = jest.spyOn(axios, 'post').mockImplementation(url => {
      if (url === '/api/geosearch') {
        return Promise.resolve({
          data: { features: [{ properties: { borough: 'Manhattan' } }] },
        });
      }
      return Promise.resolve({ data: {} });
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    let tree;
    const homeRef = React.createRef();
    renderer.act(() => {
      tree = renderHome({ homeRef });
    });
    renderer.act(() => {
      homeRef.current.setState({ ...chosenPlace, isLocationLocked: true });
    });

    // Locked, the map's center is ignored.
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.8,
        longitude: -73.8,
        addressProvenance: '(manually set)',
      });
    });
    expectChosenPlace(homeRef);

    // The user unchecks the box to move the address again.
    renderer.act(() => {
      homeRef.current.setState({ isLocationLocked: false });
    });
    renderer.act(() => {
      homeRef.current.setCoords({
        latitude: 40.8,
        longitude: -73.8,
        addressProvenance: '(manually set)',
      });
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(homeRef.current.state.latitude).toBe(40.8);
    expect(homeRef.current.state.longitude).toBe(-73.8);
    expect(homeRef.current.state.formatted_address).toBe('Manhattan');

    jest.useRealTimers();
    axiosPost.mockRestore();
    consoleError.mockRestore();
    tree.unmount();
  });

  test('is restored with the address it was saved with', async () => {
    const homeRef = React.createRef();
    const tree = renderHome({
      initialState: {
        email: 'test@example.com',
        loginSuccessful: true,
        isLocationLocked: true,
        ...chosenPlace,
      },
      homeRef,
    });

    // The mount work would otherwise put the form back on the default
    // coordinates and ask for a fix.
    await renderer.act(async () => {});

    expectChosenPlace(homeRef);

    tree.unmount();
  });

  test('has a box by the Where field that shuts the map while it is on', () => {
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
        isAlprEnabled: false,
        isReverseGeocodingEnabled: false,
      });
    });

    const whereButton = () => tree.root.findByProps({ name: 'where' });
    const lockBox = () => tree.root.findByProps({ name: 'isLocationLocked' });

    expect(lockBox().props.checked).toBe(false);
    expect(whereButton().props.disabled).toBeUndefined();

    renderer.act(() => {
      lockBox().props.onChange({
        target: { name: 'isLocationLocked', type: 'checkbox', checked: true },
      });
    });

    expect(homeRef.current.state.isLocationLocked).toBe(true);
    expect(lockBox().props.checked).toBe(true);
    // The map stays open while the address is locked: a place picked there is
    // the user's own hand, and the lock holds the new place.
    expect(whereButton().props.disabled).toBeUndefined();

    renderer.act(() => {
      lockBox().props.onChange({
        target: { name: 'isLocationLocked', type: 'checkbox', checked: false },
      });
    });

    expect(homeRef.current.state.isLocationLocked).toBe(false);
    expect(whereButton().props.disabled).toBeUndefined();

    global.URL.createObjectURL = originalCreateObjectURL;
    tree.unmount();
  });
});
