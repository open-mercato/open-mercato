---
title: "Docker initialization should treat the existing-users CLI abort as already initialized"
modules: ["cli","create_app"]
areas: ["module-data","architecture","debugging"]
topics: ["package-runtime","runtime-startup","template-sync"]
---

# Docker initialization should treat the existing-users CLI abort as already initialized

**Context**: The CLI intentionally aborts `init` when the database already contains users, printing `Initialization aborted: found N existing user(s) in the database.`

**Problem**: Docker first-run boot paths used marker files only. When the marker was missing but the database was already initialized, containers exited instead of continuing with migrations and startup.

**Rule**: Docker init/startup wrappers must treat the specific existing-users initialization abort as a successful already-initialized state: run migrations, write the init marker, and continue boot. Do not broaden this to ignore other init failures.

**Applies to**: `docker/scripts/*.sh`, root `docker-compose.fullapp*.yml`, and standalone template Docker startup files in `packages/create-app/template/docker/**`.
