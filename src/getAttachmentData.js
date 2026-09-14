import { readAttachment } from './attachmentStore.js';

// Extracted from server.js's /submit handler so the attachment-data
// preparation can be tested directly without the surrounding HTTP/multer
// glue. Resolves to multer's file objects when attachmentIdsJson is absent,
// or to { buffer } entries read back from the attachment store when it is.
const getAttachmentData = async ({ attachmentIdsJson, files }) => {
  if (!attachmentIdsJson) {
    return files;
  }

  const parsedIds = JSON.parse(attachmentIdsJson);
  if (
    !Array.isArray(parsedIds) ||
    !parsedIds.every(id => typeof id === 'string')
  ) {
    throw { message: 'Invalid attachmentIds format' }; // eslint-disable-line no-throw-literal
  }

  return Promise.all(
    parsedIds.map(async id => {
      const buffer = await readAttachment(id);
      if (!buffer) {
        const message = `Attachment not found; please re-add your files and try again`;
        throw { message }; // eslint-disable-line no-throw-literal
      }
      return { buffer };
    }),
  );
};

export default getAttachmentData;
