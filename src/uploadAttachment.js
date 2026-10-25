import { attachmentId, writeAttachment } from './attachmentStore.js';

// Create a pre-submission attachment: store the file in the temp-dir
// attachment store under its SHA-256 hash. Authenticating the uploader is the
// route's job (the session cookie), so this module only handles the bytes.
export default async function uploadAttachment({ buffer }) {
  const id = attachmentId(buffer);
  await writeAttachment(id, buffer);
  return id;
}
