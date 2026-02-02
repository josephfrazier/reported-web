/**
 * Attachment gallery component for displaying uploaded photos/videos
 * Extracted from Home.js for better maintainability
 */

import React from 'react';
import PropTypes from 'prop-types';
import fileExtension from 'file-extension';

import { isImage } from '../../../isImage.js';

/**
 * Gallery displaying uploaded attachments with delete functionality
 */
export default function AttachmentGallery({
  attachments,
  onDelete,
  getBlobUrl,
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        clear: 'both',
        display: 'flex',
        flexWrap: 'wrap',
      }}
    >
      {attachments.map(attachmentFile => {
        const { name } = attachmentFile;
        const ext = fileExtension(name);
        const isImg = isImage({ ext });
        const src = getBlobUrl(attachmentFile);

        return (
          <div
            key={name}
            style={{
              width: '33%',
              margin: '0.1%',
              flexGrow: 1,
              position: 'relative',
            }}
          >
            <a href={src} target="_blank" rel="noopener noreferrer">
              {isImg ? (
                <img src={src} alt={name} />
              ) : (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video src={src} alt={name} />
              )}
            </a>

            <button
              type="button"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                padding: 0,
                margin: '1px',
                color: 'red', // Ubuntu Chrome shows black otherwise
                background: 'white',
              }}
              onClick={() => onDelete(name)}
            >
              <span role="img" aria-label="Delete photo/video">
                ❌
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

AttachmentGallery.propTypes = {
  attachments: PropTypes.arrayOf(PropTypes.object).isRequired,
  onDelete: PropTypes.func.isRequired,
  getBlobUrl: PropTypes.func.isRequired,
};
