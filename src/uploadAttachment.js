import { logIn } from './users.js';
import { attachmentId, writeAttachment } from './attachmentStore.js';

// Create a pre-submission attachment: authenticate the user the same way the
// submission routes do, then store the file in the temp-dir attachment store
// under its SHA-256 hash. Extracted from server.js's /api/uploadAttachment.
export default async function uploadAttachment({ email, password, buffer }) {
  await logIn({ email, password });

  const id = attachmentId(buffer);
  await writeAttachment(id, buffer);
  return id;
}
