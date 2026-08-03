---
title: "Use the bundled Node runtime for sandboxed macOS verification"
modules: ["platform"]
areas: ["testing","debugging"]
topics: ["testing","node-runtime"]
---

# Use the bundled Node runtime for sandboxed macOS verification

**Context**: sandboxed macOS rejected Homebrew Node dylibs and a fresh docs search index was absent → use the bundled Node runtime and build docs before retrying the full gate.

**Rule**: When sandboxed macOS rejects Homebrew Node dynamic libraries, use the bundled Node runtime. Build the docs search index before retrying the full gate when a fresh checkout does not contain it.
