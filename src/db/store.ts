import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentModeId,
  BacklinkInfo,
  ChatMessageRecord,
  FileAction,
  MemoryRecord,
  NoteLinkRecord,
  NoteRecord,
  ProviderId,
  SessionFileRecord,
  SessionRecord,
  TaskRecord,
  TurnSnapshotRecord,
  SnapshotManifestItem,
  VaultSearchHit,
  EditorDraftRecord,
} from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Sanitizes free-form user search text into a safe FTS5 MATCH expression.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["'*^():\-+]/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

export class OroStore {
  private db: DatabaseSync;
  private closed = false;
  public readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'assistant',
        provider TEXT NOT NULL DEFAULT 'gemini',
        model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        tool_args TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS session_files (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        last_action TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        touch_count INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id, pinned DESC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        frontmatter_json TEXT NOT NULL DEFAULT '{}',
        mtime_ms REAL NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        word_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path,
        title,
        content,
        tokenize = 'porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS note_links (
        source_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        target_raw TEXT NOT NULL,
        target_resolved TEXT,
        alias TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_path);
      CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_resolved);

      CREATE TABLE IF NOT EXISTS note_tags (
        path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (path, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'fact',
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        importance INTEGER NOT NULL DEFAULT 3,
        source_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        memory_id UNINDEXED,
        category,
        content,
        tags,
        tokenize = 'porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        file_path TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done, created_at DESC);

      CREATE TABLE IF NOT EXISTS turn_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_index INTEGER NOT NULL DEFAULT 1,
        user_prompt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        manifest_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_turn_snapshots_session ON turn_snapshots(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS editor_drafts (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // ==================== SESSIONS ====================

  createSession(opts: {
    title?: string;
    mode: AgentModeId;
    provider: ProviderId;
    model: string;
  }): SessionRecord {
    const id = shortId();
    const now = nowIso();
    const title = opts.title?.trim() || "New Chat";
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, mode, provider, model, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(id, title, opts.mode, opts.provider, opts.model, now, now);

    return {
      id,
      title,
      mode: opts.mode,
      provider: opts.provider,
      model: opts.model,
      summary: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapSession(row) : null;
  }

  listSessions(limit = 30): SessionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapSession(r));
  }

  getLatestOrCreateSession(defaults: {
    mode: AgentModeId;
    provider: ProviderId;
    model: string;
  }): SessionRecord {
    const existing = this.listSessions(1)[0];
    if (existing) return existing;
    return this.createSession({ title: "Main Workspace", ...defaults });
  }

  updateSession(
    id: string,
    patch: Partial<{ title: string; mode: AgentModeId; provider: ProviderId; model: string; summary: string }>
  ): void {
    const current = this.getSession(id);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE sessions
         SET title = ?, mode = ?, provider = ?, model = ?, summary = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.title ?? current.title,
        patch.mode ?? current.mode,
        patch.provider ?? current.provider,
        patch.model ?? current.model,
        patch.summary !== undefined ? patch.summary : current.summary,
        nowIso(),
        id
      );
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  private mapSession(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row.id),
      title: String(row.title),
      mode: String(row.mode) as AgentModeId,
      provider: String(row.provider) as ProviderId,
      model: String(row.model),
      summary: row.summary ? String(row.summary) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // ==================== MESSAGES ====================

  addMessage(msg: {
    sessionId: string;
    role: ChatMessageRecord["role"];
    content: string;
    toolName?: string | null;
    toolCallId?: string | null;
    toolArgs?: string | null;
  }): ChatMessageRecord {
    const id = shortId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, tool_name, tool_call_id, tool_args, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolName ?? null,
        msg.toolCallId ?? null,
        msg.toolArgs ?? null,
        now
      );
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, msg.sessionId);
    return {
      id,
      sessionId: msg.sessionId,
      role: msg.role,
      content: msg.content,
      toolName: msg.toolName ?? null,
      toolCallId: msg.toolCallId ?? null,
      toolArgs: msg.toolArgs ?? null,
      createdAt: now,
    };
  }

  getMessages(sessionId: string, limit = 100): ChatMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
         ) ORDER BY created_at ASC`
      )
      .all(sessionId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      role: String(r.role) as ChatMessageRecord["role"],
      content: String(r.content),
      toolName: r.tool_name ? String(r.tool_name) : null,
      toolCallId: r.tool_call_id ? String(r.tool_call_id) : null,
      toolArgs: r.tool_args ? String(r.tool_args) : null,
      createdAt: String(r.created_at),
    }));
  }

  // ==================== SESSION FILES & PINS ====================

  trackSessionFile(sessionId: string, relPath: string, action: FileAction, pinned?: boolean): void {
    const cleanPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const now = nowIso();
    const existing = this.db
      .prepare(`SELECT * FROM session_files WHERE session_id = ? AND path = ?`)
      .get(sessionId, cleanPath) as Record<string, unknown> | undefined;

    if (existing) {
      const nextPinned = pinned !== undefined ? (pinned ? 1 : 0) : Number(existing.pinned);
      this.db
        .prepare(
          `UPDATE session_files
           SET last_action = ?, pinned = ?, touch_count = touch_count + 1, updated_at = ?
           WHERE session_id = ? AND path = ?`
        )
        .run(action, nextPinned, now, sessionId, cleanPath);
    } else {
      this.db
        .prepare(
          `INSERT INTO session_files (session_id, path, last_action, pinned, touch_count, updated_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        )
        .run(sessionId, cleanPath, action, pinned ? 1 : 0, now);
    }
    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);
  }

  setFilePinned(sessionId: string, relPath: string, pinned: boolean): void {
    const cleanPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const existing = this.db
      .prepare(`SELECT * FROM session_files WHERE session_id = ? AND path = ?`)
      .get(sessionId, cleanPath);
    if (existing) {
      this.db
        .prepare(`UPDATE session_files SET pinned = ?, updated_at = ? WHERE session_id = ? AND path = ?`)
        .run(pinned ? 1 : 0, nowIso(), sessionId, cleanPath);
    } else if (pinned) {
      this.trackSessionFile(sessionId, cleanPath, "pinned", true);
    }
  }

  renameSessionFile(sessionId: string, oldPath: string, newPath: string): void {
    const cleanOld = oldPath.replace(/\\/g, "/");
    const cleanNew = newPath.replace(/\\/g, "/");
    const existing = this.db
      .prepare(`SELECT * FROM session_files WHERE session_id = ? AND path = ?`)
      .get(sessionId, cleanOld) as Record<string, unknown> | undefined;
    if (existing) {
      this.db.prepare(`DELETE FROM session_files WHERE session_id = ? AND path = ?`).run(sessionId, cleanOld);
      this.trackSessionFile(sessionId, cleanNew, "moved", Boolean(existing.pinned));
    } else {
      this.trackSessionFile(sessionId, cleanNew, "moved", false);
    }
  }

  getSessionFiles(sessionId: string): SessionFileRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_files
         WHERE session_id = ?
         ORDER BY pinned DESC, updated_at DESC`
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: String(r.session_id),
      path: String(r.path),
      lastAction: String(r.last_action) as FileAction,
      pinned: Boolean(r.pinned),
      touchCount: Number(r.touch_count),
      updatedAt: String(r.updated_at),
    }));
  }

  // ==================== NOTES, FTS5, LINKS & TAGS ====================

  upsertNote(note: {
    path: string;
    title: string;
    content: string;
    frontmatterJson: string;
    mtimeMs: number;
    sizeBytes: number;
    wordCount: number;
    links: Array<{ raw: string; target: string; alias: string | null }>;
    tags: string[];
  }): void {
    const now = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO notes (path, title, content, frontmatter_json, mtime_ms, size_bytes, word_count, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             title = excluded.title,
             content = excluded.content,
             frontmatter_json = excluded.frontmatter_json,
             mtime_ms = excluded.mtime_ms,
             size_bytes = excluded.size_bytes,
             word_count = excluded.word_count,
             updated_at = excluded.updated_at`
        )
        .run(
          note.path,
          note.title,
          note.content,
          note.frontmatterJson,
          note.mtimeMs,
          note.sizeBytes,
          note.wordCount,
          now
        );

      this.db.prepare(`DELETE FROM notes_fts WHERE path = ?`).run(note.path);
      this.db
        .prepare(`INSERT INTO notes_fts (path, title, content) VALUES (?, ?, ?)`)
        .run(note.path, note.title, note.content);

      this.db.prepare(`DELETE FROM note_links WHERE source_path = ?`).run(note.path);
      const insertLink = this.db.prepare(
        `INSERT INTO note_links (source_path, target_raw, target_resolved, alias) VALUES (?, ?, NULL, ?)`
      );
      for (const link of note.links) {
        insertLink.run(note.path, link.target, link.alias);
      }

      this.db.prepare(`DELETE FROM note_tags WHERE path = ?`).run(note.path);
      const insertTag = this.db.prepare(`INSERT OR IGNORE INTO note_tags (path, tag) VALUES (?, ?)`);
      for (const tag of note.tags) {
        insertTag.run(note.path, tag);
      }

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  deleteNote(relPath: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM notes WHERE path = ?`).run(relPath);
      this.db.prepare(`DELETE FROM notes_fts WHERE path = ?`).run(relPath);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getAllNotesMeta(): Array<{ path: string; title: string; mtimeMs: number }> {
    const rows = this.db.prepare(`SELECT path, title, mtime_ms FROM notes`).all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      path: String(r.path),
      title: String(r.title),
      mtimeMs: Number(r.mtime_ms),
    }));
  }

  getNote(relPath: string): NoteRecord | null {
    const row = this.db.prepare(`SELECT * FROM notes WHERE path = ?`).get(relPath) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      path: String(row.path),
      title: String(row.title),
      content: String(row.content),
      frontmatterJson: String(row.frontmatter_json),
      mtimeMs: Number(row.mtime_ms),
      sizeBytes: Number(row.size_bytes),
      wordCount: Number(row.word_count),
      updatedAt: String(row.updated_at),
    };
  }

  /**
   * Resolves [[wiki-links]] across all indexed notes by matching exact path,
   * path without .md, basename without .md, or title (case-insensitive).
   */
  resolveAllLinks(): void {
    const notes = this.getAllNotesMeta();
    const byExact = new Map<string, string>();
    const byBase = new Map<string, string>();
    const byTitle = new Map<string, string>();

    for (const n of notes) {
      const lowerPath = n.path.toLowerCase();
      byExact.set(lowerPath, n.path);
      byExact.set(lowerPath.replace(/\.md$/i, ""), n.path);
      const base = path.posix.basename(n.path).replace(/\.md$/i, "").toLowerCase();
      if (!byBase.has(base)) byBase.set(base, n.path);
      const titleKey = n.title.trim().toLowerCase();
      if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, n.path);
    }

    const links = this.db
      .prepare(`SELECT rowid, target_raw FROM note_links`)
      .all() as Array<{ rowid: number; target_raw: string }>;

    const update = this.db.prepare(`UPDATE note_links SET target_resolved = ? WHERE rowid = ?`);
    this.db.exec("BEGIN");
    try {
      for (const link of links) {
        const key = link.target_raw.replace(/\\/g, "/").replace(/\.md$/i, "").trim().toLowerCase();
        const resolved = byExact.get(key) ?? byBase.get(key) ?? byTitle.get(key) ?? null;
        update.run(resolved, link.rowid);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Incrementally resolves links originating from or pointing to a single note.
   * Runs in < 1ms, eliminating full-table scans on every file save.
   */
  resolveLinksForNote(notePath: string): void {
    const notes = this.getAllNotesMeta();
    const byExact = new Map<string, string>();
    const byBase = new Map<string, string>();
    const byTitle = new Map<string, string>();

    for (const n of notes) {
      const lowerPath = n.path.toLowerCase();
      byExact.set(lowerPath, n.path);
      byExact.set(lowerPath.replace(/\.md$/i, ""), n.path);
      const base = path.posix.basename(n.path).replace(/\.md$/i, "").toLowerCase();
      if (!byBase.has(base)) byBase.set(base, n.path);
      const titleKey = n.title.trim().toLowerCase();
      if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, n.path);
    }

    const baseName = path.posix.basename(notePath).replace(/\.md$/i, "").toLowerCase();
    const links = this.db
      .prepare(
        `SELECT rowid, target_raw FROM note_links 
         WHERE source_path = ? OR LOWER(target_raw) LIKE ? OR LOWER(target_raw) LIKE ?`
      )
      .all(notePath, `%${baseName}%`, `%${notePath.toLowerCase()}%`) as Array<{ rowid: number; target_raw: string }>;

    const update = this.db.prepare(`UPDATE note_links SET target_resolved = ? WHERE rowid = ?`);
    this.db.exec("BEGIN");
    try {
      for (const link of links) {
        const key = link.target_raw.replace(/\\/g, "/").replace(/\.md$/i, "").trim().toLowerCase();
        const resolved = byExact.get(key) ?? byBase.get(key) ?? byTitle.get(key) ?? null;
        update.run(resolved, link.rowid);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * Computes PageRank over resolved note links (10 iterations, d=0.85).
   * Returns a map of note path -> normalized centrality score (0.0 to 1.0).
   */
  computePageRank(): Map<string, number> {
    const notes = this.getAllNotesMeta();
    const N = notes.length;
    const scores = new Map<string, number>();
    if (N === 0) return scores;

    const links = this.getAllLinks().filter((l) => l.targetResolved);
    const outMap = new Map<string, string[]>();
    const inMap = new Map<string, string[]>();

    for (const n of notes) {
      outMap.set(n.path, []);
      inMap.set(n.path, []);
      scores.set(n.path, 1.0 / N);
    }

    for (const l of links) {
      const src = l.sourcePath;
      const dst = l.targetResolved!;
      if (outMap.has(src) && inMap.has(dst)) {
        outMap.get(src)!.push(dst);
        inMap.get(dst)!.push(src);
      }
    }

    const d = 0.85;
    for (let iter = 0; iter < 10; iter++) {
      let danglingSum = 0;
      for (const n of notes) {
        if (outMap.get(n.path)!.length === 0) {
          danglingSum += scores.get(n.path)!;
        }
      }

      const next = new Map<string, number>();
      for (const n of notes) {
        let sum = 0;
        const incoming = inMap.get(n.path)!;
        for (const inc of incoming) {
          const outCount = outMap.get(inc)!.length;
          if (outCount > 0) {
            sum += scores.get(inc)! / outCount;
          }
        }
        const pr = (1 - d) / N + d * (sum + danglingSum / N);
        next.set(n.path, pr);
      }
      for (const [p, val] of next) {
        scores.set(p, val);
      }
    }

    let maxPr = 0;
    for (const val of scores.values()) {
      if (val > maxPr) maxPr = val;
    }
    if (maxPr > 0) {
      for (const [p, val] of scores) {
        scores.set(p, val / maxPr);
      }
    }
    return scores;
  }

  getAllLinks(): NoteLinkRecord[] {
    const rows = this.db
      .prepare(`SELECT source_path, target_raw, target_resolved, alias FROM note_links`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      sourcePath: String(r.source_path),
      targetRaw: String(r.target_raw),
      targetResolved: r.target_resolved ? String(r.target_resolved) : null,
      alias: r.alias ? String(r.alias) : null,
    }));
  }

  getOutgoingLinks(relPath: string): NoteLinkRecord[] {
    const rows = this.db
      .prepare(`SELECT source_path, target_raw, target_resolved, alias FROM note_links WHERE source_path = ?`)
      .all(relPath) as Record<string, unknown>[];
    return rows.map((r) => ({
      sourcePath: String(r.source_path),
      targetRaw: String(r.target_raw),
      targetResolved: r.target_resolved ? String(r.target_resolved) : null,
      alias: r.alias ? String(r.alias) : null,
    }));
  }

  getBacklinks(relPath: string): BacklinkInfo[] {
    const rows = this.db
      .prepare(
        `SELECT l.source_path, n.title AS source_title, l.alias
         FROM note_links l
         JOIN notes n ON n.path = l.source_path
         WHERE l.target_resolved = ?
         ORDER BY l.source_path ASC`
      )
      .all(relPath) as Record<string, unknown>[];
    return rows.map((r) => ({
      sourcePath: String(r.source_path),
      sourceTitle: String(r.source_title),
      alias: r.alias ? String(r.alias) : null,
    }));
  }

  getTagsForNote(relPath: string): string[] {
    const rows = this.db
      .prepare(`SELECT tag FROM note_tags WHERE path = ? ORDER BY tag ASC`)
      .all(relPath) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  listAllTags(): Array<{ tag: string; count: number }> {
    const rows = this.db
      .prepare(`SELECT tag, COUNT(*) AS cnt FROM note_tags GROUP BY tag ORDER BY cnt DESC, tag ASC`)
      .all() as Array<{ tag: string; cnt: number }>;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.cnt) }));
  }

  searchNotes(query: string, limit = 15): VaultSearchHit[] {
    const fts = buildFtsQuery(query);
    if (!fts) return [];
    const rows = this.db
      .prepare(
        `SELECT
           path,
           title,
           snippet(notes_fts, 2, '[', ']', '...', 18) AS snippet,
           bm25(notes_fts, 1.5, 4.0, 1.0) AS rank
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(fts, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      path: String(r.path),
      title: String(r.title),
      snippet: String(r.snippet ?? "").replace(/\s+/g, " ").trim(),
      rank: Number(r.rank),
    }));
  }

  getVaultStats(): { notes: number; links: number; brokenLinks: number; tags: number; memories: number; openTasks: number } {
    const notes = Number((this.db.prepare(`SELECT COUNT(*) AS c FROM notes`).get() as { c: number }).c);
    const links = Number((this.db.prepare(`SELECT COUNT(*) AS c FROM note_links`).get() as { c: number }).c);
    const brokenLinks = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM note_links WHERE target_resolved IS NULL`).get() as { c: number }).c
    );
    const tags = Number((this.db.prepare(`SELECT COUNT(DISTINCT tag) AS c FROM note_tags`).get() as { c: number }).c);
    const memories = Number((this.db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }).c);
    const openTasks = Number(
      (this.db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE done = 0`).get() as { c: number }).c
    );
    return { notes, links, brokenLinks, tags, memories, openTasks };
  }

  // ==================== MEMORIES ====================

  saveMemory(opts: {
    category?: MemoryRecord["category"];
    content: string;
    tags?: string[];
    importance?: number;
    sourceSessionId?: string | null;
  }): MemoryRecord {
    const now = nowIso();
    const category = opts.category ?? "fact";
    const tags = (opts.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const importance = Math.min(5, Math.max(1, opts.importance ?? 3));

    const res = this.db
      .prepare(
        `INSERT INTO memories (category, content, tags_json, importance, source_session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(category, opts.content.trim(), JSON.stringify(tags), importance, opts.sourceSessionId ?? null, now, now);

    const id = Number(res.lastInsertRowid);
    this.db
      .prepare(`INSERT INTO memories_fts (memory_id, category, content, tags) VALUES (?, ?, ?, ?)`)
      .run(id, category, opts.content.trim(), tags.join(" "));

    return {
      id,
      category,
      content: opts.content.trim(),
      tags,
      importance,
      sourceSessionId: opts.sourceSessionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  listMemories(limit = 25): MemoryRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories ORDER BY importance DESC, updated_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapMemory(r));
  }

  searchMemories(query: string, limit = 10): MemoryRecord[] {
    const fts = buildFtsQuery(query);
    if (!fts) return this.listMemories(limit);
    const rows = this.db
      .prepare(
        `SELECT m.*
         FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ?
         ORDER BY bm25(memories_fts)
         LIMIT ?`
      )
      .all(fts, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapMemory(r));
  }

  deleteMemory(id: number): void {
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM memories_fts WHERE memory_id = ?`).run(id);
  }

  private mapMemory(r: Record<string, unknown>): MemoryRecord {
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(r.tags_json || "[]")) as string[];
    } catch {
      tags = [];
    }
    return {
      id: Number(r.id),
      category: String(r.category) as MemoryRecord["category"],
      content: String(r.content),
      tags,
      importance: Number(r.importance),
      sourceSessionId: r.source_session_id ? String(r.source_session_id) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  // ==================== TASKS ====================

  addTask(opts: { title: string; filePath?: string | null; sessionId?: string | null }): TaskRecord {
    const now = nowIso();
    const res = this.db
      .prepare(
        `INSERT INTO tasks (title, done, file_path, session_id, created_at, updated_at)
         VALUES (?, 0, ?, ?, ?, ?)`
      )
      .run(opts.title.trim(), opts.filePath ?? null, opts.sessionId ?? null, now, now);

    return {
      id: Number(res.lastInsertRowid),
      title: opts.title.trim(),
      done: false,
      filePath: opts.filePath ?? null,
      sessionId: opts.sessionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  listTasks(includeDone = true, limit = 50): TaskRecord[] {
    const sql = includeDone
      ? `SELECT * FROM tasks ORDER BY done ASC, updated_at DESC LIMIT ?`
      : `SELECT * FROM tasks WHERE done = 0 ORDER BY updated_at DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      done: Boolean(r.done),
      filePath: r.file_path ? String(r.file_path) : null,
      sessionId: r.session_id ? String(r.session_id) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  toggleTask(id: number, done?: boolean): TaskRecord | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const nextDone = done !== undefined ? done : !Boolean(row.done);
    const now = nowIso();
    this.db.prepare(`UPDATE tasks SET done = ?, updated_at = ? WHERE id = ?`).run(nextDone ? 1 : 0, now, id);
    return {
      id: Number(row.id),
      title: String(row.title),
      done: nextDone,
      filePath: row.file_path ? String(row.file_path) : null,
      sessionId: row.session_id ? String(row.session_id) : null,
      createdAt: String(row.created_at),
      updatedAt: now,
    };
  }

  // ==================== TURN SNAPSHOTS ====================

  saveTurnSnapshot(rec: TurnSnapshotRecord): void {
    this.db
      .prepare(
        `INSERT INTO turn_snapshots (id, session_id, turn_index, user_prompt, created_at, status, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rec.id,
        rec.sessionId,
        rec.turnIndex,
        rec.userPrompt,
        rec.createdAt,
        rec.status,
        JSON.stringify(rec.manifest)
      );
  }

  getTurnSnapshot(id: string): TurnSnapshotRecord | null {
    const row = this.db.prepare(`SELECT * FROM turn_snapshots WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.mapTurnSnapshot(row);
  }

  listTurnSnapshots(sessionId: string, limit = 20): TurnSnapshotRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM turn_snapshots WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(sessionId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapTurnSnapshot(r));
  }

  updateTurnSnapshotStatus(id: string, status: "active" | "reverted"): void {
    this.db.prepare(`UPDATE turn_snapshots SET status = ? WHERE id = ?`).run(status, id);
  }

  pruneTurnSnapshots(sessionId: string, maxKeep = 15): string[] {
    const all = this.db
      .prepare(`SELECT id FROM turn_snapshots WHERE session_id = ? ORDER BY created_at DESC`)
      .all(sessionId) as { id: string }[];
    if (all.length <= maxKeep) return [];

    const toPrune = all.slice(maxKeep).map((r) => r.id);
    const placeholders = toPrune.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM turn_snapshots WHERE id IN (${placeholders})`).run(...toPrune);
    return toPrune;
  }

  private mapTurnSnapshot(row: Record<string, unknown>): TurnSnapshotRecord {
    let manifest: SnapshotManifestItem[] = [];
    try {
      manifest = JSON.parse(String(row.manifest_json || "[]"));
    } catch {}
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      turnIndex: Number(row.turn_index),
      userPrompt: String(row.user_prompt),
      createdAt: String(row.created_at),
      status: (String(row.status) as "active" | "reverted") || "active",
      manifest,
    };
  }

  // ==================== EDITOR DRAFTS (CRASH RECOVERY) ====================

  saveEditorDraft(filePath: string, content: string): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO editor_drafts (path, content, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
      .run(filePath, content, now);
  }

  getEditorDraft(filePath: string): EditorDraftRecord | null {
    const row = this.db
      .prepare(`SELECT path, content, updated_at as updatedAt FROM editor_drafts WHERE path = ?`)
      .get(filePath) as unknown as EditorDraftRecord | undefined;
    return row || null;
  }

  listEditorDrafts(): EditorDraftRecord[] {
    return this.db
      .prepare(`SELECT path, content, updated_at as updatedAt FROM editor_drafts ORDER BY updated_at DESC`)
      .all() as unknown as EditorDraftRecord[];
  }

  deleteEditorDraft(filePath: string): void {
    this.db.prepare(`DELETE FROM editor_drafts WHERE path = ?`).run(filePath);
  }

  clearAllEditorDrafts(): void {
    this.db.exec(`DELETE FROM editor_drafts`);
  }
}
