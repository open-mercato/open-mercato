# Customer dictionary label localization

Issue: #6197. This fix extends the existing entity translation design in [SPEC-026a](implemented/SPEC-026a-2026-02-15-entity-translations-phase2.md).

## Behavior

Customer dictionary reads show unchanged seeded labels in the requested interface language (`en`, `pl`, `de`, `es`, `ko`). A stored label qualifies for a seeded fallback only when both its value and label match the shipped default. Generated renewal-quarter labels follow the same rule. Operator edits and custom values keep their stored labels.

Explicit `customers:customer_dictionary_entry` translations of `label` take precedence over the seeded fallback. Each inherited record resolves its translation in the owning organization. Sorting uses the displayed label. The optional translation overlay can be unavailable without losing the seeded fallback.

## API and cache contracts

- Existing `GET /api/customers/dictionaries/[kind]` retains its response shape and stable entry IDs, values, colors, icons and inheritance metadata. Locale resolution uses the existing translation overlay request resolver and server locale fallback.
- The same endpoint accepts an additive `labels` query parameter: `localized` (default) as above, or `base`, which returns the stored labels with no seeded fallback or entity translation applied. Management surfaces that write labels back (`DictionarySettings` and `ManageTagsDialog`) read with `labels=base`, so editing an entry under a non-English interface never persists a localized projection as the base label shared by every locale. Per-locale labels are edited through TranslationManager.
- Server dictionary cache keys are locale-independent and unchanged from before this fix. Cached payloads contain base labels; localization runs after both a cache hit and a miss, so every locale and the `base` projection share one entry and a saved or deleted translation is visible on the next request. Existing dictionary invalidation tags are unchanged.
- Customer dictionary React Query keys and requests include locale. Existing helper parameters remain supported; locale is an additional optional parameter.
- New read-only `GET /api/customers/customer-dictionary-entries` supplies base records to TranslationManager's existing entity lookup. It requires authentication, `customers.settings.manage` and `translations.view`, and filters every query by trusted tenant and selected organization. It accepts bounded pagination (`pageSize <= 100`), escaped label search and an optional UUID `id`.
- `customers/translations.ts` declares `label` as translatable. Existing discovery registers it in the client field registry; the translations registrar registers it on the server.

## Migration & Backward Compatibility

No database migration, backfill, stored-value rewrite or reindex is required. Existing tenants receive seeded fallbacks at read time. Seed constants move into a lightweight customer library while the previously public CLI exports remain re-exported at their original path. Existing HTTP methods and response fields, ACL identifiers and translation storage contracts are preserved. The manager lookup is additive and performs no writes; the optional `labels` query parameter is additive and defaults to the localized projection.

TranslationManager stores explicit labels through its existing undoable translation commands. This fix does not change separate pipeline-stage entity names or other modules' dictionaries.

## Verification

Unit coverage checks all defaults in all shipped locales, edited/custom labels, regional locales, overlay precedence, inherited scope, translated sorting, cache-hit translation changes, a single locale-independent cache entry, `labels=base` reads under a non-English locale, base-label editing in `DictionarySettings` and `ManageTagsDialog`, client locale isolation and manager pagination/scope. Integration coverage checks seeded reads, `labels=base` reads of seeded and translated entries, custom translation save/update/delete behavior, permission denial and wrong-organization reads through the real dispatcher. Browser QA targets customer filter labels, the customer dictionary settings editor under a non-English locale and TranslationManager record lookup.
