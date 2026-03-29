import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyVault } from "../src/key-vault.js";
import { baseConfig } from "./test-helpers.js";

describe("key vault", () => {
  const tempDir = join(process.cwd(), "temp-test-key-vault");
  const metadataUpsert = vi.fn(async () => {});

  beforeEach(async () => {
    metadataUpsert.mockClear();
    await rm(tempDir, { force: true, recursive: true });
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("creates an initial local vault when none exists", async () => {
    const keyVault = createKeyVault(
      {
        ...baseConfig,
        DATA_DIR: tempDir,
        KEY_ROTATION_DAYS: 180
      },
      metadataUpsert
    );

    const key = await keyVault.getActiveKey();
    const rawVault = JSON.parse(await readFile(join(tempDir, "key-vault.json"), "utf8")) as {
      keys: Array<{ encryptedValue?: { cipherText: string }; value?: string }>;
    };

    expect(key.id).toMatch(/^key-/);
    expect(key.active).toBe(true);
    expect(rawVault.keys[0]?.encryptedValue?.cipherText).toBeTruthy();
    expect(rawVault.keys[0]?.value).toBeUndefined();
  });

  it("rotates stale active keys and syncs historical metadata", async () => {
    const staleDate = "2025-01-01T00:00:00.000Z";
    await writeFile(
      join(tempDir, "key-vault.json"),
      JSON.stringify(
        {
          keys: [
            {
              id: "key-old",
              createdAt: staleDate,
              rotatedAt: null,
              active: true,
              value: Buffer.alloc(32, 4).toString("base64")
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const keyVault = createKeyVault(
      {
        ...baseConfig,
        DATA_DIR: tempDir,
        KEY_ROTATION_DAYS: 1
      },
      metadataUpsert
    );

    const activeKey = await keyVault.getActiveKey();
    await keyVault.syncMetadata();
    const contents = JSON.parse(await readFile(join(tempDir, "key-vault.json"), "utf8")) as {
      keys: Array<{ id: string; active: boolean; rotatedAt?: string | null; encryptedValue?: { cipherText: string }; value?: string }>;
    };

    expect(activeKey.id).not.toBe("key-old");
    expect(contents.keys.find((item) => item.id === "key-old")?.active).toBe(false);
    expect(contents.keys.find((item) => item.id === "key-old")?.rotatedAt).toBeTruthy();
    expect(contents.keys.every((item) => !item.value && Boolean(item.encryptedValue?.cipherText))).toBe(true);
    expect(metadataUpsert).toHaveBeenCalledTimes(2);
  });

  it("loads historical keys and rejects unknown key ids", async () => {
    await writeFile(
      join(tempDir, "key-vault.json"),
      JSON.stringify(
        {
          keys: [
            {
              id: "key-known",
              createdAt: new Date().toISOString(),
              rotatedAt: null,
              active: true,
              value: Buffer.alloc(32, 5).toString("base64")
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    const keyVault = createKeyVault(
      {
        ...baseConfig,
        DATA_DIR: tempDir,
        KEY_ROTATION_DAYS: 180
      },
      metadataUpsert
    );

    const key = await keyVault.getKey("key-known");

    expect(key.id).toBe("key-known");
    await expect(keyVault.getKey("missing-key")).rejects.toThrowError("Unknown key missing-key");
  });
});
