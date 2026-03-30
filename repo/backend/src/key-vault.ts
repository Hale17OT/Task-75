import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";

interface EncryptedKeyValue {
  iv: string;
  authTag: string;
  cipherText: string;
}

interface StoredVaultKey {
  id: string;
  createdAt: string;
  rotatedAt?: string | null;
  active: boolean;
  encryptedValue?: EncryptedKeyValue;
  value?: string;
}

interface VaultState {
  keys: StoredVaultKey[];
}

export interface VaultKey {
  id: string;
  createdAt: string;
  rotatedAt?: string | null;
  active: boolean;
  value: string;
}

export interface KeyVault {
  getActiveKey(): Promise<VaultKey>;
  getKey(keyId: string): Promise<VaultKey>;
  syncMetadata(): Promise<void>;
}

const AUTO_GENERATE_MASTER_KEY = "AUTO_GENERATE";

const vaultPathFor = (config: AppConfig) => `${config.DATA_DIR}/key-vault.json`;
const generatedMasterKeyPathFor = (config: AppConfig) => `${config.DATA_DIR}/key-vault.master.key`;

const hardenVaultFile = async (filePath: string) => {
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Some environments do not support POSIX permissions. The runtime remains functional,
    // but operators should still rely on OS-level file access controls for the vault path.
  }
};

const loadOrCreateGeneratedMasterKey = async (config: AppConfig) => {
  const filePath = generatedMasterKeyPathFor(config);
  await mkdir(config.DATA_DIR, { recursive: true });
  try {
    const existing = (await readFile(filePath, "utf8")).trim();
    const decoded = Buffer.from(existing, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== existing) {
      throw new Error("Generated key is invalid");
    }
    await hardenVaultFile(filePath);
    return decoded;
  } catch {
    const generated = randomBytes(32).toString("base64");
    await writeFile(filePath, generated, "utf8");
    await hardenVaultFile(filePath);
    return Buffer.from(generated, "base64");
  }
};

const decodeMasterKey = async (config: AppConfig) => {
  if (config.KEY_VAULT_MASTER_KEY === AUTO_GENERATE_MASTER_KEY) {
    return loadOrCreateGeneratedMasterKey(config);
  }

  const decoded = Buffer.from(config.KEY_VAULT_MASTER_KEY, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== config.KEY_VAULT_MASTER_KEY) {
    throw new Error("KEY_VAULT_MASTER_KEY must decode to exactly 32 bytes");
  }

  return decoded;
};

const encryptVaultValue = (value: string, masterKey: Buffer): EncryptedKeyValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    cipherText: encrypted.toString("base64")
  };
};

const decryptVaultValue = (value: EncryptedKeyValue, masterKey: Buffer) => {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.cipherText, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const toRuntimeVaultKey = (stored: StoredVaultKey, masterKey: Buffer): VaultKey => {
  if (stored.encryptedValue) {
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      rotatedAt: stored.rotatedAt ?? null,
      active: stored.active,
      value: decryptVaultValue(stored.encryptedValue, masterKey)
    };
  }

  if (stored.value) {
    return {
      id: stored.id,
      createdAt: stored.createdAt,
      rotatedAt: stored.rotatedAt ?? null,
      active: stored.active,
      value: stored.value
    };
  }

  throw new Error(`Vault key ${stored.id} is missing key material`);
};

const loadState = async (config: AppConfig): Promise<VaultState> => {
  const filePath = vaultPathFor(config);
  await mkdir(config.DATA_DIR, { recursive: true });

  try {
    const contents = await readFile(filePath, "utf8");
    await hardenVaultFile(filePath);
    return JSON.parse(contents) as VaultState;
  } catch {
    const createdAt = new Date().toISOString();
    const initialState: VaultState = {
      keys: [
        {
          id: `key-${createdAt.slice(0, 10)}`,
          createdAt,
          active: true,
          value: randomBytes(32).toString("base64")
        }
      ]
    };

    return initialState;
  }
};

const persistState = async (config: AppConfig, state: VaultState) => {
  const masterKey = await decodeMasterKey(config);
  const filePath = vaultPathFor(config);
  const persisted: VaultState = {
    keys: state.keys.map((key) => ({
      id: key.id,
      createdAt: key.createdAt,
      rotatedAt: key.rotatedAt ?? null,
      active: key.active,
      encryptedValue: key.encryptedValue ?? encryptVaultValue(String(key.value ?? ""), masterKey)
    }))
  };

  await writeFile(filePath, JSON.stringify(persisted, null, 2), "utf8");
  await hardenVaultFile(filePath);
};

const rotateIfNeeded = async (config: AppConfig, state: VaultState) => {
  const activeKey = state.keys.find((key) => key.active);

  if (!activeKey) {
    return null;
  }

  const keyAgeMs = Date.now() - new Date(activeKey.createdAt).getTime();
  if (keyAgeMs < config.KEY_ROTATION_DAYS * 24 * 60 * 60 * 1000) {
    return activeKey;
  }

  activeKey.active = false;
  activeKey.rotatedAt = new Date().toISOString();

  const replacementKey: StoredVaultKey = {
    id: `key-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    active: true,
    value: randomBytes(32).toString("base64")
  };

  state.keys.push(replacementKey);
  await persistState(config, state);

  return replacementKey;
};

const hasLegacyPlaintext = (state: VaultState) => state.keys.some((key) => key.value && !key.encryptedValue);

export const createKeyVault = (config: AppConfig, upsertMetadata: (key: VaultKey) => Promise<void>): KeyVault => ({
  async getActiveKey() {
    const masterKey = await decodeMasterKey(config);
    const state = await loadState(config);
    if (hasLegacyPlaintext(state)) {
      await persistState(config, state);
    }
    let activeKey: StoredVaultKey | null = await rotateIfNeeded(config, state);

    if (!activeKey) {
      activeKey = state.keys.find((key) => key.active) ?? null;
    }

    if (!activeKey) {
      activeKey = {
        id: `key-${new Date().toISOString().slice(0, 10)}`,
        createdAt: new Date().toISOString(),
        rotatedAt: null,
        active: true,
        value: randomBytes(32).toString("base64")
      };
      state.keys.push(activeKey);
      await persistState(config, state);
    }

    return toRuntimeVaultKey(activeKey, masterKey);
  },
  async getKey(keyId: string) {
    const masterKey = await decodeMasterKey(config);
    const state = await loadState(config);
    if (hasLegacyPlaintext(state)) {
      await persistState(config, state);
    }
    const key = state.keys.find((item) => item.id === keyId);

    if (!key) {
      throw new Error(`Unknown key ${keyId}`);
    }

    return toRuntimeVaultKey(key, masterKey);
  },
  async syncMetadata() {
    const masterKey = await decodeMasterKey(config);
    const state = await loadState(config);
    if (hasLegacyPlaintext(state)) {
      await persistState(config, state);
    }
    await rotateIfNeeded(config, state);

    for (const key of state.keys) {
      await upsertMetadata(toRuntimeVaultKey(key, masterKey));
    }
  }
});

export const getNodeSecret = (value: string) => createSecretKey(Buffer.from(value, "base64"));
export const defaultVaultMasterKey = AUTO_GENERATE_MASTER_KEY;
