import { describe, expect, it } from "vitest";
import { computeTrustedLivenessScore } from "../src/services/face/liveness.js";

describe("face liveness scoring", () => {
  it("produces a bounded score", () => {
    const score = computeTrustedLivenessScore(
      {
        leftEye: { x: 0.35, y: 0.35 },
        rightEye: { x: 0.65, y: 0.35 },
        nose: { x: 0.5, y: 0.55 }
      },
      {
        leftEye: { x: 0.28, y: 0.34 },
        rightEye: { x: 0.58, y: 0.35 },
        nose: { x: 0.42, y: 0.55 }
      },
      { x: 0.2, y: 0.15, width: 0.6, height: 0.7 },
      { x: 0.14, y: 0.15, width: 0.6, height: 0.7 }
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores stronger when head-turn movement is present", () => {
    const staticScore = computeTrustedLivenessScore(
      {
        leftEye: { x: 0.35, y: 0.35 },
        rightEye: { x: 0.65, y: 0.35 },
        nose: { x: 0.5, y: 0.55 }
      },
      {
        leftEye: { x: 0.35, y: 0.35 },
        rightEye: { x: 0.65, y: 0.35 },
        nose: { x: 0.5, y: 0.55 }
      },
      { x: 0.2, y: 0.15, width: 0.6, height: 0.7 },
      { x: 0.2, y: 0.15, width: 0.6, height: 0.7 }
    );

    const movedScore = computeTrustedLivenessScore(
      {
        leftEye: { x: 0.35, y: 0.35 },
        rightEye: { x: 0.65, y: 0.35 },
        nose: { x: 0.5, y: 0.55 }
      },
      {
        leftEye: { x: 0.27, y: 0.34 },
        rightEye: { x: 0.57, y: 0.35 },
        nose: { x: 0.41, y: 0.55 }
      },
      { x: 0.2, y: 0.15, width: 0.6, height: 0.7 },
      { x: 0.12, y: 0.15, width: 0.6, height: 0.7 }
    );

    expect(movedScore).toBeGreaterThan(staticScore);
  });
});
