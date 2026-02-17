import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { Pool } from "pg";

export interface RuntimeSnapshotRestoreResult {
  restored: boolean;
  updatedAt: string | null;
  sizeBytes: number;
}

export interface PostgresPersistenceDiagnostics {
  backend: "sqlite" | "postgres-snapshot";
  sqlitePath: string;
  snapshotRestoredAt: string | null;
  snapshotPersistedAt: string | null;
  snapshotSizeBytes: number;
  lastError: string | null;
}

interface RuntimeSnapshotRow {
  sqlite_blob: Buffer;
  sqlite_size_bytes: number | string;
  checksum: string;
  updated_at: Date | string;
}

function checksum(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}

function shouldEnableSsl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  if (lower.includes("sslmode=disable")) {
    return false;
  }
  if (lower.includes("sslmode=require") || lower.includes("ssl=true")) {
    return true;
  }
  return process.env.PGSSLMODE === "require";
}

export class PostgresRuntimeSnapshotStore {
  private readonly pool: Pool;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private lastPersistedChecksum: string | null = null;
  private lastPersistedAt: string | null = null;
  private lastRestoredAt: string | null = null;
  private lastSnapshotSizeBytes = 0;
  private lastError: string | null = null;

  constructor(databaseUrl: string) {
    const useSsl = shouldEnableSsl(databaseUrl);
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS runtime_snapshots (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        sqlite_blob BYTEA NOT NULL,
        sqlite_size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async restoreToSqliteFile(sqlitePath: string): Promise<RuntimeSnapshotRestoreResult> {
    const result = await this.pool.query<RuntimeSnapshotRow>(
      `SELECT sqlite_blob, sqlite_size_bytes, checksum, updated_at
       FROM runtime_snapshots
       WHERE id = 1`
    );

    if (result.rows.length === 0) {
      return {
        restored: false,
        updatedAt: null,
        sizeBytes: 0
      };
    }

    const row = result.rows[0];
    const absolutePath = resolve(sqlitePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, row.sqlite_blob);

    const updatedAt = new Date(row.updated_at).toISOString();
    this.lastRestoredAt = updatedAt;
    this.lastPersistedAt = updatedAt;
    this.lastPersistedChecksum = row.checksum;
    const sizeBytes = typeof row.sqlite_size_bytes === "number"
      ? row.sqlite_size_bytes
      : Number.parseInt(row.sqlite_size_bytes, 10) || 0;

    this.lastSnapshotSizeBytes = sizeBytes;
    this.lastError = null;

    return {
      restored: true,
      updatedAt,
      sizeBytes
    };
  }

  async persistSnapshot(snapshotBuffer: Buffer): Promise<boolean> {
    if (snapshotBuffer.length === 0) {
      throw new Error("Cannot persist empty SQLite snapshot");
    }

    const snapshotChecksum = checksum(snapshotBuffer);
    if (this.lastPersistedChecksum && this.lastPersistedChecksum === snapshotChecksum) {
      return false;
    }

    const upsert = await this.pool.query<{ updated_at: Date | string }>(
      `INSERT INTO runtime_snapshots (id, sqlite_blob, sqlite_size_bytes, checksum)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         sqlite_blob = EXCLUDED.sqlite_blob,
         sqlite_size_bytes = EXCLUDED.sqlite_size_bytes,
         checksum = EXCLUDED.checksum,
         updated_at = NOW()
       RETURNING updated_at`,
      [snapshotBuffer, snapshotBuffer.length, snapshotChecksum]
    );

    const updatedAt = new Date(upsert.rows[0]?.updated_at ?? new Date()).toISOString();
    this.lastPersistedChecksum = snapshotChecksum;
    this.lastPersistedAt = updatedAt;
    this.lastSnapshotSizeBytes = snapshotBuffer.length;
    this.lastError = null;

    return true;
  }

  startAutoSync(getSnapshot: () => Buffer, intervalMs = 30_000): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.flush(getSnapshot).catch(() => {
        // Error is captured in diagnostics via this.lastError.
      });
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (!this.intervalHandle) {
      return;
    }
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  async flush(getSnapshot: () => Buffer): Promise<void> {
    if (this.flushing) {
      return;
    }

    this.flushing = true;
    try {
      await this.persistSnapshot(getSnapshot());
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown PostgreSQL snapshot error";
      throw error;
    } finally {
      this.flushing = false;
    }
  }

  getDiagnostics(sqlitePath: string): PostgresPersistenceDiagnostics {
    return {
      backend: "postgres-snapshot",
      sqlitePath: resolve(sqlitePath),
      snapshotRestoredAt: this.lastRestoredAt,
      snapshotPersistedAt: this.lastPersistedAt,
      snapshotSizeBytes: this.lastSnapshotSizeBytes,
      lastError: this.lastError
    };
  }

  async close(): Promise<void> {
    this.stopAutoSync();
    await this.pool.end();
  }
}
