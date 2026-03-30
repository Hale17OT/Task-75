import type { FaceBox, Landmarks } from "./types.js";

export const computeTrustedLivenessScore = (
  centerLandmarks: Landmarks,
  turnLandmarks: Landmarks,
  centerFaceBox: FaceBox,
  turnFaceBox: FaceBox
) => {
  const centerMidEye = (centerLandmarks.leftEye.x + centerLandmarks.rightEye.x) / 2;
  const turnMidEye = (turnLandmarks.leftEye.x + turnLandmarks.rightEye.x) / 2;
  const centerEyeDistance = Math.abs(centerLandmarks.rightEye.x - centerLandmarks.leftEye.x);
  const turnEyeDistance = Math.abs(turnLandmarks.rightEye.x - turnLandmarks.leftEye.x);
  const noseShift = Math.abs((turnLandmarks.nose.x - turnMidEye) - (centerLandmarks.nose.x - centerMidEye));
  const boxShift = Math.abs(
    turnFaceBox.x + turnFaceBox.width / 2 - (centerFaceBox.x + centerFaceBox.width / 2)
  );
  const verticalStabilityPenalty = Math.min(1, Math.abs(centerLandmarks.nose.y - turnLandmarks.nose.y) * 5);
  const eyeDistancePenalty = Math.min(1, Math.abs(centerEyeDistance - turnEyeDistance) * 4);
  const movementScore = noseShift * 4 + boxShift * 2;
  const structuralScore = Math.max(0, 1 - verticalStabilityPenalty - eyeDistancePenalty);

  return Math.max(0, Math.min(1, movementScore * 0.85 + structuralScore * 0.15));
};
