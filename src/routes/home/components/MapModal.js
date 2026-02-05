/**
 * Map modal component for location selection
 * Extracted from Home.js for better maintainability
 */

import React from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-modal';

import MapComponent from './MapComponent';
import { geolocate } from '../utils';

/**
 * Modal containing Google Map for location selection
 */
export default function MapModal({
  isOpen,
  onClose,
  position,
  onCenterChanged,
  onSearchBoxMounted,
  onPlacesChanged,
  onRef,
  homeStyles,
  notifyError,
  setCoords,
}) {
  const handleUseCurrentLocation = () => {
    geolocate()
      .then(({ coords: { latitude, longitude }, ipProvenance = 'device' }) => {
        setCoords({
          latitude,
          longitude,
          addressProvenance: `(from ${ipProvenance}: ${latitude}, ${longitude})`,
        });
      })
      .catch(err => {
        notifyError(err.message);
        console.error(err);
      });
  };

  return (
    <Modal
      parentSelector={() =>
        document.querySelector(`.${homeStyles.root}`) || document.body
      }
      isOpen={isOpen}
      onRequestClose={onClose}
      style={{
        content: {
          padding: 0,
        },
      }}
    >
      <MapComponent
        key="map"
        position={position}
        onRef={onRef}
        onCenterChanged={onCenterChanged}
        onSearchBoxMounted={onSearchBoxMounted}
        onPlacesChanged={onPlacesChanged}
      />

      <button
        type="button"
        style={{
          float: 'left',
        }}
        onClick={handleUseCurrentLocation}
      >
        Use current location
      </button>

      <button
        type="button"
        onClick={onClose}
        style={{
          float: 'right',
        }}
      >
        Close
      </button>
    </Modal>
  );
}

MapModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  position: PropTypes.shape({
    lat: PropTypes.number.isRequired,
    lng: PropTypes.number.isRequired,
  }).isRequired,
  onCenterChanged: PropTypes.func.isRequired,
  onSearchBoxMounted: PropTypes.func.isRequired,
  onPlacesChanged: PropTypes.func.isRequired,
  onRef: PropTypes.func.isRequired,
  homeStyles: PropTypes.object.isRequired,
  notifyError: PropTypes.func.isRequired,
  setCoords: PropTypes.func.isRequired,
};
