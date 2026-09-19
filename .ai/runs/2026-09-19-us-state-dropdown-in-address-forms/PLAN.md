# Execution plan - US state dropdown in every address form

**Slug:** `us-state-dropdown-in-address-forms`
**Branch:** `feat/us-state-dropdown-in-address-forms`
**Base:** `develop` (branched from `spec/us-state-dropdown-in-address-forms` so the release step can merge the spec PR and this PR together)
**Source spec:** `.ai/specs/2026-09-19-us-state-dropdown-in-address-forms.md`
**Spec PR:** #11

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed - per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add getSelectableSubdivisions and findSubdivision with unit tests | inline | done | 2bcf5cc8a |
| 1 | 1.2 | Country-aware resolveAddressLayout and name-tolerant validateAddressForProfile | inline | done | 985bd94ef |
| 1 | 1.3 | Wire the packages/ui AddressEditor with RTL coverage | inline | done | 90e0411ea |
| 1 | 1.4 | Wire the customers AddressEditor with RTL coverage | inline | done | c07dfc98d |
| 2 | 2.1 | Replace the channel region field with ChannelRegionField and RTL coverage | inline | done | 0b32026e4 |
| 2 | 2.2 | Special-case the ship-from region in TaxProviderSettings with test coverage | inline | done | PENDING |
| 2 | 2.3 | Integration test TC-MKT-004 - customer address US state dropdown | inline | todo | — |
| 2 | 2.4 | Integration test TC-MKT-005 - sales channel US state | inline | todo | — |
| 2 | 2.5 | Changelog line in the parent market display spec | inline | todo | — |

## Goal

Make the "Region / State" control a dropdown of the 50 US states plus the District of Columbia whenever the address's
own country is the United States, and a plain text input for every other country, in all four forms that carry both a
country and a region field.

## Scope

- `packages/shared/src/lib/location/subdivisions.ts` - two accessors (`getSelectableSubdivisions`, `findSubdivision`).
- `packages/shared/src/lib/display/address.ts` - `AddressLayoutOptions`, the optional second argument of
  `resolveAddressLayout`, and `validateAddressForProfile` keyed off the address's own country through `findSubdivision`.
- `packages/ui/src/backend/detail/AddressEditor.tsx` and
  `packages/core/src/modules/customers/components/AddressEditor.tsx` - the two editor twins, changed identically.
- `packages/core/src/modules/sales/components/channels/channelFormFields.ts` - the `custom` region field and
  `ChannelRegionField`.
- `packages/core/src/modules/sales/components/TaxProviderSettings.tsx` - the ship-from region special case.
- Unit, RTL and integration coverage for every one of the above.

## Non-goals

- No migration, no column change, no API or zod schema change. `region` stays a free-text column that accepts anything.
- No rewrite of legacy full-name values (`Texas` stays `Texas` until the user picks from the list).
- No territories in the picker; `isValidSubdivision` keeps accepting all 56 codes.
- No region field added to the shipment wizard or the WMS warehouse address (neither has one today).
- No label change: "Region / State" stays the label whatever the country.

## Decisions carried from the spec

- Q1: the picker offers the 50 states plus DC. Territories stay valid but unlisted.
- Q2: the stored value is the USPS two-letter code. A legacy full name is matched case-insensitively and preselects its
  state; the stored value is never rewritten on open.
- An unknown value keeps the existing warning badge and stays saveable.

## Risks

- R3 from the spec: the channel form's `custom` field could render its label or error differently from the `select` it
  replaces. Covered by the RTL test in Step 2.1, which asserts the label, the error text and `aria-invalid`.
- `channelFormFields.ts` was renamed to `.tsx` because `ChannelRegionField` renders JSX. The import path
  (`@open-mercato/core/modules/sales/components/channels/channelFormFields`) is unchanged: the package's wildcard
  `exports` map resolves a subpath to either `./src/*.ts` or `./src/*.tsx` and both build to the same `dist/*.js`, and
  the customers form config this field follows (`formConfig.tsx`) is already `.tsx`.

## External references

None. No `--skill-url` was passed.
