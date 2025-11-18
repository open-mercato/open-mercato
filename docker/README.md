# Docker Setup for Open Mercato

This directory contains Docker configuration for running Open Mercato with PostgreSQL (with pgvector) and Redis.

## Quick Start

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Restart services
docker compose restart
```

## Services

- **PostgreSQL 15** with pgvector extension (port 5432)
- **Redis 7** for caching and event persistence (port 6379)

## Database Initialization

The `postgres-init.sh` script automatically:
1. Creates the vector extension in the default database (`open_mercato`)
2. Creates the vector extension in `template1` so all future databases inherit it automatically

This means:
- ✅ The `open_mercato` database has pgvector enabled
- ✅ Any new database you create will automatically have pgvector enabled
- ✅ No manual intervention needed after container restart

If you're using an existing database volume (from before this setup), you may need to manually enable the extension:

```bash
docker exec mercato-postgres psql -U postgres -d open_mercato -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Data Persistence

Data is stored in named Docker volumes:
- `mercato-postgres-data` - PostgreSQL data
- `mercato-redis-data` - Redis data

To completely reset and start fresh:

```bash
docker compose down -v  # This will DELETE all data
docker compose up -d
yarn mercato init
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

## Troubleshooting

**Check if vector extension is installed:**
```bash
docker exec mercato-postgres psql -U postgres -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Access PostgreSQL directly:**
```bash
docker exec -it mercato-postgres psql -U postgres
```

**Access Redis CLI:**
```bash
docker exec -it mercato-redis redis-cli
```
