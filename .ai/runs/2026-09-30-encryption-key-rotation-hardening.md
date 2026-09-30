# Encryption Key Rotation Hardening

## Overview

Harden fallback encryption logging and the entities key-rotation/decryption operational commands so secrets are not exposed and incomplete runs fail closed.

## Scope

- Remove secret-derived fingerprints from fallback KMS startup output.
- Read the previous rotation key from `TENANT_DATA_ENCRYPTION_OLD_KEY`, while retaining the legacy CLI flag with a security warning for backward compatibility.
- Preflight encryption-map metadata and key availability before writes.
- Return a failing process status for aborts, incomplete rotations, and unsafe metadata gaps.
- Add regression tests and update operator documentation.

## Non-goals

- Changing encryption formats, KMS derivation, database schemas, or public API responses.
- Removing the existing `--old-key` flag without the required deprecation window.
- Expanding the change to the separate auth-module rotation command.

## Implementation Plan

### Phase 1: Security hardening

1. Remove key-derived identifiers from fallback KMS logs.
2. Make entities encryption operations consume secret-manager input and fail closed.

### Phase 2: Coverage and release readiness

1. Add regression tests and update operator documentation.
2. Run the configured validation gate and complete automated code review.

## Risks

- Encryption operational commands are high-risk even without a schema change; failure paths must never report success.
- Retaining `--old-key` preserves compatibility but cannot prevent shell history or process-list exposure, so documentation and runtime output direct operators to the environment variable.
- A failed rotation may have safely updated earlier rows before a later undecryptable row is found; the command exits non-zero and leaves the undecryptable ciphertext untouched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Security hardening

- [ ] 1.1 Remove key-derived identifiers from fallback KMS logs
- [ ] 1.2 Make entities encryption operations consume secret-manager input and fail closed

### Phase 2: Coverage and release readiness

- [ ] 2.1 Add regression tests and update operator documentation
- [ ] 2.2 Run the configured validation gate and complete automated code review
