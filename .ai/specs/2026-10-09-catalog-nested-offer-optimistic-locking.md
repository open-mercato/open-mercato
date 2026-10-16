# Catalog nested-offer optimistic locking

**Scope:** Catalog data integrity
**Status:** Draft follow-up
**Related:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`

## TLDR

Protect existing offer upserts inside product edits with the offer record's own version. This is independent of CrudForm section composition and therefore ships separately.

## Problem

Product edits can delete offers with child-specific optimistic-lock headers, but existing offers included in the nested product update are matched without carrying and enforcing each offer's `updatedAt`. A concurrent offer edit can therefore be overwritten even when the parent product version is current.

## Proposed solution

- Add optional `id` and `updatedAt` to the nested offer input without removing or narrowing existing fields.
- Have the product edit form send both for every existing offer and omit both for new offers.
- In `syncOffers`, resolve supplied ids under the current tenant/organization and parent product, enforce the supplied child version before mutation, and surface the standard record conflict.
- Keep legacy callers that omit the additive fields on their current channel-matching behavior until a separately announced compatibility tightening.
- Do not reuse the parent product version for an offer row.

## Acceptance criteria

1. Concurrent modification of an existing offer causes a conflict and no partial offer overwrite.
2. New offers require no prior version; updates with `id` require a matching `updatedAt`.
3. Tenant/organization and parent-product scoping are enforced before version comparison.
4. Legacy unversioned callers preserve current behavior and are covered explicitly.
5. Product edit, direct channel-offer edit, create, delete, and mixed existing/new offer cases have integration coverage.

## Compatibility

The request additions are optional and additive. Any future requirement that all callers provide offer versions needs the repository deprecation protocol, upgrade notes, and a bridge period.
