import { ATTACHMENT_TTL_MS, deleteAttachment } from './attachmentStore.js';

// How much of one IP's pre-uploaded attachments may sit unused at once.
//
// This replaces a cap of 30 uploads per 15 minutes, which counted requests
// rather than what they cost: thirty uploads could be thirty small photos or
// thirty of 20MB each. What the server actually spends is temp-directory space
// between an upload and the submission that uses it, so that is what is
// metered here.
//
// The budget comes back when a submission consumes the uploads it used, so a
// client that submits keeps its room rather than waiting out a window. An
// upload no submission ever uses holds its budget until the file's own TTL
// takes it, so nothing sits on it for ever.
//
// A quarter of a gigabyte is well over anything one report needs: the largest
// report allowed is three pictures and three videos of under 20MB, so 120MB,
// with room for the next report's photos to arrive before the last one has
// been submitted.
export const ATTACHMENT_BUDGET_BYTES = 250 * 1000 * 1000;

// ip -> Map(id -> { bytes, at })
const held = new Map();

const isLive = ({ at }) => Date.now() - at < ATTACHMENT_TTL_MS;

// The entries still within the TTL, with the expired ones dropped as they are
// found. Nothing else prunes: an entry that is never read again costs one
// object, and the file it stands for is gone either way.
function entriesFor(ip) {
  const entries = held.get(ip) || new Map();
  [...entries].forEach(([id, entry]) => {
    if (!isLive(entry)) {
      entries.delete(id);
    }
  });
  held.set(ip, entries);
  return entries;
}

export function outstandingBytes(ip) {
  let total = 0;
  entriesFor(ip).forEach(({ bytes }) => {
    total += bytes;
  });
  return total;
}

// Whether this IP can take on this much more. The boundary belongs to the
// client: a budget of exactly what it holds is still a budget.
export function canAfford({ ip, bytes }) {
  return outstandingBytes(ip) + bytes <= ATTACHMENT_BUDGET_BYTES;
}

// An upload the IP already holds costs nothing more, whatever it is uploaded
// under: the store is addressed by content, so those bytes are already on disk
// and a second copy of them is not written.
export function recordUpload({ ip, id, bytes }) {
  const entries = entriesFor(ip);
  if (!entries.has(id)) {
    entries.set(id, { bytes, at: Date.now() });
  }
}

// Give back a reservation that came to nothing, because the upload it stood
// for was refused. Nothing is deleted: no file was written for it, and any file
// already on disk under that id belongs to another client's entry.
export function forgetUpload({ ip, id }) {
  held.get(ip)?.delete(id);
}

// Release the uploads a submission used, and return the ones whose file can now
// be removed: an attachment no IP is holding any more.
//
// It is not simply everything the submission used. Two IPs that uploaded the
// same bytes hold one file between them, and one of them submitting must not
// take it out from under the other.
function consumeUploads({ ip, ids }) {
  const wanted = new Set(ids);

  entriesFor(ip);
  const mine = held.get(ip);
  wanted.forEach(id => mine.delete(id));

  const stillHeld = new Set();
  held.forEach((_, other) => {
    entriesFor(other).forEach((__, id) => stillHeld.add(id));
  });

  return [...wanted].filter(id => !stillHeld.has(id));
}

// A submission that used pre-uploaded attachments releases them: the budget
// they held comes back, and their files go now rather than sitting in the temp
// directory until the TTL. Called once the submission exists, so a failure
// leaves the uploads for the retry.
export async function releaseUploads({ ip, attachmentIdsJson }) {
  if (!attachmentIdsJson) {
    return;
  }

  let ids;
  try {
    ids = JSON.parse(attachmentIdsJson);
  } catch {
    // getAttachmentData refuses a body it cannot parse, so no submission was
    // made from this one.
    return;
  }

  await Promise.all(consumeUploads({ ip, ids }).map(deleteAttachment));
}
