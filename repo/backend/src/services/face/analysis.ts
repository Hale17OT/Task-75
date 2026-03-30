import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Jimp from "jimp";
import { AppError } from "../../errors.js";
import type { ReturnTypeOfCreateCryptoService } from "../service-utility-types.js";
import type { FaceBox, Landmarks, Point, TrustedFaceAnalysis } from "./types.js";

const decodeBase64Image = (value: string) => {
  const match = value.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/);
  if (!match) {
    throw new AppError(400, "image_invalid", "Images must be PNG or JPG data URLs");
  }

  const mimeType = match[1];
  const payload = Buffer.from(match[2], "base64");
  const extension = mimeType === "image/png" ? "png" : "jpg";

  return {
    extension,
    payload
  };
};

const computeBlurScore = (image: Jimp) => {
  const grayscale = image.clone().greyscale();
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < grayscale.bitmap.height - 1; y += 1) {
    for (let x = 1; x < grayscale.bitmap.width - 1; x += 1) {
      const center = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const right = Jimp.intToRGBA(grayscale.getPixelColor(x + 1, y)).r;
      const bottom = Jimp.intToRGBA(grayscale.getPixelColor(x, y + 1)).r;
      const edge = Math.abs(center - right) + Math.abs(center - bottom);
      sum += edge;
      sumSquares += edge * edge;
      count += 1;
    }
  }

  const mean = sum / count;
  return Math.sqrt(sumSquares / count - mean * mean);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizePoint = (x: number, y: number, width: number, height: number): Point => ({
  x: Number(clamp(x / width, 0, 1).toFixed(4)),
  y: Number(clamp(y / height, 0, 1).toFixed(4))
});

const deriveWeightedPoint = (
  image: Jimp,
  region: { left: number; top: number; right: number; bottom: number },
  threshold: number,
  label: string
) => {
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let darkest = { value: Number.POSITIVE_INFINITY, x: region.left, y: region.top };

  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(image.bitmap.height, Math.ceil(region.bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(image.bitmap.width, Math.ceil(region.right)); x += 1) {
      const brightness = Jimp.intToRGBA(image.getPixelColor(x, y)).r;
      if (brightness < darkest.value) {
        darkest = { value: brightness, x, y };
      }

      const weight = Math.max(0, threshold - brightness);
      if (weight <= 0) {
        continue;
      }

      totalWeight += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (totalWeight <= 0) {
    if (darkest.value < threshold) {
      return { x: darkest.x, y: darkest.y };
    }

    throw new AppError(400, "face_landmarks_invalid", `Unable to derive a trusted ${label} landmark from the image`);
  }

  return {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight
  };
};

const deriveTrustedMetadata = (image: Jimp) => {
  const grayscale = image.clone().greyscale();
  const width = grayscale.bitmap.width;
  const height = grayscale.bitmap.height;
  const sampleStep = 2;
  let brightnessTotal = 0;
  let brightnessCount = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      brightnessTotal += Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      brightnessCount += 1;
    }
  }

  const meanBrightness = brightnessTotal / brightnessCount;
  const darkThreshold = clamp(meanBrightness - 20, 24, 210);
  const horizontalMargin = width * 0.08;
  const verticalMargin = height * 0.08;

  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let y = Math.floor(verticalMargin); y < Math.ceil(height - verticalMargin); y += sampleStep) {
    for (let x = Math.floor(horizontalMargin); x < Math.ceil(width - horizontalMargin); x += sampleStep) {
      const brightness = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const weight = Math.max(0, darkThreshold - brightness);
      if (weight <= 0) {
        continue;
      }

      totalWeight += weight;
      weightedX += x * weight;
      weightedY += y * weight;
    }
  }

  if (totalWeight <= 200) {
    throw new AppError(400, "face_box_invalid", "A trusted face region could not be derived from the image");
  }

  const centroidX = weightedX / totalWeight;
  const centroidY = weightedY / totalWeight;

  for (let y = Math.floor(verticalMargin); y < Math.ceil(height - verticalMargin); y += sampleStep) {
    for (let x = Math.floor(horizontalMargin); x < Math.ceil(width - horizontalMargin); x += sampleStep) {
      const brightness = Jimp.intToRGBA(grayscale.getPixelColor(x, y)).r;
      const weight = Math.max(0, darkThreshold - brightness);
      if (weight <= 0) {
        continue;
      }

      varianceX += (x - centroidX) ** 2 * weight;
      varianceY += (y - centroidY) ** 2 * weight;
    }
  }

  const spreadX = Math.sqrt(varianceX / totalWeight);
  const spreadY = Math.sqrt(varianceY / totalWeight);
  const boxWidth = clamp(spreadX * 5.2, width * 0.22, width * 0.92);
  const boxHeight = clamp(spreadY * 6.2, height * 0.25, height * 0.94);
  const left = clamp(centroidX - boxWidth / 2, 0, width - boxWidth);
  const top = clamp(centroidY - boxHeight / 2, 0, height - boxHeight);

  const faceBox: FaceBox = {
    x: Number((left / width).toFixed(4)),
    y: Number((top / height).toFixed(4)),
    width: Number((boxWidth / width).toFixed(4)),
    height: Number((boxHeight / height).toFixed(4))
  };

  const faceInFrame =
    faceBox.width >= 0.22 &&
    faceBox.height >= 0.25 &&
    faceBox.x >= 0.02 &&
    faceBox.y >= 0.02 &&
    faceBox.x + faceBox.width <= 0.98 &&
    faceBox.y + faceBox.height <= 0.98;

  if (!faceInFrame) {
    throw new AppError(400, "face_box_invalid", "Face must be fully in frame");
  }

  const leftEye = deriveWeightedPoint(
    grayscale,
    {
      left,
      top,
      right: left + boxWidth * 0.48,
      bottom: top + boxHeight * 0.42
    },
    darkThreshold,
    "left eye"
  );
  const rightEye = deriveWeightedPoint(
    grayscale,
    {
      left: left + boxWidth * 0.52,
      top,
      right: left + boxWidth,
      bottom: top + boxHeight * 0.42
    },
    darkThreshold,
    "right eye"
  );
  const nose = deriveWeightedPoint(
    grayscale,
    {
      left: left + boxWidth * 0.28,
      top: top + boxHeight * 0.32,
      right: left + boxWidth * 0.72,
      bottom: top + boxHeight * 0.82
    },
    darkThreshold,
    "nose"
  );

  const landmarks: Landmarks = {
    leftEye: normalizePoint(leftEye.x, leftEye.y, width, height),
    rightEye: normalizePoint(rightEye.x, rightEye.y, width, height),
    nose: normalizePoint(nose.x, nose.y, width, height)
  };

  if (landmarks.leftEye.x >= landmarks.rightEye.x) {
    throw new AppError(400, "face_landmarks_invalid", "Trusted landmark detection did not produce a valid face geometry");
  }

  return {
    faceBox,
    landmarks,
    faceInFrame
  };
};

