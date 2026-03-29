import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { KeyVault } from "./key-vault.js";

export interface EncryptedValue {
  keyId: string;
  cipherText: string;
}

export const createCryptoService = (keyVault: KeyVault) => ({
  async encrypt(plainText: string): Promise<EncryptedValue> {
    const key = await keyVault.getActiveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key.value, "base64"), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      keyId: key.id,
      cipherText: Buffer.concat([iv, authTag, encrypted]).toString("base64")
    };
  },
  async decrypt(input: EncryptedValue): Promise<string> {
    const key = await keyVault.getKey(input.keyId);
    const raw = Buffer.from(input.cipherText, "base64");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const payload = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key.value, "base64"), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  },
  async encryptBytes(value: Buffer): Promise<EncryptedValue> {
    return this.encrypt(value.toString("base64"));
  },
  async decryptBytes(input: EncryptedValue): Promise<Buffer> {
    return Buffer.from(await this.decrypt(input), "base64");
  },
  hashForComparison(value: string) {
    return createHash("sha256").update(value).digest("hex");
  },
  maskPhone(phone: string | null) {
    if (!phone) {
      return null;
    }

    const last4 = phone.replace(/\D/g, "").slice(-4);
    return last4 ? `***-***-${last4}` : "***";
  }
});
