import { DurableObject } from "cloudflare:workers";

export type TurnStatus = "in_progress" | "completed" | "failed";

export interface TurnRecord {
  responseId: string;
  requestFingerprint: string;
  status: TurnStatus;
  createdAt: number;
  completedAt: number | null;
}

export type TurnResult =
  | { ok: true; turn: TurnRecord }
  | { ok: false; code: ConversationStateError["code"] };

export class ConversationStateError extends Error {
  constructor(readonly code: "turn_exists" | "turn_not_found" | "invalid_transition") {
    super(code);
    this.name = "ConversationStateError";
  }
}

export class Conversation extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS turns (
          response_id TEXT PRIMARY KEY,
          request_fingerprint TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_turns_status ON turns(status);
      `);
    });
  }

  beginTurn(responseId: string, requestFingerprint: string, now = Date.now()): TurnRecord {
    const existing = this.getTurn(responseId);
    if (existing) throw new ConversationStateError("turn_exists");
    this.ctx.storage.sql.exec(
      "INSERT INTO turns (response_id, request_fingerprint, status, created_at) VALUES (?, ?, 'in_progress', ?)",
      responseId,
      requestFingerprint,
      now,
    );
    return this.getTurn(responseId)!;
  }

  tryBeginTurn(responseId: string, requestFingerprint: string, now = Date.now()): TurnResult {
    try {
      return { ok: true, turn: this.beginTurn(responseId, requestFingerprint, now) };
    } catch (error) {
      if (error instanceof ConversationStateError) return { ok: false, code: error.code };
      throw error;
    }
  }

  completeTurn(responseId: string, now = Date.now()): TurnRecord {
    const existing = this.getTurn(responseId);
    if (!existing) throw new ConversationStateError("turn_not_found");
    if (existing.status !== "in_progress") throw new ConversationStateError("invalid_transition");
    this.ctx.storage.sql.exec(
      "UPDATE turns SET status = 'completed', completed_at = ? WHERE response_id = ?",
      now,
      responseId,
    );
    return this.getTurn(responseId)!;
  }

  tryCompleteTurn(responseId: string, now = Date.now()): TurnResult {
    try {
      return { ok: true, turn: this.completeTurn(responseId, now) };
    } catch (error) {
      if (error instanceof ConversationStateError) return { ok: false, code: error.code };
      throw error;
    }
  }

  failTurn(responseId: string, now = Date.now()): TurnRecord {
    const existing = this.getTurn(responseId);
    if (!existing) throw new ConversationStateError("turn_not_found");
    if (existing.status !== "in_progress") throw new ConversationStateError("invalid_transition");
    this.ctx.storage.sql.exec(
      "UPDATE turns SET status = 'failed', completed_at = ? WHERE response_id = ?",
      now,
      responseId,
    );
    return this.getTurn(responseId)!;
  }

  tryFailTurn(responseId: string, now = Date.now()): TurnResult {
    try {
      return { ok: true, turn: this.failTurn(responseId, now) };
    } catch (error) {
      if (error instanceof ConversationStateError) return { ok: false, code: error.code };
      throw error;
    }
  }

  getTurn(responseId: string): TurnRecord | null {
    const rows = this.ctx.storage.sql
      .exec<{
        response_id: string;
        request_fingerprint: string;
        status: TurnStatus;
        created_at: number;
        completed_at: number | null;
      }>(
        "SELECT response_id, request_fingerprint, status, created_at, completed_at FROM turns WHERE response_id = ?",
        responseId,
      )
      .toArray();
    const row = rows[0];
    if (!row) return null;
    return {
      responseId: row.response_id,
      requestFingerprint: row.request_fingerprint,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}
