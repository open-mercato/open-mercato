# Customer vector indexing for records with useful semantic content

Extends: `.ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md` (§ Customer vector privacy invariant)

Tracking issue: [#8135](https://github.com/open-mercato/open-mercato/issues/8135)

## TLDR

Customer-account vectors encode an ID. Person and company vectors mostly encode status and lifecycle stage, with company size when available. The proposal is to omit built-in vector indexing for these three entity types until maintainers approve a field set that supports a specific semantic search use case. Users would continue finding these records through fulltext and token lookup when those strategies are enabled.

## Maintainer decision

On 2026-11-21, the requesting maintainer approved omitting built-in vector indexing for `customer_accounts:customer_user`, `customers:customer_person_profile`, and `customers:customer_company_profile`, with fulltext and token lookup retained. Any future semantic field set needs a separate decision and evidence of a specific search use case.

## Problem and scope

`customer_user` always supplies an ID or an entity-type fallback as embedding text. Person and company builders use a scalar field allowlist, apply the default and effective scoped encryption exclusions, and fall back to an ID when no text survives. Status and lifecycle stage accept strings, so approval of a field name alone would leave the allowed values undefined. [Privacy fix and follow-up review](https://github.com/open-mercato/open-mercato/pull/8081#pullrequestreview-5678977538)

Meilisearch's hybrid search uses explicit embedding templates to select the document fields and warns that semantic search can return low-relevance matches. Open Mercato already has independent lexical and vector stores, so the approved policy can preserve keyword matching through the existing registration without changing the hybrid ranking algorithm. [Meilisearch hybrid search guide](https://github.com/meilisearch/documentation/blob/main/capabilities/hybrid_search/getting_started.mdx)

Under the proposal, both populated and sparse records of the three types would skip record embedding, including ID-only accounts. Existing fulltext and token field policies, hashed lookup, result presenters and links, ACLs, tenant and organization scoping, and published entity IDs and configuration contracts would continue. Tenant-wide strategy settings and other entity types would continue using their current configuration. A vector-only search would stop returning the three types after the scoped purge. Hybrid ranking can change when their vector contribution disappears.

## 📝 Delta

### Capability: customer-search

#### MODIFIED Requirement: Customer record indexing eligibility

The built-in registrations SHALL use fulltext and tokens for customer users and person/company profiles. The built-in vector strategy SHALL skip embedding and upserting records of these types, including sparse records and ID-only accounts.

##### Scenario: Index a customer record

- WHEN the app indexes one of the three record types through a live write, a queued job, or reindex
- THEN enabled fulltext and token lookup remain eligible under their existing field, ACL, tenant, and organization rules
- THEN the vector provider receives no record embedding input for that record

Frozen by: `packages/search/src/__tests__/vector-index-security.test.ts`

## Architecture and compatibility

Set `strategies: ['fulltext', 'tokens']` on the three existing entity registrations. Reuse the strategy policy enforced by `SearchService`, `SearchIndexer` reindex, and the opt-in legacy vector service. Keep the existing source builders, including encryption exclusions and presenter/link generation, so lexical consumers and downstream strategy overrides retain their current source contract. Keep customer role and other CRM entity registration as it is today. Previously queued vector jobs remain subject to the indexing policy on consumption. Existing vector queries and cleanup follow the current driver contracts.

The change uses the published `SearchEntityConfig` strategy override. It requires no schema migration, new API, or provider configuration. Downstream deployments with their own search registrations can continue to use the existing override mechanism. Deployments with only vector search enabled need to enable a configured lexical strategy if they want to find these records after purge.

## Operator rollout

Stopping vector writes leaves existing vector documents in the store. Pause indexing, drain or discard pending vector jobs using the deployment's queue tooling, and deploy the change to every app and indexing worker. Before restarting indexing, purge the three entity IDs through the configured vector driver for each affected tenant, including soft-deleted records and legacy vectors without an organization. For pgvector, `purge(entityId, tenantId)` covers every organization and null scope for that entity and tenant. Supplying an organization restricts the purge to that organization. With another driver, check the equivalent tenant and entity scope before deleting. Verify that the targeted documents are absent and that unrelated tenants and entities are intact.

The driver-level purge leaves the other search stores intact. The embeddings reindex endpoint skips excluded entities before its `purgeFirst` operation. A broader all-strategy purge requires rebuilding the affected lexical indexes. Restoring vector eligibility after a rollback requires a scoped vector rebuild to repopulate purged documents. The earlier privacy repair's additional rebuild instructions apply to records that remain eligible for vector indexing. [Existing operator guidance](../../UPGRADE_NOTES.md#rebuild-customer-search-vectors-after-the-privacy-fix-7826)

## Acceptance evidence

Use capturing embedding and vector drivers with the real customer registrations. Verify zero record embedding calls and zero vector upserts for all three entity types across single-record, by-ID, bulk, queued, and reindex paths, including sparse profiles and ID-only accounts. Include a vector-enabled entity as a positive control. Check fulltext and hashed token lookup through the affected search paths, including result presentation, ACL denial, and tenant and organization boundaries. The operator's post-purge checks include stale null-organization entries and controls in other entities and tenants.

## Implementation Plan

### Phase 1 · Verify and apply the registration policy

- Step 1.1 — Run the existing customer provider-boundary characterization on the current registration and capture the active provider and scoped fulltext behavior.
- Step 1.2 — Apply the three strategy overrides. Cover default eligibility at the real provider boundary and preserve the safe-source checks under an explicit vector override. Verify direct and queued reindex paths.
- Step 1.3 — Exercise lexical lookup with self-contained integration fixtures through the search endpoint. Preserve search ACL and organization-scope coverage. Move vector playground pagination coverage from company profiles to an eligible fixture and verify that company reindex queues zero vector jobs. Record the driver-level purge and rollback in operator docs.
- Step 1.4 — Archive the capability delta and run the applicable package, generated registry, and repository validation checks.

## Changelog

- 2026-11-21 — Recorded the approved lexical-only policy and the operator rollout for #8135.