export const createFaceImageAnalyzer = (
  cryptoService: ReturnTypeOfCreateCryptoService,
  uploadsDir: string
) => {
  return async (
    dataUrl: string,
    filePrefix: string,
    options?: { persistArtifact?: boolean }
  ): Promise<TrustedFaceAnalysis> => {
    const { payload, extension } = decodeBase64Image(dataUrl);

    if (payload.byteLength > 5 * 1024 * 1024) {
      throw new AppError(400, "image_too_large", "Images must be 5 MB or smaller");
    }

    const image = await Jimp.read(payload);
    if (image.bitmap.width < 640 || image.bitmap.height < 480) {
      throw new AppError(400, "image_too_small", "Images must be at least 640x480");
    }

    const blurScore = computeBlurScore(image);
    const averageHash = image.hash();
    const trustedMetadata = deriveTrustedMetadata(image);

    if (options?.persistArtifact === false) {
      return {
        blurScore,
        averageHash,
        encryptedAverageHash: null,
        absolutePath: null,
        keyId: null,
        width: image.bitmap.width,
        height: image.bitmap.height,
        ...trustedMetadata
      };
    }

    const encryptedPayload = await cryptoService.encryptBytes(payload);
    const encryptedAverageHash = await cryptoService.encrypt(averageHash);
    const fileName = `${filePrefix}.${extension}.enc`;
    const absolutePath = join(uploadsDir, fileName);
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(absolutePath, JSON.stringify(encryptedPayload), "utf8");

    return {
      blurScore,
      averageHash,
      encryptedAverageHash,
      absolutePath,
      keyId: encryptedPayload.keyId,
      width: image.bitmap.width,
      height: image.bitmap.height,
      ...trustedMetadata
    };
  };
};
