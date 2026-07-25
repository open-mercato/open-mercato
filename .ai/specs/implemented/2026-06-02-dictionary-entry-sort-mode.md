# Dictionary Entry Sort Mode

## TLDR

Add configurable dictionary entry ordering with `label_asc` as the default. Generic dictionaries store the mode on the dictionary record, while customer dictionaries store per-kind modes in customer settings. Dictionary entry APIs return entries in the configured order so dropdowns do not sort locally after fetching.

## Overview

Dictionary dropdowns currently appear alphabetized in some places because UI helpers sort entries locally. That makes it impossible to preserve another useful order, such as import or creation order, and can diverge from API behavior. The feature moves ordering to the API layer and exposes a small settings surface for choosing the mode.

## Problem Statement

Users need customer status and other dictionary dropdowns to be predictably ordered. The default preference is A to Z, but some dictionaries need creation-order behavior to reflect imported workflows. Local client sorting also makes backend ordering unobservable and inconsistent across modules.

## Proposed Solution

- Define shared entry sort modes: `label_asc`, `label_desc`, `value_asc`, `value_desc`, `created_at_asc`, `created_at_desc`.
- Default every dictionary to `label_asc`.
- Add `Dictionary.entrySortMode` for generic dictionaries.
- Add `CustomerSettings.dictionarySortModes` for customer dictionary kinds.
- Sort entries server-side after decryption when label or value ordering is needed.
- Preserve API order in dropdown components with `sortOptions="none"` in dictionary-backed call sites.

## Architecture

Generic dictionary list/create/update APIs include `entrySortMode`. Generic dictionary entries are fetched with decryption-aware helpers and sorted by the configured mode before response serialization.

Customer dictionary APIs load `CustomerSettings.dictionarySortModes[kind]`, deduplicate local and inherited entries as before, then sort the resulting list. Cache keys include the active sort mode, and the settings endpoint invalidates customer dictionary cache tags when sort modes change.

`DictionaryEntrySelect` remains backward compatible: it still defaults to local `label_asc` sorting unless a caller opts into API order with `sortOptions="none"`.

## Data Models

- `dictionaries.entry_sort_mode text not null default 'label_asc'`
- `customer_settings.dictionary_sort_modes jsonb null`

No dictionary entries, customers, leads, or other business records are modified by this feature.

## API Contracts

- `GET /api/dictionaries` includes `entrySortMode`.
- `POST /api/dictionaries` accepts optional `entrySortMode`.
- `GET/PATCH /api/dictionaries/:dictionaryId` includes and accepts optional `entrySortMode`.
- `GET /api/dictionaries/:dictionaryId/entries` returns entries ordered by the dictionary's configured mode.
- `GET /api/customers/dictionaries/:kind` returns entries ordered by the configured customer dictionary mode and includes `sortMode`.
- `GET /api/customers/settings/dictionary-sort-modes` returns `{ dictionarySortModes }`.
- `PATCH /api/customers/settings/dictionary-sort-modes` updates `{ dictionarySortModes }` through the command bus and mutation guard.

## Integration Coverage

- API unit coverage for shared sort helper.
- API coverage for customer dictionary route and settings route.
- Component coverage for `DictionaryEntrySelect` preserving API order when `sortOptions="none"`.
- Local Docker/OrbStack e2e through browser automation: verify default A to Z for customer statuses, switch to `created_at_asc`, verify API/dropdown order changes, then restore `label_asc`.

## Risks & Impact Review

Risk: Local UI sorting could still override API order in a dictionary-backed call site.
Severity: Medium.
Mitigation: Existing `DictionaryEntrySelect` call sites are updated to `sortOptions="none"` and normalizers that consume already-sorted APIs opt out of local sorting.
Residual risk: New future call sites must choose `sortOptions="none"` when they need configured order.

Risk: Sorting encrypted labels or values at SQL level would sort ciphertext.
Severity: Medium.
Mitigation: Entry APIs fetch and decrypt before sorting by label or value.
Residual risk: Large dictionaries may sort in memory, which is acceptable for current dictionary sizes.

Risk: Cache could serve a list sorted with a previous mode.
Severity: Medium.
Mitigation: Customer dictionary cache keys include sort mode and settings PATCH invalidates relevant dictionary tags.
Residual risk: External cache implementations must honor tags as expected.

## Final Compliance Report

- Backward compatibility: Additive API fields and optional props only.
- Data migration: Additive columns with defaults/nullability.
- Security: Existing auth and feature guards retained; settings writes use mutation guard.
- Tenant scope: Existing tenant and organization resolution is preserved.
- UX default: A to Z remains the default order.

## Changelog

- 2026-06-02: Added spec for configurable dictionary entry sort modes across generic and customer dictionaries.
