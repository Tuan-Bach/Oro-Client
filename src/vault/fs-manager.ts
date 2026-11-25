import fs from "node:fs";
import path from "node:path";
import type { OroStore } from "../db/store.js";
import type { TreeNode } from "../types.js";
import { getWorkspaceOroDir } from "../config/config.js";
import { isIndexableFile, type VaultIndexer } from "./indexer.js";

const TREE_IGNORE = new Set([
  ".git",
  ".oro",
  "node_modules",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
]);

export class VaultFsManager {
  public onBeforeMutation?: (
    relPath: string,
    action: "created" | "modified" | "moved" | "deleted",
    originalPath?: string
  ) => void;

  constructor(
    public readonly workspaceRoot: string,
    private readonly store: OroStore,
    private readonly indexer: VaultIndexer
  ) {}

  /**
   * Resolves a user/agent path safely inside workspaceRoot.
   */
  resolveSafe(inputPath: string): { abs: string; rel: string } {
    const cleaned = inputPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const abs = path.resolve(this.workspaceRoot, cleaned || ".");
    const rootWithSep = this.workspaceRoot.endsWith(path.sep)
      ? this.workspaceRoot
      : this.workspaceRoot + path.sep;

    if (abs !== this.workspaceRoot && !abs.startsWith(rootWithSep)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
    const rel = path.relative(this.workspaceRoot, abs).replace(/\\/g, "/");
    return { abs, rel };
  }

  /**
   * Returns a nested directory tree for the sidebar and agent inspection.
   */
  buildTree(subPath = "", maxDepth = 4): TreeNode[] {
    const { abs: startAbs } = this.resolveSafe(subPath);
    if (!fs.existsSync(startAbs)) return [];

    const walk = (dirAbs: string, depth: number): TreeNode[] => {
      if (depth > maxDepth) return [];
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return [];
      }

      const dirs: TreeNode[] = [];
      const files: TreeNode[] = [];

      for (const entry of entries) {
        if (TREE_IGNORE.has(entry.name)) continue;
        const abs = path.join(dirAbs, entry.name);
        const rel = path.relative(this.workspaceRoot, abs).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          dirs.push({
            name: entry.name,
            path: rel,
            isDir: true,
            depth,
            children: walk(abs, depth + 1),
          });
        } else if (entry.isFile()) {
          let sizeBytes = 0;
          try {
            sizeBytes = fs.statSync(abs).size;
          } catch {
            // ignore
          }
          files.push({
            name: entry.name,
            path: rel,
            isDir: false,
            depth,
            sizeBytes,
          });
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      return [...dirs, ...files];
    };

    return walk(startAbs, 0);
  }

  readFile(
    inputPath: string,
    sessionId?: string,
    opts?: { startLine?: number; endLine?: number; track?: boolean }
  ): { path: string; content: string; totalLines: number } {
    const { abs, rel } = this.resolveSafe(inputPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`File not found: ${rel}`);
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${rel}`);
    }
    if (stat.size > 1024 * 1024) {
      throw new Error(`File too large (${Math.round(stat.size / 1024)} KB): ${rel}`);
    }

    const raw = fs.readFileSync(abs, "utf8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    const start = Math.max(1, opts?.startLine ?? 1);
    const end = Math.min(lines.length, opts?.endLine ?? lines.length);
    const sliced = lines.slice(start - 1, end).join("\n");

    if (sessionId && opts?.track !== false) {
      this.store.trackSessionFile(sessionId, rel, "read");
    }

    return { path: rel, content: sliced, totalLines: lines.length };
  }

  writeFile(
    inputPath: string,
    content: string,
    sessionId?: string,
    encoding: "utf8" | "base64" = "utf8"
  ): { path: string; action: "created" | "modified"; bytes: number } {
    const { abs, rel } = this.resolveSafe(inputPath);
    if (!rel) throw new Error("Cannot write to workspace root directly");

    const existed = fs.existsSync(abs);
    this.onBeforeMutation?.(rel, existed ? "modified" : "created");

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (encoding === "base64") {
      fs.writeFileSync(abs, Buffer.from(content, "base64"));
    } else {
      fs.writeFileSync(abs, content, "utf8");
    }

    const action = existed ? "modified" : "created";
    if (sessionId) {
      this.store.trackSessionFile(sessionId, rel, action);
    }
    if (isIndexableFile(rel)) {
      this.indexer.indexFile(rel);
    }

    const bytes = encoding === "base64" ? Buffer.from(content, "base64").length : Buffer.byteLength(content, "utf8");
    return { path: rel, action, bytes };
  }

  editFile(
    inputPath: string,
    target: string,
    replacement: string,
    sessionId?: string
  ): { path: string; replacements: number } {
    const { abs, rel } = this.resolveSafe(inputPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`File not found: ${rel}`);
    }
    this.onBeforeMutation?.(rel, "modified");

    const current = fs.readFileSync(abs, "utf8");
    const isCrLf = current.includes("\r\n");
    const normCurrent = current.replace(/\r\n/g, "\n");
    const normTarget = target.replace(/\r\n/g, "\n");

    if (!normCurrent.includes(normTarget)) {
      throw new Error(`Target snippet not found in ${rel}`);
    }
    const parts = normCurrent.split(normTarget);
    const replacements = parts.length - 1;
    const normReplacement = replacement.replace(/\r\n/g, "\n");
    const next = parts.join(normReplacement);
    const finalContent = isCrLf ? next.replace(/\n/g, "\r\n") : next;
    fs.writeFileSync(abs, finalContent, "utf8");

    if (sessionId) {
      this.store.trackSessionFile(sessionId, rel, "modified");
    }
    if (isIndexableFile(rel)) {
      this.indexer.indexFile(rel);
    }

    return { path: rel, replacements };
  }

  createFolder(inputPath: string, sessionId?: string): { path: string; created: boolean } {
    const { abs, rel } = this.resolveSafe(inputPath);
    if (!rel) throw new Error("Folder path cannot be empty");
    const existed = fs.existsSync(abs);
    fs.mkdirSync(abs, { recursive: true });
    if (sessionId) {
      this.store.trackSessionFile(sessionId, rel + "/", "created");
    }
    return { path: rel, created: !existed };
  }

  /**
   * Moves or renames a file/folder. If moving a Markdown note, automatically updates
   * incoming [[wiki-links]] across the vault so your Second Brain stays connected!
   */
  movePath(
    fromInput: string,
    toInput: string,
    sessionId?: string
  ): { from: string; to: string; updatedLinksIn: string[] } {
    const { abs: fromAbs, rel: fromRel } = this.resolveSafe(fromInput);
    const { abs: toAbs, rel: toRel } = this.resolveSafe(toInput);

    if (!fs.existsSync(fromAbs)) {
      throw new Error(`Source not found: ${fromRel}`);
    }
    if (fs.existsSync(toAbs)) {
      throw new Error(`Destination already exists: ${toRel}`);
    }

    this.onBeforeMutation?.(toRel, "moved", fromRel);

    const isDir = fs.statSync(fromAbs).isDirectory();
    const backlinks = !isDir && isIndexableFile(fromRel) ? this.store.getBacklinks(fromRel) : [];

    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.renameSync(fromAbs, toAbs);

    const updatedLinksIn: string[] = [];

    // Update [[wiki-links]] in notes that referenced the renamed Markdown file
    if (!isDir && isIndexableFile(fromRel) && isIndexableFile(toRel) && backlinks.length > 0) {
      const oldBase = path.posix.basename(fromRel, path.posix.extname(fromRel));
      const oldNoExt = fromRel.replace(/\.md$/i, "");
      const newNoExt = toRel.replace(/\.md$/i, "");
      const newBase = path.posix.basename(toRel, path.posix.extname(toRel));
      const newTarget = path.posix.dirname(fromRel) === path.posix.dirname(toRel) ? newBase : newNoExt;

      for (const bl of backlinks) {
        if (bl.sourcePath === fromRel) continue;
        const { abs: srcAbs } = this.resolveSafe(bl.sourcePath);
        if (!fs.existsSync(srcAbs)) continue;
        const text = fs.readFileSync(srcAbs, "utf8");
        const updated = text.replace(/\[\[([^\[\]]+)\]\]/g, (full, inner: string) => {
          const [targetAndHeading, alias] = inner.split("|");
          const [targetPart, heading] = (targetAndHeading ?? "").split("#");
          const norm = (targetPart ?? "").trim().replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
          if (norm === oldBase.toLowerCase() || norm === oldNoExt.toLowerCase()) {
            const rebuilt =
              newTarget + (heading ? `#${heading}` : "") + (alias ? `|${alias}` : "");
            return `[[${rebuilt}]]`;
          }
          return full;
        });
        if (updated !== text) {
          fs.writeFileSync(srcAbs, updated, "utf8");
          this.indexer.indexFile(bl.sourcePath);
          updatedLinksIn.push(bl.sourcePath);
        }
      }
    }

    if (isDir) {
      this.indexer.indexAll(false);
    } else {
      this.indexer.removeFile(fromRel);
      if (isIndexableFile(toRel)) {
        this.indexer.indexFile(toRel);
      }
    }

    if (sessionId) {
      this.store.renameSessionFile(sessionId, fromRel, toRel);
    }

    return { from: fromRel, to: toRel, updatedLinksIn };
  }

  /**
   * Soft-deletes a file or folder by moving it to .oro/trash/ for safe recovery.
   */
  deletePath(inputPath: string, sessionId?: string): { path: string; trashPath: string } {
    const { abs, rel } = this.resolveSafe(inputPath);
    if (!rel) throw new Error("Cannot delete workspace root");
    if (!fs.existsSync(abs)) {
      throw new Error(`Path not found: ${rel}`);
    }

    this.onBeforeMutation?.(rel, "deleted");

    const trashDir = path.join(getWorkspaceOroDir(this.workspaceRoot), "trash");
    fs.mkdirSync(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = `${stamp}_${path.basename(abs)}`;
    const dest = path.join(trashDir, safeName);

    const isDir = fs.statSync(abs).isDirectory();
    fs.renameSync(abs, dest);

    if (isDir) {
      this.indexer.indexAll(false);
    } else {
      this.indexer.removeFile(rel);
    }

    if (sessionId) {
      this.store.trackSessionFile(sessionId, rel, "deleted", false);
    }

    return { path: rel, trashPath: path.relative(this.workspaceRoot, dest).replace(/\\/g, "/") };
  }
}
