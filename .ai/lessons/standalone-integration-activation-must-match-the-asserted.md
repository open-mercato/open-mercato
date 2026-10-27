---
title: "Standalone integration activation must match the asserted runtime surface"
modules: ["create_app","example","design_system","auth"]
areas: ["integration","architecture","testing"]
topics: ["access-control","component-overrides","generated-files","testing"]
---

# Standalone integration activation must match the asserted runtime surface

**Context**: A published standalone snapshot generated a disabled baseline and then activated only the base Example module before running the repository integration matrix.

**Problem**: The matrix also asserted app-level Example ACL, navigation, and route overrides plus Design System gallery routes. Those contracts were absent from the activated app, so unrelated tests failed even though package publication and generation succeeded.

**Rule**: Keep the disabled-baseline assertion as a separate precondition, then activate every module and app-level override required by the selected standalone integration matrix before regenerating and booting the app. Pin that activation contract in a focused fixture test.

**Applies to**: Snapshot, canary, and published standalone integration workflows that use `OM_TEST_APP_ROOT`.
