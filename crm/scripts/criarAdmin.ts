/**
 * Cria (ou reativa) um administrador. Use no primeiro deploy:
 *   npm run admin:criar -- --nome "Fulana" --email fulana@empresa.com.br
 * Gera uma senha provisória; a troca é obrigatória no primeiro acesso.
 */
import { one, query } from "../src/lib/db";
import { hashPassword, temporaryPassword } from "../src/lib/auth/session";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg("nome");
const email = arg("email")?.trim().toLowerCase();
if (!name || !email) {
  console.error('Uso: npm run admin:criar -- --nome "Nome" --email email@empresa.com.br');
  process.exit(1);
}

const password = temporaryPassword();
const hash = await hashPassword(password);
const existing = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = $1", [email]);
if (existing) {
  await query(
    "UPDATE users SET role = 'ADMIN', is_active = true, password_hash = $2, must_change_password = true, session_version = session_version + 1 WHERE id = $1",
    [existing.id, hash]
  );
} else {
  await query("INSERT INTO users (name, email, password_hash, role, receives_leads) VALUES ($1, $2, $3, 'ADMIN', false)", [name, email, hash]);
}
console.log(`\nAdmin ${existing ? "atualizado" : "criado"}: ${email}\nSenha provisória: ${password}\n(troca obrigatória no primeiro acesso)\n`);
process.exit(0);
