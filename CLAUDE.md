@AGENTS.md

## Local Development Database Connection

To connect to the local PostgreSQL database:

```bash
source ~/.bashrc && PGPASSWORD=postgres psql -h localhost -U postgres -d "open-mercato"
```

- **Database name**: `open-mercato`
- **Host**: localhost
- **Port**: 5432
- **User**: postgres
- **Password**: postgres
- **Docker container**: `mercato-postgres` (pgvector/pgvector:pg17-trixie)

Note: Must source `~/.bashrc` first to have access to `psql` command (`/opt/homebrew/opt/postgresql@16/bin/psql`).

