/**
 * Aplica as migrations de db/migrations no banco de DATABASE_URL.
 *   npm run db:migrate
 * Com pglite: as migrations já rodam sozinhas ao abrir o banco.
 */
import pg from "pg";
import { runMigrations } from "../src/lib/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL no .env (string de conexão do Neon).");
  process.exit(1);
}

if (url.startsWith("pglite:")) {
  const { query } = await import("../src/lib/db");
  await query("SELECT 1");
  console.log("PGlite: migrations aplicadas ao abrir o banco.");
} else {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await runMigrations({
      query: async (text, params) => (await client.query(text, params)).rows,
      exec: (text) => client.query(text),
    });
    console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Banco já está atualizado.");
  } finally {
    await client.end();
  }
}
process.exit(0);
