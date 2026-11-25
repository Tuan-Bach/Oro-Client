import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDefaultSessionTitle,
  generateNewSessionTitle,
  generateShortSessionTitle,
} from "../src/agent/session-naming.js";

describe("Session Naming & Short Title Generator", () => {
  it("correctly identifies default/placeholder session titles", () => {
    assert.equal(isDefaultSessionTitle(""), true);
    assert.equal(isDefaultSessionTitle(null), true);
    assert.equal(isDefaultSessionTitle("New Chat"), true);
    assert.equal(isDefaultSessionTitle("new chat 2"), true);
    assert.equal(isDefaultSessionTitle("New Session"), true);
    assert.equal(isDefaultSessionTitle("Main Workspace"), true);
    assert.equal(isDefaultSessionTitle("Session 2026-11-23 (a1b2)"), true);
    assert.equal(isDefaultSessionTitle("Session 1"), true);

    // Non-default custom titles
    assert.equal(isDefaultSessionTitle("Quantum Computing"), false);
    assert.equal(isDefaultSessionTitle("OCR Acceleration on FPGA"), false);
    assert.equal(isDefaultSessionTitle("Login Bug Fix"), false);
  });

  it("generates clean short placeholder titles for new sessions", () => {
    assert.equal(generateNewSessionTitle([]), "New Chat");
    assert.equal(generateNewSessionTitle([{ title: "Something Else" }]), "New Chat");
    assert.equal(generateNewSessionTitle([{ title: "New Chat" }]), "New Chat 2");
    assert.equal(
      generateNewSessionTitle([{ title: "New Chat" }, { title: "New Chat 2" }]),
      "New Chat 3"
    );
  });

  it("extracts punchy, short titles from user prompts", () => {
    // Question with filler
    assert.equal(
      generateShortSessionTitle("Explain how quantum computing works"),
      "Quantum Computing Works"
    );

    // Bug fix request
    assert.equal(
      generateShortSessionTitle("Can you fix the login bug in auth.ts?"),
      "Login Bug in Auth.ts"
    );

    // Multi-line bulleted request
    const multiLine = `- Explain how the auto-debug & improve loop work\n- The files scroll bar is still the old one`;
    assert.equal(
      generateShortSessionTitle(multiLine),
      "Auto-Debug & Improve Loop"
    );

    // Acronym preservation (OCR, FPGA, API)
    assert.equal(
      generateShortSessionTitle("Build an OCR model acceleration for FPGA"),
      "OCR Model Acceleration"
    );

    // Short greeting / single word
    assert.equal(generateShortSessionTitle("hello"), "Hello");

    // Length limit under 26 characters
    const title = generateShortSessionTitle("A very long comprehensive question about building distributed databases with sqlite");
    assert.ok(title.length <= 26, `Title length ${title.length} is greater than 26`);
  });
});
