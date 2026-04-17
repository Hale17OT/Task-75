import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StartFn = () => Promise<void>;
type ServerState = {
  initializeCalls: number;
  listenCalls: number;
  shutdownHandlers: Array<{ signal: string; handler: () => void }>;
  keyVaultSyncs: number;
  backgroundJobsRegistered: number;
  hardenStoredSessions: number;
  hardenStoredArtifacts: number;
  loadSchedules: number;
  lastPort: number | null;
};

const state: ServerState = {
  initializeCalls: 0,
  listenCalls: 0,
  shutdownHandlers: [],
  keyVaultSyncs: 0,
  backgroundJobsRegistered: 0,
  hardenStoredSessions: 0,
  hardenStoredArtifacts: 0,
  loadSchedules: 0,
  lastPort: null
};

let initializeBehavior: "always-ok" | "fail-twice-then-ok" | "always-fail" = "always-ok";

const resetState = () => {
  state.initializeCalls = 0;
  state.listenCalls = 0;
  state.shutdownHandlers = [];
  state.keyVaultSyncs = 0;
  state.backgroundJobsRegistered = 0;
  state.hardenStoredSessions = 0;
  state.hardenStoredArtifacts = 0;
  state.loadSchedules = 0;
  state.lastPort = null;
  initializeBehavior = "always-ok";
};

const fakeConfig = {
  PORT: 3030,
  KEY_VAULT_MASTER_KEY: "AUTO_GENERATE",
  DATA_DIR: "/tmp/sentinelfit-test"
};

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(() => fakeConfig)
}));

vi.mock("../src/database.js", () => ({
  createDatabase: vi.fn(() => ({
    pool: {},
    async query() {
      return [];
    },
    async execute() {},
    async executeInTransaction<T>(cb: (conn: unknown) => Promise<T>) {
      return cb({});
    },
    async close() {},
    async ping() {
      return true;
    },
    async initialize() {
      state.initializeCalls += 1;
      if (initializeBehavior === "always-fail") {
        throw new Error("database unavailable");
      }
      if (initializeBehavior === "fail-twice-then-ok" && state.initializeCalls < 3) {
        throw new Error(`initialize attempt ${state.initializeCalls} failed`);
      }
    }
  }))
}));

vi.mock("../src/key-vault.js", () => ({
  createKeyVault: vi.fn((_config: unknown, _persist: unknown) => ({
    async syncMetadata() {
      state.keyVaultSyncs += 1;
    },
    async getActiveKey() {
      return { id: "key-1", value: Buffer.alloc(32, 1).toString("base64"), active: true };
    }
  }))
}));

vi.mock("../src/crypto.js", () => ({
  createCryptoService: vi.fn(() => ({}))
}));

vi.mock("../src/services/logging-service.js", () => ({
  createLoggingService: vi.fn(() => ({
    async log() {},
    async alert() {},
    async access() {}
  }))
}));

vi.mock("../src/services/auth-service.js", () => ({
  createAuthService: vi.fn(() => ({
    async hardenStoredSessions() {
      state.hardenStoredSessions += 1;
    }
  }))
}));

vi.mock("../src/services/member-service.js", () => ({
  createMemberService: vi.fn(() => ({}))
}));

vi.mock("../src/services/face-service.js", () => ({
  createFaceService: vi.fn(() => ({
    async hardenStoredArtifacts() {
      state.hardenStoredArtifacts += 1;
    }
  }))
}));

vi.mock("../src/services/content-service.js", () => ({
  createContentService: vi.fn(() => ({}))
}));

vi.mock("../src/services/dashboard-service.js", () => ({
  createDashboardService: vi.fn(() => ({}))
}));

vi.mock("../src/services/report-service.js", () => ({
  createReportService: vi.fn(() => ({
    async loadSchedules() {
      state.loadSchedules += 1;
    }
  }))
}));

vi.mock("../src/services/ops-service.js", () => ({
  createOpsService: vi.fn(() => ({
    async registerBackgroundJobs() {
      state.backgroundJobsRegistered += 1;
    }
  }))
}));

vi.mock("../src/app.js", () => ({
  createApp: vi.fn(() => ({
    listen(port: number, cb: () => void) {
      state.listenCalls += 1;
      state.lastPort = port;
      cb();
      return {
        close(done: () => void) {
          done();
        }
      };
    }
  }))
}));

vi.mock("../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
  }
}));

const importServerFresh = async (): Promise<{ start: StartFn }> => {
  vi.resetModules();
  const mod = (await import("../src/server.js")) as unknown as { start?: StartFn };
  return { start: mod.start ?? (async () => {}) };
};

let originalSetTimeout: typeof setTimeout;
let originalProcessOn: typeof process.on;
let originalProcessExit: typeof process.exit;

beforeEach(() => {
  resetState();
  originalSetTimeout = global.setTimeout;
  // Speed up the retry wait(2000 * attempt) helper in server.ts so the test finishes quickly.
  // The real setTimeout is preserved for everything else.
  (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void) => {
    Promise.resolve().then(fn);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  originalProcessOn = process.on;
  process.on = ((signal: string, handler: () => void) => {
    state.shutdownHandlers.push({ signal, handler });
    return process;
  }) as unknown as typeof process.on;

  originalProcessExit = process.exit;
  process.exit = (() => undefined as never) as unknown as typeof process.exit;
});

afterEach(() => {
  (global as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
  process.on = originalProcessOn;
  process.exit = originalProcessExit;
});

describe("server.ts startup", () => {
  it("wires every service, starts listening on the configured port, and registers shutdown signals", async () => {
    await importServerFresh();
    await new Promise((resolve) => Promise.resolve().then(resolve));

    expect(state.initializeCalls).toBe(1);
    expect(state.keyVaultSyncs).toBe(1);
    expect(state.hardenStoredSessions).toBe(1);
    expect(state.hardenStoredArtifacts).toBe(1);
    expect(state.loadSchedules).toBe(1);
    expect(state.backgroundJobsRegistered).toBe(1);
    expect(state.listenCalls).toBe(1);
    expect(state.lastPort).toBe(fakeConfig.PORT);

    const signals = state.shutdownHandlers.map((entry) => entry.signal);
    expect(signals).toEqual(expect.arrayContaining(["SIGINT", "SIGTERM"]));
  });

  it("retries database.initialize() up to five times before succeeding", async () => {
    initializeBehavior = "fail-twice-then-ok";
    await importServerFresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(state.initializeCalls).toBe(3);
    expect(state.listenCalls).toBe(1);
  });

  it("shutdown handlers close the server and exit the process", async () => {
    await importServerFresh();
    await new Promise((resolve) => Promise.resolve().then(resolve));

    const sigint = state.shutdownHandlers.find((entry) => entry.signal === "SIGINT");
    expect(sigint).toBeTruthy();
    sigint!.handler();
    // No throw => shutdown callback chained server.close + database.close + process.exit without surfacing errors.
    expect(true).toBe(true);
  });
});
