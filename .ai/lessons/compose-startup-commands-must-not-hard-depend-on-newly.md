---
title: "Compose startup commands must not hard-depend on newly added image scripts"
modules: ["create_app"]
areas: ["debugging","module-data","architecture"]
topics: ["command-pattern","runtime-startup","template-sync"]
---

# Compose startup commands must not hard-depend on newly added image scripts

**Context**: Fullapp compose startup was updated to call `/app/docker/scripts/init-or-migrate.sh` directly.

**Problem**: If a user updates `docker-compose.fullapp.yml` but starts an older image without `--build`, container startup fails immediately because the new helper script is not present in that image.

**Rule**: When a compose command references a newly added in-image helper, include a shell fallback path so older images can still boot until the next rebuild.

**Applies to**: Root/template `docker-compose.fullapp*.yml` and similar Docker startup commands that evolve independently from image rebuilds.
