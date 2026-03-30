import { describe, expect, it } from "vitest";
import { createFaceImageAnalyzer } from "../src/services/face/analysis.js";
import { AppError } from "../src/errors.js";

describe("face analysis module", () => {
  it("rejects non-data-url image payloads", async () => {
    const analyzer = createFaceImageAnalyzer(
      {
        encrypt: async (value: string) => ({ cipherText: value, keyId: "test-key" }),
        encryptBytes: async (value: Buffer) => ({ cipherText: value.toString("base64"), iv: "", authTag: "", keyId: "test-key" }),
        decrypt: async (value: { cipherText: string }) => value.cipherText,
        decryptBytes: async (value: { cipherText: string }) => Buffer.from(value.cipherText, "base64"),
        hashForComparison: (value: string) => value
      } as never,
      "tmp/uploads"
    );

    await expect(analyzer("not-a-data-url", "test-image")).rejects.toThrowError(AppError);
  });
});
