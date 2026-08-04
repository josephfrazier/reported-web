import React from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-modal';

import homeStyles from './Home.css'; // eslint-disable-line css-modules/no-unused-class

function PlatePickerModal({ isOpen, results, onSelectPlate, onClose }) {
  return (
    <Modal
      parentSelector={() =>
        document.querySelector(`.${homeStyles.root}`) || document.body
      }
      isOpen={isOpen}
      onRequestClose={onClose}
      style={{
        content: {
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <h3 style={{ margin: '0 0 5px', flexShrink: 0 }}>
        Select a license plate
      </h3>
      {results.length === 0 && <p>No license plates detected in this photo.</p>}
      {results.map((result, i) => {
        let licenseState = null;
        try {
          licenseState = result.region.code.split('-')[1].toUpperCase();
        } catch {
          // ignore
        }

        return (
          <div
            key={result.plate}
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              flex: '1 1 0',
              minHeight: 0,
              marginBottom: '5px',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            {result.vehicleCropDataUrl && (
              <img
                src={result.vehicleCropDataUrl}
                alt={`Vehicle ${i + 1}`}
                style={{
                  minWidth: 0,
                  minHeight: 0,
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
            {result.plateCropDataUrl && (
              <img
                src={result.plateCropDataUrl}
                alt={`Plate ${result.plate.toUpperCase()}`}
                style={{
                  minWidth: 0,
                  minHeight: 0,
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            )}
            <div
              style={{
                flexShrink: 0,
                textAlign: 'center',
              }}
            >
              <strong>{result.plate.toUpperCase()}</strong>
              {result.vehicle && result.vehicle.type && (
                <span> ({result.vehicle.type})</span>
              )}
              <br />
              <button
                type="button"
                onClick={() => {
                  onSelectPlate({
                    plate: result.plate.toUpperCase(),
                    licenseState,
                  });
                }}
              >
                Use this plate
              </button>
            </div>
          </div>
        );
      })}
      <button type="button" style={{ flexShrink: 0 }} onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}

PlatePickerModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  results: PropTypes.arrayOf(PropTypes.object).isRequired,
  onSelectPlate: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default PlatePickerModal;
