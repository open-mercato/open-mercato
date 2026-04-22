<!-- CODEX_ENFORCEMENT_RULES_START -->
## CRITICAL rules — always follow without exception

1. **After editing any entity file** (`src/modules/<id>/entities/*.ts`):
   - STOP immediately before any further action
   - Tell the user: "I modified an entity in module <id>. Should I create a migration?"
   - If yes: run `yarn db:generate`
   - Show the generated migration to the user before applying
   - Ask for confirmation, then run `yarn db:migrate`
   - Run `yarn generate` after migration is applied

2. **After editing `src/modules.ts`**: immediately run `yarn generate`

3. **Never edit `.mercato/generated/*`**: edit the source and run `yarn generate` instead

4. **Before significant features**: check `.ai/specs/` for an existing spec.
   If none exists, ask the user whether to create one first.

---
<!-- CODEX_ENFORCEMENT_RULES_END -->
