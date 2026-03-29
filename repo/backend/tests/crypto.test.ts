import { describe, expect, it } from "vitest";
import { createCryptoService } from "../src/crypto.js";

describe("crypto service", () => {
  const keyVault = {
    async getActiveKey() {
      return {
        id: "key-current",
        createdAt: new Date().toISOString(),
        active: true,
        value: Buffer.alloc(32, 7).toString("base64")
      };
    },
    async getKey() {
      return {
        id: "key-current",
        createdAt: new Date().toISOString(),
        active: true,
        value: Buffer.alloc(32, 7).toString("base64")
      };
    },
    async syncMetadata() {}
  };

  it("encrypts and decrypts values with key version metadata", async () => {
    const cryptoService = createCryptoService(keyVault);

    const encrypted = await cryptoService.encrypt("251912345678");
    const decrypted = await cryptoService.decrypt(encrypted);

    expect(encrypted.keyId).toBe("key-current");
    expect(decrypted).toBe("251912345678");
  });

  it("masks phone numbers by default", () => {
    const cryptoService = createCryptoService(keyVault);

    expect(cryptoService.maskPhone("251912345678")).toBe("***-***-5678");
    expect(cryptoService.maskPhone(null)).toBeNull();
  });
});
