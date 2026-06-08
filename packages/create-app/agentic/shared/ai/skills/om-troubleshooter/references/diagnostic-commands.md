# Diagnostic Commands Reference

## Health Check Sequence

Run in this order — each step depends on the previous:

```bash
# 1. Are services running?
docker compose ps

# 2. Is the database reachable?
yarn db:migrate --dry-run   # Lists pending migrations without applying

# 3. Are generated files up to date?
yarn generate

# 4. Are types correct?
yarn typecheck

# 5. Do tests pass?
yarn test

# 6. Does it build?
yarn build
```

## Module Discovery

```bash
# Check what modules are registered
grep -n 'from:' src/modules.ts

# Check what was auto-discovered
ls .mercato/generated/

# Check a specific module's files
ls -la src/modules/<module_id>/
```

## Database State

```bash
# Check pending migrations
yarn db:migrate --dry-run

# Generate migration for entity changes
yarn db:generate

# Apply migrations (destructive — confirm first)
yarn db:migrate

# Full database reset (destructive — deletes all data)
yarn initialize --force
```

## API Testing

```bash
# Test an API endpoint (requires auth token)
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/<module>/<entities>

# Check API docs
# Navigate to: http://localhost:3000/api/docs
```

## Extension Debugging

```bash
# Check if enrichers are registered
grep 'enrichers' .mercato/generated/enrichers.generated.ts

# Check if widgets are registered
grep 'injection' .mercato/generated/injection-widgets.generated.ts

# Check if interceptors are registered
grep 'interceptors' .mercato/generated/interceptors.generated.ts
```

## Clean Reset

When everything is broken and you need a fresh start:

```bash
# 1. Clean generated files
rm -rf .mercato/generated/

# 2. Clean node_modules cache
rm -rf node_modules/.cache

# 3. Reinstall dependencies
yarn install

# 4. Regenerate everything
yarn generate

# 5. Check for pending migrations
yarn db:generate

# 6. Restart dev server
yarn dev
```
