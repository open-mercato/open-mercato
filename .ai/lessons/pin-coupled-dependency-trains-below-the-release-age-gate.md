---
title: "Pin coupled dependency trains below the release-age gate before publishing"
modules: ["documents","create_app"]
areas: ["architecture","integration","testing"]
topics: ["package-runtime","dependency-security","testing"]
---

# Pin coupled dependency trains below the release-age gate before publishing

**Context**: The Documents package raised every TipTap lower bound to a patch published less than five days earlier. The monorepo's existing lockfile installed successfully, but the snapshot workflow's fresh standalone consumer had no eligible version for `@tiptap/core@^3.32.2` and failed with Yarn `YN0016`.

**Problem**: A lockfile proves the monorepo build, not a published package's fresh resolution. Broad ranges in a tightly coupled peer train can select a different patch for standalone consumers, while choosing an older version without checking its published dependency metadata can reintroduce peer drift.

**Rule**: Before publishing a coupled dependency train, select one internally aligned version that has aged past `npmMinimalAgeGate`, pin every direct member exactly, and run both the monorepo install and a clean age-gated resolver probe. Do not add a standing third-party preapproval to make the release lane green.

**Applies to**: Published package manifests, root dependency resolutions, snapshot standalone validation, Yarn lockfiles, and dependency-policy regression tests.
