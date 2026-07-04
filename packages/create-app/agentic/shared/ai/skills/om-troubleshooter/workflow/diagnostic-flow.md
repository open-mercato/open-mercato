# Diagnostic Flow & Working Method

When the developer reports a problem, follow this order — then jump to the matching problem-area file.

## Step 1: Identify the Layer

| Symptom | Layer | Go to |
|---------|-------|-------|
| Module not discovered / route 404 | Module wiring | [`module-issues.md`](module-issues.md) |
| Database column/table errors | Entity & Migration | [`entity-migration-issues.md`](entity-migration-issues.md) |
| API returns 500 / wrong data | API Route | [`api-route-issues.md`](api-route-issues.md) |
| Page blank / component missing | UI & Widget | [`ui-widget-issues.md`](ui-widget-issues.md) |
| Build fails / type errors | Build & Type | [`build-type-issues.md`](build-type-issues.md) |
| Enricher/interceptor/widget not working | Extension | [`extension-issues.md`](extension-issues.md) |
| Connection refused / query errors | Database | [`database-issues.md`](database-issues.md) |

## Step 2: Check Generated Files

These commands fix 60%+ of issues, so they are usually the first fix to propose (they are mutating — propose, then run after confirmation per [Step 4](#step-4-propose-before-fixing)):

```bash
yarn generate          # Regenerate module discovery files
yarn dev               # Restart dev server
```

If the issue persists after `yarn generate`, continue to the specific problem-area file.

## Step 3: Verify the Basics

```bash
# Check module is registered
grep '<module_id>' src/modules.ts

# Check generated files exist
ls .mercato/generated/

# Check for TypeScript errors
yarn typecheck
```

## Step 4: Propose Before Fixing

Once you have diagnosed the root cause, **do not apply the fix immediately**. First present:

1. The **root cause** — what is actually broken and why.
2. The **proposed fix** — the exact commands and/or code changes you intend to apply.

Then **wait for explicit user confirmation** before applying any **mutating** change. This keeps the developer in control and avoids surprise edits, migrations, or restarts.

**Read-only diagnostics may run without asking** — they only gather information and change nothing:

| Allowed without confirmation (read-only) | Requires confirmation (mutating) |
|------------------------------------------|----------------------------------|
| `yarn typecheck` | `yarn generate` |
| `grep` / file reads / `ls` | `yarn db:generate` |
| log / browser-console inspection | `yarn db:migrate` |
| `docker compose ps` | editing files |
| `curl` against a running endpoint (GET) | restarting the dev server (`yarn dev`) |
| | `docker compose up` |

When in doubt about whether an action mutates state, treat it as mutating and ask first. Once the user confirms, apply the fix and verify it.

## Rules

- **ALWAYS** present the diagnosed root cause and the proposed fix (commands/code), then **wait for explicit user confirmation before applying any mutating change** (see [Step 4](#step-4-propose-before-fixing)). Only read-only diagnostics may run without asking.
- **ALWAYS** check server logs / browser console for actual error messages
- **NEVER** edit files in `.mercato/generated/` or `node_modules/`
- **NEVER** assume the issue — verify with actual error output
- Treat `yarn generate` as the most likely first fix, but propose it before running — it regenerates files and is a mutating action
- Fix the root cause, not the symptom — temporary workarounds become permanent bugs
- When proposing a fix, include the exact command or code change needed
