# Customer dictionary label localization

Issue: #6197. This fix extends the existing entity translation design in [SPEC-026a](implemented/SPEC-026a-2026-02-15-entity-translations-phase2.md).

## Behavior

Customer dictionary reads show unchanged seeded labels in the requested interface language (`en`, `pl`, `de`, `es`, `ko`). A stored label qualifies for a seeded fallback only when both its value and label match the shipped default. Generated renewal-quarter labels follow the same rule. Operator edits and custom values keep their stored labels.

Explicit `customers:customer_dictionary_entry` translations of `label` take precedence over the seeded fallback. Each inherited record resolves its translation in the owning organization. Sorting uses the displayed label. The optional translation overlay can be unavailable without losing the seeded fallback.

## API and cache contracts

- Existing `GET /api/customers/dictionaries/[kind]` retains its response shape and stable entry IDs, values, colors, icons and inheritance metadata. Locale resolution uses the existing translation overlay request resolver and server locale fallback.
- Server dictionary cache keys include locale. Cached payloads contain base labels; localization runs on fresh and cached responses so a saved or deleted translation is visible on the next request. Existing dictionary invalidation tags cover all locale variants.
- Customer dictionary React Query keys and requests include locale. Existing helper parameters remain supported; locale is an additional optional parameter.
- New read-only `GET /api/customers/customer-dictionary-entries` supplies base records to TranslationManager's existing entity lookup. It requires authentication, `customers.settings.manage` and `translations.view`, and filters every query by trusted tenant and selected organization. It accepts bounded pagination (`pageSize <= 100`), escaped label search and an optional UUID `id`.
- `customers/translations.ts` declares `label` as translatable. Existing discovery registers it in the client field registry; the translations registrar registers it on the server.

## Migration & Backward Compatibility

No database migration, backfill, stored-value rewrite or reindex is required. Existing tenants receive seeded fallbacks at read time. Seed constants move into a lightweight customer library while the previously public CLI exports remain re-exported at their original path. Existing HTTP methods and response fields, ACL identifiers and translation storage contracts are preserved. The manager lookup is additive and performs no writes.

TranslationManager stores explicit labels through its existing undoable translation commands. This fix does not change separate pipeline-stage entity names or other modules' dictionaries.

## Verification

Unit coverage checks all defaults in all shipped locales, edited/custom labels, regional locales, overlay precedence, inherited scope, translated sorting, cache-hit translation changes, client locale isolation and manager pagination/scope. Integration coverage checks seeded reads, custom translation save/update/delete behavior, permission denial and wrong-organization reads through the real dispatcher. Browser QA targets customer filter labels and TranslationManager record lookup.
