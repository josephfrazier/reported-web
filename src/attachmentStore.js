import os from 'os';
import fs from 'fs';
import path from 'path';

// Disk-based store for pre-uploaded attachment files.
// Files are written to the OS temp directory and named by their SHA-256 hash.
// Using the temp directory keeps them off of any persistent storage, matching
// Heroku's ephemeral filesystem behaviour (the server can restart at any time,
// wiping temp files – the existing "not found" error handling covers that case).
export const ATTACHMENT_TTL_MS = 60 * 60 * 1000; // 1 hour

export const ATTACHMENT_ID_RE = /^[0-9a-f]{64}$/; // SHA-256 hex string

export function attachmentFilePath(id) {
  if (!ATTACHMENT_ID_RE.test(id)) {
    throw new Error(`Invalid attachment id: ${id}`);
  }
  return path.join(os.tmpdir(), `reported-web-attachment-${id}`);
}

export async function writeAttachment(id, buffer) {
  await fs.promises.writeFile(attachmentFilePath(id), buffer);
  // Schedule cleanup so temp files don't accumulate indefinitely
  const cleanupTimer = setTimeout(() => {
    fs.promises.unlink(attachmentFilePath(id)).catch(() => {}); // ignore errors (may already be gone)
  }, ATTACHMENT_TTL_MS);
  // Don't hold the process open just for cleanup; jest's fake timers don't
  // implement unref(), hence the optional call.
  cleanupTimer.unref?.();
}

export async function readAttachment(id) {
  try {
    return await fs.promises.readFile(attachmentFilePath(id));
  } catch {
    return null; // file not found (server restarted, TTL elapsed, etc.)
  }
}
