/**
 * License plate input component with suggestions and state dropdown
 * Extracted from Home.js for better maintainability
 */

import React from 'react';
import PropTypes from 'prop-types';
import usStateNames from 'datasets-us-states-abbr-names';
import CircularProgress from '@mui/material/CircularProgress';

// Add DC to state names
usStateNames.DC = 'District of Columbia';

/**
 * License plate input with ALPR suggestions and state selector
 */
export default function LicensePlateInput({
  plate,
  licenseState,
  plateSuggestions,
  isAlprLoading,
  vehicleInfoComponent,
  plateRef,
  onPlateChange,
  onStateChange,
}) {
  return (
    <label htmlFor="plate">
      License/Medallion:
      {isAlprLoading && <CircularProgress size="1em" />}
      <input
        required
        type="search"
        value={plate}
        name="plate"
        list="plateSuggestions"
        autoComplete="off"
        ref={plateRef}
        placeholder={plateSuggestions[0]}
        onChange={event => {
          onPlateChange(event.target.value.toUpperCase());
        }}
      />
      <datalist id="plateSuggestions">
        {plateSuggestions.map(plateSuggestion => (
          <option key={plateSuggestion} value={plateSuggestion} />
        ))}
      </datalist>
      <select
        style={{
          marginTop: '0.5rem',
        }}
        value={licenseState}
        name="licenseState"
        onChange={event => {
          onStateChange(event.target.value);
        }}
      >
        {Object.entries(usStateNames)
          .sort(([, name1], [, name2]) =>
            name1.toUpperCase().localeCompare(name2.toUpperCase()),
          )
          .map(([abbr, name]) => (
            <option key={abbr} value={abbr}>
              {name}
            </option>
          ))}
      </select>
      {vehicleInfoComponent}
    </label>
  );
}

LicensePlateInput.propTypes = {
  plate: PropTypes.string.isRequired,
  licenseState: PropTypes.string.isRequired,
  plateSuggestions: PropTypes.arrayOf(PropTypes.string).isRequired,
  isAlprLoading: PropTypes.bool.isRequired,
  vehicleInfoComponent: PropTypes.node.isRequired,
  plateRef: PropTypes.object.isRequired,
  onPlateChange: PropTypes.func.isRequired,
  onStateChange: PropTypes.func.isRequired,
};
