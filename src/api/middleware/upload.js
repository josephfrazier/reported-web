/**
 * Multer configuration for file uploads
 */

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1000 * 1000, // just under 20MB, should match attachmentFile.size in Home.js
    files: 6,
  },
});
// Here's the logic for the above `limits`:
// * Back4App has a per-file limit of 20mb: https://www.back4app.com/pricing
// * Up to 6 files can be included with each submission to Back4App:
//   * photoData0
//   * photoData1
//   * photoData2
//   * videoData0
//   * videoData1
//   * videoData2

export default upload;
