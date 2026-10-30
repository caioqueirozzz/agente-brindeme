import { one, query, transaction } from "@/lib/db";

/*
 * Conversas do PresentesIA. Toda leitura filtra por user_id: cada pessoa só
 * vê as próprias conversas — inclusive o admin, que não lê as dos colaboradores.
 */

export interface IaConversation {
  id: string;
  title: string;
  last_message: string;
  created_at: string;
  updated_at: string;
}

export interface IaStoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

function shorten(text: string, max: number) {
  const line = text.trim().split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function listConversations(userId: string) {
  return query<IaConversation>(
    "SELECT id, title, last_message, created_at, updated_at FROM ia_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200",
    [userId]
  );
}

export function getConversation(id: string, userId: string) {
  return one<IaConversation>(
    "SELECT id, title, last_message, created_at, updated_at FROM ia_conversations WHERE id = $1 AND user_id = $2",
    [id, userId]
  );
}

export function getMessages(conversationId: string, userId: string) {
  return query<IaStoredMessage>(
    `SELECT m.id, m.role, m.content, m.created_at FROM ia_messages m
     JOIN ia_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1 AND c.user_id = $2 ORDER BY m.created_at ASC`,
    [conversationId, userId]
  );
}

export async function createConversation(userId: string, firstMessage: string): Promise<IaConversation> {
  return transaction(async (tx) => {
    const [c] = await tx.query<IaConversation>(
      "INSERT INTO ia_conversations (user_id, title, last_message) VALUES ($1, $2, $3) RETURNING id, title, last_message, created_at, updated_at",
      [userId, shorten(firstMessage, 120), shorten(firstMessage, 200)]
    );
    await tx.query("INSERT INTO ia_messages (conversation_id, role, content) VALUES ($1, 'user', $2)", [c.id, firstMessage]);
    return c;
  });
}

export async function appendMessage(conversationId: string, role: "user" | "assistant", content: string) {
  return transaction(async (tx) => {
    const [m] = await tx.query<IaStoredMessage>(
      "INSERT INTO ia_messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at",
      [conversationId, role, content]
    );
    await tx.query("UPDATE ia_conversations SET last_message = $2, updated_at = NOW() WHERE id = $1", [conversationId, shorten(content, 200)]);
    return m;
  });
}

export function deleteConversation(id: string, userId: string) {
  return query("DELETE FROM ia_conversations WHERE id = $1 AND user_id = $2", [id, userId]);
}
