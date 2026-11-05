---
title: "Verify disposable targets after child configuration loading"
modules: ["cli"]
areas: ["testing","architecture"]
topics: ["database-isolation","runtime-startup","environment-forwarding"]
---

# Verify disposable targets after child configuration loading

**Context**: Development and QA launchers allocate disposable databases, then invoke initialization through a task runner with strict environment filtering and application dotenv loading.

**Problem**: A correct caller `DATABASE_URL` does not prove that the initializer uses it. Filtering can remove the override, allowing a valid default connection to receive destructive SQL. A post-initialization table check detects damage too late.

**Rule**: Forward required environment explicitly and carry the guard requirement through an independent channel. After normal child configuration loading, validate the exact effective connection and the connected database's allocation-specific ownership marker before any mutation. Recheck the connection performing destructive SQL. Never flush a service the disposable launcher does not own.

**Regression evidence**: Exercise the real strict task-runner path with two freshly owned databases. Point fallback configuration at the control database; missing, stripped or mismatched configuration must fail before DROP and preserve its sentinel. Never use a developer's default database as the control.

**Applies to**: Disposable development/test launchers and destructive bootstrap helpers.
