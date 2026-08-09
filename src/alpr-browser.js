/**
 * Browser-side ALPR using ONNX Runtime Web + Tesseract.js
 *
 * Replaces the server-side Plate Recognizer API (api.platerecognizer.com) with
 * client-side machine learning: YOLO-based license plate detection followed by
 * Tesseract.js OCR on the cropped plate region.
 *
 * Architecture matches new.rprtd.app's approach:
 *   - ONNX Runtime Web for ML inference (plate detection)
 *   - Canvas API for image preprocessing (instead of OpenCV.js, for lightness)
 *   - Tesseract.js for OCR on detected plates
 *
 * Everything runs in the browser — no external API calls, no API tokens needed.
 */

import * as ort from 'onnxruntime-web';
import Tesseract from 'tesseract.js';

// ---------------------------------------------------------------------------
// Model loading (singleton)
// ---------------------------------------------------------------------------

let modelSession = null;
let modelLoadPromise = null;

/**
 * Load the YOLO-based license plate detection ONNX model.
 * Uses a singleton pattern so the model is loaded only once.
 *
 * @returns {Promise<ort.InferenceSession>}
 */
export async function loadModel() {
  if (modelSession) return modelSession;
  if (modelLoadPromise) return modelLoadPromise;

  modelLoadPromise = (async () => {
    // Configure ONNX Runtime Web WASM paths.
    // Webpack copies .wasm files under node_modules/onnxruntime-web/dist/ in
    // the build output, so point ORT there.
    ort.env.wasm.wasmPaths = '/assets/node_modules/onnxruntime-web/dist/';

    console.time('loadModel'); // eslint-disable-line no-console
    modelSession = await ort.InferenceSession.create(
      '/assets/models/license_plate_yolo.onnx',
    );
    console.timeEnd('loadModel'); // eslint-disable-line no-console
    return modelSession;
  })();

  return modelLoadPromise;
}

// ---------------------------------------------------------------------------
// Image preprocessing (Canvas API — no OpenCV.js needed)
// ---------------------------------------------------------------------------

/**
 * Preprocess an image element into the tensor format expected by the YOLO model.
 *
 * Model input:  float32[1, 3, 320, 320]  (NCHW, normalized to [0, 1])
 *
 * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} imageElement
 * @param {number} [targetWidth=320]
 * @param {number} [targetHeight=320]
 * @returns {{ input: Float32Array, canvas: HTMLCanvasElement }}
 */
function preprocessImage(imageElement, targetWidth = 320, targetHeight = 320) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageElement, 0, 0, targetWidth, targetHeight);

  const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const { data } = imageData; // RGBA uint8

  const pixels = targetWidth * targetHeight;
  const input = new Float32Array(3 * pixels);

  // Convert RGBA → NCHW float32, normalizing to [0, 1]
  for (let i = 0; i < pixels; i += 1) {
    const r = i;
    const g = pixels + i;
    const b = 2 * pixels + i;
    const srcIdx = i * 4;
    input[r] = data[srcIdx] / 255.0; // R
    input[g] = data[srcIdx + 1] / 255.0; // G
    input[b] = data[srcIdx + 2] / 255.0; // B
  }

  return { input, canvas };
}

// ---------------------------------------------------------------------------
// Post-processing: YOLO output → bounding boxes
// ---------------------------------------------------------------------------

/**
 * Convert raw YOLO model output into a sorted list of detection boxes.
 *
 * Model output: float32[1, 5, 2100]
 *   Each of the 2100 candidate detections has 5 values:
 *     [x_center, y_center, width, height, objectness]
 *   All coordinates are normalised to [0, 1].
 *
 * @param {ort.Tensor} outputTensor
 * @param {number} imgWidth   - original image width in pixels
 * @param {number} imgHeight  - original image height in pixels
 * @param {number} [confThreshold=0.5]
 * @returns {Array<{box: {xmin: number, ymin: number, xmax: number, ymax: number}, score: number}>}
 */
function postprocessDetections(
  outputTensor,
  imgWidth,
  imgHeight,
  confThreshold = 0.5,
) {
  const { data } = outputTensor;
  const numDetections = 2100;
  const detections = [];

  for (let i = 0; i < numDetections; i += 1) {
    const x = data[i]; // x_center (normalised)
    const y = data[numDetections + i]; // y_center
    const w = data[2 * numDetections + i]; // width
    const h = data[3 * numDetections + i]; // height
    const conf = data[4 * numDetections + i]; // objectness score

    if (conf >= confThreshold) {
      // Convert centre-format → corner-format, normalised → pixel coordinates
      const xmin = Math.max(0, (x - w / 2) * imgWidth);
      const ymin = Math.max(0, (y - h / 2) * imgHeight);
      const xmax = Math.min(imgWidth, (x + w / 2) * imgWidth);
      const ymax = Math.min(imgHeight, (y + h / 2) * imgHeight);

      detections.push({
        box: { xmin, ymin, xmax, ymax },
        score: conf,
      });
    }
  }

  // Sort by confidence descending
  detections.sort((a, b) => b.score - a.score);

  return detections;
}

// ---------------------------------------------------------------------------
// OCR on cropped plate region
// ---------------------------------------------------------------------------

