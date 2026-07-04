# Anti-Patterns and Rules

## 9. Anti-Patterns

| Anti-Pattern | Problem | Correct Pattern |
|-------------|---------|-----------------|
| `@ManyToOne` across modules | Tight coupling, breaks module isolation | Store FK as `uuid` column, use enrichers |
| Storing computed values | Stale data, maintenance burden | Compute on read via enrichers or queries |
| Using `any` for JSONB fields | No type safety | Define a Zod schema, use `z.infer` |
| Blindly committing all generated migrations | Captures unrelated snapshot drift | Keep only scoped SQL and update the matching snapshot |
| Manual migration SQL without snapshot update | Future `yarn db:generate` recreates the same migration | Update `.snapshot-open-mercato.json` in the same change |
| Renaming columns | Breaks existing data/queries | Add new column, migrate data, drop old |
| Missing `organization_id` | Cross-tenant data leaks | Always include and index |
| Using `varchar` without `length` | Defaults vary by DB | Always specify `length` |
| Storing arrays as comma-separated strings | Can't query, no integrity | Use `jsonb` arrays or junction tables |
| UUID FK without index | Slow joins | Always `@Index()` on FK columns |
| Nullable required fields | Data integrity issues | Use `!` assertion for required, `null` for optional |
| Hand-rolled AES / `crypto.subtle` / custom KMS for sensitive columns | Per-tenant key isolation, hash lookups, key rotation, and admin UI all break | Declare `<module>/encryption.ts` with `defaultEncryptionMaps`; let the framework manage DEKs and Vault |
| Reading encrypted columns with raw `em.find` / `em.findOne` | Returns ciphertext, breaks search, silent data corruption | Use `findWithDecryption` / `findOneWithDecryption` with `{ tenantId, organizationId }` |
| Storing PII as plaintext "for now" / TODO comments | GDPR violation, leaks at rest, expensive backfill later | Encrypt from day one; toggling later only protects new writes |
| Encrypting an `email` column without a `hashField` | Login / equality lookups stop working | Declare a sibling `hashField` (e.g. `email_hash`) in the encryption map and add the matching `varchar` column |

---

## Rules

- **MUST** include `organization_id` and `tenant_id` on all tenant-scoped entities
- **MUST** include standard columns (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`)
- **MUST** use UUID v4 for primary keys
- **MUST** index all FK columns and `organization_id` / `tenant_id`
- **MUST** create or keep a scoped migration after entity changes and update `.snapshot-open-mercato.json`
- **MUST** review generated migration before applying
- **MUST NOT** commit unrelated migrations emitted by `yarn db:generate`
- **MUST NOT** run `yarn db:migrate` without explicit user confirmation
- **MUST** use `nullable: true` with `= null` default for optional fields
- **MUST** specify `length` on all `varchar` columns
- **MUST NOT** use ORM relationship decorators across module boundaries
- **MUST NOT** rename or drop columns in a single release
- **MUST** declare encrypted columns in `<module>/encryption.ts` exporting `defaultEncryptionMaps: ModuleEncryptionMap[]`, and read them via `findWithDecryption` / `findOneWithDecryption` from `@open-mercato/shared/lib/encryption/find` — see the encryption workflow
- **MUST NOT** hand-roll AES / KMS calls or store sensitive columns as plaintext "for now" — use the encryption-maps mechanism in the encryption workflow
- Use `jsonb` for flexible/nested data, proper columns for queryable/sortable data
- Use junction tables for many-to-many relationships
- Derive TypeScript types from Zod schemas, never duplicate type definitions
