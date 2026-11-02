---
title: "Preserve existing encryption roots during startup"
modules: ["shared", "cli", "create_app"]
areas: ["module-data", "architecture"]
topics: ["encryption", "data-integrity", "runtime-startup"]
---

# Preserve existing encryption roots during startup

The startup-key work for PR #8377 initially proposed replacing published dummy
roots. The user corrected this: existing ciphertext still depends on those roots,
and replacing them silently makes data unreadable. Existing installations must
continue with a warning that includes a verified rotation command and a required
database-and-key backup. Environment-only defaults may also belong to an existing
installation; preserve them with a warning instead of blocking startup.

Provision only when neither root is configured. Preserve every non-empty key,
including published roots and the implicit opt-in development root. A saved root
is existing configuration; mismatched process/file values warn without changing
existing environment precedence or either stored value. Fresh env files copied
from examples can receive random keys before data initialization.
Never imply tenant entity rotation also migrates all system secrets and lookup
hashes. Document its actual coverage and verify backup recovery before migration.

Resolve the env-file owner from the active application's filesystem layout and
stop at its nearest Git boundary. Shared `node_modules` package symlinks can point
into another checkout; they identify installed code, not the owner of configuration.
Regression tests must include two distinct checkouts with borrowed dependency
symlinks and assert that both env loading and provisioning leave the foreign
checkout untouched.
