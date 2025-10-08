# Cache Environment Variables

This document describes the environment variables used to configure the cache service.

## Configuration Variables

### `CACHE_STRATEGY`

**Description:** Specifies which cache storage strategy to use.

**Values:** `memory` | `redis` | `sqlite` | `jsonfile`

**Default:** `memory`

**Example:**
```bash
CACHE_STRATEGY=redis
```

### `CACHE_TTL`

**Description:** Default Time To Live (TTL) for cache entries in milliseconds. If not set, cache entries don't expire by default unless specified per-operation.

**Type:** Number (milliseconds)

**Optional:** Yes

**Example:**
```bash
CACHE_TTL=300000  # 5 minutes
```

### `CACHE_REDIS_URL`

**Description:** Redis connection URL. Required when using `redis` strategy. Falls back to `REDIS_URL` if not set.

**Type:** String (URL)

**Required:** Only for `redis` strategy

**Example:**
```bash
CACHE_REDIS_URL=redis://localhost:6379
# or
REDIS_URL=redis://localhost:6379
```

### `CACHE_SQLITE_PATH`

**Description:** Path to the SQLite database file. Required when using `sqlite` strategy.

**Type:** String (file path)

**Default:** `.cache.db`

**Required:** Only for `sqlite` strategy

**Example:**
```bash
CACHE_SQLITE_PATH=./data/.cache.db
```

### `CACHE_JSON_FILE_PATH`

**Description:** Path to the JSON cache file. Required when using `jsonfile` strategy.

**Type:** String (file path)

**Default:** `.cache.json`

**Required:** Only for `jsonfile` strategy

**Example:**
```bash
CACHE_JSON_FILE_PATH=./data/.cache.json
```

## Example Configurations

### Development (In-Memory)

Fast, not shared across instances, data lost on restart.

```bash
CACHE_STRATEGY=memory
CACHE_TTL=300000
```

### Production (Redis)

Shared across instances, persistent, requires Redis server.

```bash
CACHE_STRATEGY=redis
CACHE_REDIS_URL=redis://localhost:6379
CACHE_TTL=600000
```

### Production (SQLite)

Persistent, file-based, good for single instance deployments.

```bash
CACHE_STRATEGY=sqlite
CACHE_SQLITE_PATH=./data/.cache.db
CACHE_TTL=3600000
```

### Development/Testing (JSON File)

Persistent, human-readable, slow, good for debugging.

```bash
CACHE_STRATEGY=jsonfile
CACHE_JSON_FILE_PATH=./data/.cache.json
CACHE_TTL=600000
```

## Strategy Comparison

| Strategy   | Speed      | Persistent | Shared | Dependencies     | Use Case                        |
|------------|------------|------------|--------|------------------|---------------------------------|
| `memory`   | Fastest    | No         | No     | None             | Development, single instance    |
| `redis`    | Fast       | Yes        | Yes    | ioredis          | Production, multi-instance      |
| `sqlite`   | Medium     | Yes        | No*    | better-sqlite3   | Production, single instance     |
| `jsonfile` | Slowest    | Yes        | No     | None             | Development, debugging          |

*Not recommended for concurrent access from multiple processes

## TTL Values Reference

Common TTL values in milliseconds:

```bash
# 1 minute
CACHE_TTL=60000

# 5 minutes
CACHE_TTL=300000

# 10 minutes
CACHE_TTL=600000

# 30 minutes
CACHE_TTL=1800000

# 1 hour
CACHE_TTL=3600000

# 24 hours
CACHE_TTL=86400000
```

## Installation Requirements

Depending on your chosen strategy, you may need to install additional dependencies:

### Redis Strategy

```bash
yarn add ioredis
```

### SQLite Strategy

```bash
yarn add better-sqlite3
```

### Memory and JSON File Strategies

No additional dependencies required.

