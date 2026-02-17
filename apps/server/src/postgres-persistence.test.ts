import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const endMock = vi.fn();

vi.mock("pg", () => {
  class Pool {
    query = queryMock;
    end = endMock;
  }

  return { Pool };
});

import { PostgresRuntimeSnapshotStore } from "./postgres-persistence.js";

describe("PostgresRuntimeSnapshotStore", () => {
  beforeEach(() => {
    queryMock.mockReset();
    endMock.mockReset();
  });

  it("creates runtime_snapshots table on initialize", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const store = new PostgresRuntimeSnapshotStore("postgres://example:test@localhost:5432/companion");

    await store.initialize();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]?.[0] ?? "")).toContain("CREATE TABLE IF NOT EXISTS runtime_snapshots");
  });

  it("persists snapshot and skips unchanged checksum writes", async () => {
    queryMock.mockResolvedValue({ rows: [{ updated_at: "2026-02-17T00:00:00.000Z" }] });
    const store = new PostgresRuntimeSnapshotStore("postgres://example:test@localhost:5432/companion");

    const changed = await store.persistSnapshot(Buffer.from("snapshot-data"));
    const unchanged = await store.persistSnapshot(Buffer.from("snapshot-data"));

    expect(changed).toBe(true);
    expect(unchanged).toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("restores stored snapshot into sqlite file path", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          sqlite_blob: Buffer.from("sqlite-bytes"),
          sqlite_size_bytes: "11",
          checksum: "abc123",
          updated_at: "2026-02-17T15:00:00.000Z"
        }
      ]
    });

    const store = new PostgresRuntimeSnapshotStore("postgres://example:test@localhost:5432/companion");
    const tempDir = await mkdtemp(join(tmpdir(), "companion-snapshot-"));
    const sqlitePath = join(tempDir, "companion.db");

    const restored = await store.restoreToSqliteFile(sqlitePath);
    const fileData = await readFile(sqlitePath, "utf-8");

    expect(restored.restored).toBe(true);
    expect(restored.sizeBytes).toBe(11);
    expect(fileData).toBe("sqlite-bytes");
  });

  it("captures flush errors in diagnostics", async () => {
    queryMock.mockRejectedValue(new Error("database unavailable"));
    const store = new PostgresRuntimeSnapshotStore("postgres://example:test@localhost:5432/companion");

    await expect(store.flush(() => Buffer.from("payload"))).rejects.toThrow("database unavailable");

    const diagnostics = store.getDiagnostics("companion.db");
    expect(diagnostics.lastError).toContain("database unavailable");
  });
});
