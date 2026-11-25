import fs from "node:fs";
import path from "node:path";
import type { OroStore } from "../db/store.js";
import { parseMarkdown } from "./parser.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".oro",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

const INDEXABLE_EXTS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export function toPosixRel(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).replace(/\\/g, "/");
}

export function isIgnoredPath(relPosix: string): boolean {
  const parts = relPosix.split("/").filter(Boolean);
  return parts.some((p) => IGNORED_DIRS.has(p));
}

export function isIndexableFile(relPosix: string): boolean {
  const ext = path.posix.extname(relPosix).toLowerCase();
  return INDEXABLE_EXTS.has(ext);
}

export class VaultIndexer {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();
  private onChangeCallback?: () => void;

  constructor(
    public readonly workspaceRoot: string,
    private readonly store: OroStore
  ) {}

  /**
   * Incrementally scans workspaceRoot, indexing new/modified Markdown & text files,
   * removing deleted ones, and resolving [[wiki-links]].
   */
  indexAll(force = false): { indexed: number; removed: number; total: number; durationMs: number } {
    const start = Date.now();
    const existing = new Map(this.store.getAllNotesMeta().map((n) => [n.path, n.mtimeMs]));
    const found = new Set<string>();
    let indexed = 0;

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          const rel = toPosixRel(this.workspaceRoot, abs);
          if (!isIndexableFile(rel)) continue;
          found.add(rel);
          try {
            const stat = fs.statSync(abs);
            if (stat.size > 2 * 1024 * 1024) continue; // skip >2MB files
            const prevMtime = existing.get(rel);
            if (force || prevMtime === undefined || Math.abs(prevMtime - stat.mtimeMs) > 1) {
              this.indexSingleFile(rel, abs, stat);
              indexed++;
            }
          } catch {
            // file may have disappeared mid-scan
          }
        }
      }
    };

    walk(this.workspaceRoot);

    let removed = 0;
    for (const oldPath of existing.keys()) {
      if (!found.has(oldPath)) {
        this.store.deleteNote(oldPath);
        removed++;
      }
    }

    if (indexed > 0 || removed > 0 || force) {
      this.store.resolveAllLinks();
    }

    return {
      indexed,
      removed,
      total: found.size,
      durationMs: Date.now() - start,
    };
  }

  indexFile(relPosix: string): boolean {
    const clean = relPosix.replace(/\\/g, "/").replace(/^\.\//, "");
    if (isIgnoredPath(clean) || !isIndexableFile(clean)) return false;
    const abs = path.resolve(this.workspaceRoot, clean);
    if (!fs.existsSync(abs)) {
      this.store.deleteNote(clean);
      this.store.resolveLinksForNote(clean);
      return false;
    }
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return false;
    this.indexSingleFile(clean, abs, stat);
    this.store.resolveLinksForNote(clean);
    return true;
  }

  removeFile(relPosix: string): void {
    const clean = relPosix.replace(/\\/g, "/").replace(/^\.\//, "");
    this.store.deleteNote(clean);
    this.store.resolveLinksForNote(clean);
  }

  private indexSingleFile(rel: string, abs: string, stat: fs.Stats): void {
    const content = fs.readFileSync(abs, "utf8");
    const parsed = parseMarkdown(rel, content);
    this.store.upsertNote({
      path: rel,
      title: parsed.title,
      content,
      frontmatterJson: JSON.stringify(parsed.frontmatter),
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      wordCount: parsed.wordCount,
      links: parsed.links,
      tags: parsed.tags,
    });
  }

  startWatching(onChange?: () => void): void {
    this.onChangeCallback = onChange;
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.workspaceRoot, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = filename.toString().replace(/\\/g, "/");
        if (isIgnoredPath(rel)) return;
        this.pendingPaths.add(rel);
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.flushPending();
        }, 250);
      });
      this.watcher.on("error", () => {
        // Ignore transient watch errors on Windows
      });
    } catch {
      // Fallback: manual / tool-triggered indexing still works
    }
  }

  private flushPending(): void {
    const paths = Array.from(this.pendingPaths);
    this.pendingPaths.clear();
    let changed = false;
    for (const rel of paths) {
      if (isIndexableFile(rel)) {
        const abs = path.resolve(this.workspaceRoot, rel);
        try {
          if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            const stat = fs.statSync(abs);
            if (stat.size <= 2 * 1024 * 1024) {
              this.indexSingleFile(rel, abs, stat);
              changed = true;
            }
          } else {
            this.store.deleteNote(rel);
            changed = true;
          }
        } catch {
          // ignore transient lock
        }
      } else {
        changed = true; // non-md tree change
      }
    }
    if (changed) {
      this.store.resolveAllLinks();
      this.onChangeCallback?.();
    }
  }

  stopWatching(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
