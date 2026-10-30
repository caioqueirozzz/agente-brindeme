import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/*
 * Acesso ao Postgres. Em produção, DATABASE_URL é a string do Neon
 * (postgres://...neon.tech/...?sslmode=require) e usamos o driver `pg`.
 * Em desenvolvimento sem Neon, DATABASE_URL=pglite:./.pglite sobe um
 * Postgres embutido (arquivo local, um processo por vez).
 */

export type Row = Record<string, unknown>;

interface Executor {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

interface Driver extends Executor {
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
}

const globalDb = globalThis as unknown as { __crmDriver?: Promise<Driver> };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada (string do Neon ou pglite:./.pglite).");
  return url;
}

async function pgliteDriver(path: string): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db: PGlite = await PGlite.create(path, {
    parsers: { 1700: (v: string) => Number(v), 20: (v: string) => Number(v) },
  });
  await runMigrations({ query: async (t, p) => (await db.query(t, p)).rows as never, exec: (t) => db.exec(t) });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params)).rows;
    },
    transaction(fn) {
      return db.transaction((tx) => fn({ query: async <T,>(t: string, p: unknown[] = []) => (await tx.query<T>(t, p)).rows }));
    },
  };
}

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import("pg");
  // NUMERIC e BIGINT viram number (valores de venda cabem com folga)
  pg.types.setTypeParser(1700, (v) => Number(v));
  pg.types.setTypeParser(20, (v) => Number(v));
  const pool: Pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async <T,>(t: string, p: unknown[] = []) => (await client.query(t, p)).rows as T[] });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

function driver(): Promise<Driver> {
  globalDb.__crmDriver ??= (() => {
    const url = databaseUrl();
    return url.startsWith("pglite:") ? pgliteDriver(url.slice("pglite:".length) || "./.pglite") : pgDriver(url);
  })();
  return globalDb.__crmDriver;
}

export async function query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await driver()).query<T>(text, params);
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

export async function transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  return (await driver()).transaction(fn);
}

export type { Executor };

/* ------------------------------------------------------------------ */
/*  Migrations                                                         */
/* ------------------------------------------------------------------ */

interface MigrationTarget {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** Executa um arquivo com vários comandos */
  exec(text: string): Promise<unknown>;
}

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

/** Aplica, em ordem, os arquivos de db/migrations ainda não aplicados. Devolve os nomes aplicados. */
export async function runMigrations(target: MigrationTarget): Promise<string[]> {
  await target.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  const done = new Set((await target.query("SELECT name FROM schema_migrations")).map((r) => r.name as string));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    await target.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    await target.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    applied.push(file);
  }
  return applied;
}