/**
 * Run Tesseract.js OCR on a cropped plate region from a canvas.
 *
 * @param {HTMLCanvasElement} sourceCanvas - the original image canvas
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} box
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function ocrPlateRegion(sourceCanvas, box) {
  const { xmin, ymin, xmax, ymax } = box;
  const width = xmax - xmin;
  const height = ymax - ymin;

  if (width <= 0 || height <= 0) {
    return { text: '', confidence: 0 };
  }

  // Crop the plate region onto a new canvas
  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = width;
  plateCanvas.height = height;
  const ctx = plateCanvas.getContext('2d');
  ctx.drawImage(sourceCanvas, xmin, ymin, width, height, 0, 0, width, height);

  // Tesseract works best with the plate text roughly horizontal.
  // We use single-line whitelist of common license-plate characters.
  const {
    data: { text, confidence },
  } = await Tesseract.recognize(plateCanvas, 'eng', {
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    // Single block of text — treat the whole crop as one line
    psm: Tesseract.PSM.SINGLE_BLOCK,
  });

  return {
    text: text.replace(/\s/g, '').toUpperCase(),
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Main entry point — full detection + OCR pipeline
// ---------------------------------------------------------------------------

/**
 * Detect license plates in an image and read their text.
 *
 * This is the main replacement for the server-side readLicenseViaALPR().
 * Instead of POSTing to api.platerecognizer.com, it runs a YOLO ONNX model
 * for detection and Tesseract.js for OCR — entirely in the browser.
 *
 * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} imageElement
 * @param {object} [options]
 * @param {number} [options.confThreshold=0.5] - minimum detection confidence
 * @returns {Promise<Array<{plate: string, score: number, box: object, plateCropDataUrl: string}>>}
 */
export async function detectPlates(imageElement, options = {}) {
  const { confThreshold = 0.5 } = options;

  // --- 1. Load model ---
  const session = await loadModel();

  // --- 2. Preprocess ---
  const { input } = preprocessImage(imageElement);

  // --- 3. Run detection inference ---
  console.time('alpr-browser detection'); // eslint-disable-line no-console
  const tensor = new ort.Tensor('float32', input, [1, 3, 320, 320]);
  const outputs = await session.run({ images: tensor });
  console.timeEnd('alpr-browser detection'); // eslint-disable-line no-console

  const detections = postprocessDetections(
    outputs.output0,
    imageElement.naturalWidth || imageElement.width,
    imageElement.naturalHeight || imageElement.height,
    confThreshold,
  );

  if (detections.length === 0) {
    return [];
  }

  // --- 4. OCR on each detection (take top N to avoid excessive work) ---
  const topDetections = detections.slice(0, 5);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = imageElement.naturalWidth || imageElement.width;
  sourceCanvas.height = imageElement.naturalHeight || imageElement.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.drawImage(
    imageElement,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );

  console.time('alpr-browser ocr'); // eslint-disable-line no-console
  const results = await Promise.all(
    topDetections.map(async (det, idx) => {
      const ocr = await ocrPlateRegion(sourceCanvas, det.box);

      // Generate plate crop data URL
      const { xmin, ymin, xmax, ymax } = det.box;
      const cropW = xmax - xmin;
      const cropH = ymax - ymin;
      let plateCropDataUrl = '';
      if (cropW > 0 && cropH > 0) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(
          sourceCanvas,
          xmin,
          ymin,
          cropW,
          cropH,
          0,
          0,
          cropW,
          cropH,
        );
        plateCropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.85);
      }

      return {
        plate: ocr.text,
        score: det.score,
        dscore: det.score,
        box: det.box,
        // Emulate PlateRecognizer's region format so downstream code works
        region: {
          code: 'us-ny',
          score: det.score,
        },
        candidates: [{ plate: ocr.text, score: det.score }],
        plateCropDataUrl,
        // Vehicle detection is not part of this pipeline; keep fields for
        // backwards compatibility with code that destructures them.
        vehicle: {
          score: 0,
          type: '',
          box: null,
        },
        vehicleCropDataUrl: null,
        // Additional debug info (not part of the PlateRecognizer contract)
        _detectionIndex: idx,
        _ocrConfidence: ocr.confidence,
      };
    }),
  );
  console.timeEnd('alpr-browser ocr'); // eslint-disable-line no-console

  // Filter out results with empty plate text (failed OCR)
  return results.filter(r => r.plate.length > 0);
}

// ---------------------------------------------------------------------------
// Compatibility helper — returns results in the same shape the old
// server-side /platerecognizer endpoint returned.
// ---------------------------------------------------------------------------

/**
 * Load a File/Blob into an ImageBitmap (or Image element as fallback).
 *
 * @param {File|Blob} file
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
function createImageFromFile(file) {
  if (typeof createImageBitmap !== 'undefined') {
    return createImageBitmap(file);
  }

  // Fallback for environments without createImageBitmap
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/**
 * Run the full ALPR pipeline and return a PlateRecognizer-compatible object.
 *
 * The return shape matches what the old server-side endpoint returned:
 *   { results: Array<{plate, score, box, region, candidates, ...}> }
 *
 * @param {File|Blob} file - image file from <input> or drop
 * @param {object} [options]
 * @returns {Promise<{results: Array}>}
 */
export async function readLicensePlateFromFile(file, options = {}) {
  // Create an ImageBitmap from the file/blob for use with the pipeline
  const imageElement = await createImageFromFile(file);

  const results = await detectPlates(imageElement, options);

  // Close the bitmap to free memory
  if (imageElement.close) {
    imageElement.close();
  }

  return { results };
}

export default readLicensePlateFromFile;
