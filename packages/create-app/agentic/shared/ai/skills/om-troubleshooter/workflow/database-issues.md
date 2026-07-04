# Database Issues

## Connection refused

**Checklist**:

1. **Is PostgreSQL running?**
   ```bash
   docker compose ps    # Check container status
   docker compose up -d # Start if stopped
   ```

2. **Is `.env` configured correctly?** Check `DATABASE_URL`

3. **Is the database created?**
   ```bash
   yarn initialize      # Creates DB + first admin
   ```

## Query timeout / slow queries

**Checklist**:

1. **Are indexes present on `organization_id` and `tenant_id`?** Check entity has `@Index()`
2. **Is the query filtering by `organization_id`?** Missing filter = full table scan
3. **Are enrichers using batch queries?** Missing `enrichMany` causes N+1
