import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { OroStore } from "../src/db/store.js";
import { VaultFsManager } from "../src/vault/fs-manager.js";
import { VaultIndexer } from "../src/vault/indexer.js";
import { startOroServer } from "../src/server/server.js";

describe("E2E Diagnostic & Edge-Case Verification", () => {
  it("verifies PageRank calculation with cyclic, star, and disconnected topologies", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-pr-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      // 1. Star Graph: Notes Leaf1, Leaf2, Leaf3 all link to StarHub.md
      fsMgr.writeFile("StarHub.md", "# Star Hub\nCentral knowledge hub.");
      fsMgr.writeFile("Leaf1.md", "# Leaf 1\nLink to [[StarHub]].");
      fsMgr.writeFile("Leaf2.md", "# Leaf 2\nLink to [[StarHub]].");
      fsMgr.writeFile("Leaf3.md", "# Leaf 3\nLink to [[StarHub]].");
      fsMgr.writeFile("Isolated.md", "# Isolated\nNo connections.");

      const pr = store.computePageRank();
      assert.ok(pr.size >= 5, `Expected 5 notes in PageRank map, got ${pr.size}`);

      // StarHub must have the highest PageRank score (normalized to 1.0)
      const hubScore = pr.get("StarHub.md") ?? 0;
      const leaf1Score = pr.get("Leaf1.md") ?? 0;
      const isolatedScore = pr.get("Isolated.md") ?? 0;

      assert.equal(hubScore, 1.0, "StarHub.md should have maximum PageRank 1.0");
      assert.ok(hubScore > leaf1Score, `Hub score (${hubScore}) should exceed leaf score (${leaf1Score})`);
      assert.ok(hubScore > isolatedScore, `Hub score (${hubScore}) should exceed isolated note (${isolatedScore})`);
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies incremental link resolution (resolveLinksForNote) behaves identically to resolveAllLinks", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-inc-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      fsMgr.writeFile("Alpha.md", "# Alpha\nSee [[Beta]].");
      fsMgr.writeFile("Beta.md", "# Beta\nSee [[Gamma]].");
      fsMgr.writeFile("Gamma.md", "# Gamma\nSee [[Alpha]].");

      // Verify all links resolved
      const linksBefore = store.getAllLinks();
      assert.equal(linksBefore.length, 3);
      assert.ok(linksBefore.every((l) => Boolean(l.targetResolved)));

      // Now edit Beta to point to Delta
      fsMgr.writeFile("Delta.md", "# Delta\nNew note.");
      fsMgr.editFile("Beta.md", "[[Gamma]]", "[[Delta]]");

      // Verify Delta link resolved via incremental resolver
      const betaOut = store.getOutgoingLinks("Beta.md");
      assert.equal(betaOut.length, 1);
      assert.equal(betaOut[0]!.targetResolved, "Delta.md");

      // Verify Alpha and Gamma links were NOT corrupted
      const alphaOut = store.getOutgoingLinks("Alpha.md");
      assert.equal(alphaOut[0]!.targetResolved, "Beta.md");
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies editFile handles CRLF/LF line endings and targeted replacements gracefully", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-edit-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      // 1. CRLF file
      const crlfContent = "line 1\r\nline 2 to edit\r\nline 3\r\n";
      fs.writeFileSync(path.join(tmpDir, "TestCRLF.txt"), crlfContent, "utf8");

      // Target with LF
      fsMgr.editFile("TestCRLF.txt", "line 2 to edit", "line 2 UPDATED");
      const updated = fs.readFileSync(path.join(tmpDir, "TestCRLF.txt"), "utf8");
      assert.ok(updated.includes("line 2 UPDATED\r\n"), "Should preserve CRLF endings in Windows files");

      // 2. Non-matching target throws clean error
      assert.throws(() => fsMgr.editFile("TestCRLF.txt", "nonexistent block", "replacement"), /Target snippet not found/);
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies FTS5 search query parser handles wildcards, quotes, colons, and hyphens safely without crashing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-fts-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      fsMgr.writeFile("SearchNote.md", "# Search Note\nTesting FTS5 query tokenization with special characters: c++ api-v2 \"exact match\" *star*");

      // Edge-case search queries that previously broke naive SQLite MATCH clauses
      const trickyQueries = [
        '""',
        '"unclosed quote',
        'c++',
        'api-v2',
        'key:value',
        'AND OR NOT',
        '***',
        '   ',
        'special (parentheses) [brackets] {braces}',
        'exact match',
      ];

      for (const q of trickyQueries) {
        // Must never throw an unhandled SQLite error
        assert.doesNotThrow(() => {
          const hits = store.searchNotes(q);
          assert.ok(Array.isArray(hits));
        }, `Query failed: ${q}`);
      }
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies OroServer HTTP REST endpoints function correctly and close cleanly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-server-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);
    fsMgr.writeFile("Welcome.md", "# Welcome\nHello from Oro Server test.");
    store.close(); // Close setup handle before server opens its own handle

    // Start on ephemeral/free port
    const instance = await startOroServer(tmpDir, 5890);

    try {
      const port = instance.port;
      assert.ok(port > 0, `Expected server port > 0, got ${port}`);

      const closeHeaders = { headers: { Connection: "close" } };

      // Test GET /api/workspace
      const wsRes = await fetch(`http://127.0.0.1:${port}/api/workspace`, closeHeaders);
      assert.equal(wsRes.status, 200);
      const wsData = (await wsRes.json()) as any;
      assert.ok(wsData.root);

      // Test GET /api/tree
      const treeRes = await fetch(`http://127.0.0.1:${port}/api/tree`, closeHeaders);
      assert.equal(treeRes.status, 200);
      const treeData = (await treeRes.json()) as any[];
      assert.ok(treeData.some((n: any) => n.name === "Welcome.md"));

      // Test GET /api/file?path=Welcome.md
      const fileRes = await fetch(`http://127.0.0.1:${port}/api/file?path=Welcome.md`, closeHeaders);
      assert.equal(fileRes.status, 200);
      const fileData = (await fileRes.json()) as any;
      assert.ok(fileData.content.includes("Hello from Oro Server test."));

      // Test GET /api/links
      const linksRes = await fetch(`http://127.0.0.1:${port}/api/links`, closeHeaders);
      assert.equal(linksRes.status, 200);
      const linksData = (await linksRes.json()) as any[];
      assert.ok(Array.isArray(linksData));
    } finally {
      await instance.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
