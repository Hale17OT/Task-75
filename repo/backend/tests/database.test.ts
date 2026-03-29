import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../src/database.js";
import { baseConfig } from "./test-helpers.js";

const { queryMock, executeMock, endMock, createPoolMock } = vi.hoisted(() => {
  const query = vi.fn();
  const execute = vi.fn();
  const end = vi.fn();
  const createPool = vi.fn(() => ({
    query,
    execute,
    end
  }));

  return {
    queryMock: query,
    executeMock: execute,
    endMock: end,
    createPoolMock: createPool
  };
});

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: createPoolMock
  },
  createPool: createPoolMock
}));

describe("database", () => {
  beforeEach(() => {
    queryMock.mockReset();
    executeMock.mockReset();
    endMock.mockReset();
    createPoolMock.mockClear();
  });

  it("pings successfully when the pool query works", async () => {
    queryMock.mockResolvedValue([[]]);
    const database = createDatabase(baseConfig);

    await expect(database.ping()).resolves.toBe(true);
  });

  it("returns false when ping fails", async () => {
    queryMock.mockRejectedValue(new Error("down"));
    const database = createDatabase(baseConfig);

    await expect(database.ping()).resolves.toBe(false);
  });

  it("delegates execute and close to the pool", async () => {
    executeMock.mockResolvedValue([{}]);
    endMock.mockResolvedValue(undefined);
    const database = createDatabase(baseConfig);

    await database.execute("SELECT 1", []);
    await database.close();

    expect(executeMock).toHaveBeenCalledWith("SELECT 1", []);
    expect(endMock).toHaveBeenCalledTimes(1);
  });
});

