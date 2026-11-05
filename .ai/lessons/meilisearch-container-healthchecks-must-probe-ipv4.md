---
title: "Meilisearch container healthchecks must probe IPv4 explicitly"
modules: ["search","create_app"]
areas: ["testing","architecture"]
topics: ["network-security","package-runtime","runtime-startup"]
---

# Meilisearch container healthchecks must probe IPv4 explicitly

**Context**: Standalone full-app Docker scaffolds used `wget http://localhost:7700/health` for the Meilisearch healthcheck, while other compose files used `curl`.

**Problem**: In `getmeili/meilisearch:v1.11`, `wget` resolves `localhost` to IPv6 `::1` first, but Meilisearch listens on IPv4 (`0.0.0.0:7700`). The container is healthy but Docker marks it `unhealthy`, which blocks dependent services.

**Rule**: Use `curl -fsS http://127.0.0.1:7700/health` for Meilisearch container healthchecks instead of `wget` or `localhost`.

**Applies to**: Root `docker-compose*.yml`, standalone app templates in `packages/create-app/template/`, and any future dev/test container compose files that run Meilisearch.
