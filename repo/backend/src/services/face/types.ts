export interface Point {
  x: number;
  y: number;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Landmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
}

export interface FaceEnrollmentInput {
  memberUserId: number;
  actorUserId: number;
  sourceType: "camera" | "import";
  challengeId: string;
  centerImageBase64: string;
  turnImageBase64: string;
}

export interface FaceDedupPreviewInput {
  memberUserId: number;
  sourceType: "camera" | "import";
  centerImageBase64: string;
  turnImageBase64: string;
}

export interface LivenessChallenge {
  challengeId: string;
  memberUserId: number;
  actorUserId: number;
  issuedAt: number;
  expiresAt: number;
}

export interface TrustedFaceAnalysis {
  blurScore: number;
  averageHash: string;
  encryptedAverageHash: {
    cipherText: string;
    keyId: string;
  } | null;
  absolutePath: string | null;
  keyId: string | null;
  width: number;
  height: number;
  faceBox: FaceBox;
  landmarks: Landmarks;
  faceInFrame: boolean;
}
