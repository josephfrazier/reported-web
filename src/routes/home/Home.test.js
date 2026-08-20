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
});
