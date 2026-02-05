/**
 * User registration/login form component
 * Extracted from Home.js for better maintainability
 */

import React from 'react';
import PropTypes from 'prop-types';

/**
 * User information form with login/signup functionality
 */
export default function UserInfoForm({
  isOpen,
  onToggle,
  isSaving,
  values,
  onChange,
  onSubmit,
  onLogin,
  onPasswordReset,
  isPasswordRevealed,
  onTogglePasswordReveal,
  userFormSubmitRef,
}) {
  const { email, password, FirstName, LastName, Phone, testify } = values;

  return (
    <details
      open={isOpen}
      onToggle={evt => {
        onToggle(evt.target.open);
      }}
    >
      <summary>Create/Edit User (click to expand)</summary>

      <form onSubmit={onSubmit}>
        <fieldset disabled={isSaving}>
          <label htmlFor="email">
            Email:{' '}
            <input
              required
              onInvalid={() => onToggle(true)}
              type="email"
              autoComplete="email"
              value={email}
              name="email"
              onChange={event => {
                onChange({
                  target: {
                    name: event.target.name,
                    value: event.target.value.replace(/@.*/, atDomain =>
                      atDomain.toLowerCase(),
                    ),
                  },
                });
              }}
            />
          </label>
          <label htmlFor="password">
            {
              "Password (this is saved on your device, so use a password you don't use anywhere else): "
            }
            <div style={{ display: 'flex' }}>
              <input
                required
                onInvalid={() => onToggle(true)}
                type={isPasswordRevealed ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                name="password"
                onChange={onChange}
              />
              &nbsp;
              <button type="button" onClick={onTogglePasswordReveal}>
                {isPasswordRevealed ? 'Hide' : 'Show'}
              </button>
              &nbsp;
              <button type="button" onClick={onPasswordReset}>
                Reset
              </button>
            </div>
          </label>
          <button type="button" disabled={isSaving} onClick={onLogin}>
            Sign Up / Log In
          </button>
          <br />
          <br />
          (If you cannot log in even after resetting your password, email{' '}
          <a href="mailto:reportedapp@gmail.com">reportedapp@gmail.com</a>)
          <label htmlFor="FirstName">
            First Name:{' '}
            <input
              required
              onInvalid={() => onToggle(true)}
              type="text"
              autoComplete="given-name"
              value={FirstName}
              name="FirstName"
              onChange={onChange}
            />
          </label>
          <label htmlFor="LastName">
            Last Name:{' '}
            <input
              required
              onInvalid={() => onToggle(true)}
              type="text"
              autoComplete="family-name"
              value={LastName}
              name="LastName"
              onChange={onChange}
            />
          </label>
          <label htmlFor="Phone">
            Phone Number:{' '}
            <input
              required
              onInvalid={() => onToggle(true)}
              type="tel"
              autoComplete="tel"
              value={Phone}
              name="Phone"
              onChange={onChange}
            />
          </label>
          <label htmlFor="testify">
            <input
              type="checkbox"
              checked={testify}
              name="testify"
              onChange={onChange}
            />{' '}
            I&apos;m willing to testify at a hearing, which can be done by
            phone.
          </label>
          <button type="submit" disabled={isSaving} ref={userFormSubmitRef}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </fieldset>
      </form>
    </details>
  );
}

UserInfoForm.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  isSaving: PropTypes.bool.isRequired,
  values: PropTypes.shape({
    email: PropTypes.string.isRequired,
    password: PropTypes.string.isRequired,
    FirstName: PropTypes.string.isRequired,
    LastName: PropTypes.string.isRequired,
    Phone: PropTypes.string.isRequired,
    testify: PropTypes.bool.isRequired,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onLogin: PropTypes.func.isRequired,
  onPasswordReset: PropTypes.func.isRequired,
  isPasswordRevealed: PropTypes.bool.isRequired,
  onTogglePasswordReveal: PropTypes.func.isRequired,
  userFormSubmitRef: PropTypes.object.isRequired,
};
