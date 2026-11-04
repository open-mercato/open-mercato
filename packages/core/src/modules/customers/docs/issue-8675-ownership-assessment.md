# Company organization ownership (#8675)

Company creation now checks the final organization against the authorized tenant before creating either the customer entity or company profile. Missing, soft-deleted, and foreign organizations return the existing generic 403 denial. Organization ACL semantics, privileged tenant selection, system calls, and update/delete behavior remain unchanged. No schema, startup, or configuration changes are required.

Existing rows are not rewritten. An authorized operator can assess historical inconsistencies using a read-only connection in each tenant's approved maintenance context. Do not expose identifiers or results to tenant users or public issue comments. The following query returns identifiers only, including soft-deleted records, for investigation:

```sql
SELECT entity.id AS entity_id, profile.id AS profile_id,
       entity.tenant_id AS entity_tenant_id,
       entity.organization_id AS entity_organization_id,
       profile.tenant_id AS profile_tenant_id,
       profile.organization_id AS profile_organization_id
FROM customer_entities AS entity
LEFT JOIN customer_companies AS profile ON profile.entity_id = entity.id
LEFT JOIN organizations AS entity_org ON entity_org.id = entity.organization_id
LEFT JOIN organizations AS profile_org ON profile_org.id = profile.organization_id
WHERE entity.kind = 'company'
  AND (entity_org.id IS NULL
       OR entity_org.tenant_id IS DISTINCT FROM entity.tenant_id
       OR profile.id IS NULL
       OR profile_org.id IS NULL
       OR profile_org.tenant_id IS DISTINCT FROM profile.tenant_id
       OR profile.tenant_id IS DISTINCT FROM entity.tenant_id
       OR profile.organization_id IS DISTINCT FROM entity.organization_id);
```

Separately inspect profiles whose `entity_id` has no matching entity, and companies referencing a soft-deleted organization. Soft deletion after legitimate creation alone does not prove an ownership violation. Reconcile findings against trusted creation/audit history and the customer's intended tenant before planning any repair. Do not automatically reassign, delete, restore, or reindex suspect records. Any repair and downstream index/custom-field review requires a separately authorized maintenance plan, backup, and tenant-safe verification.

Regression coverage: registered command tests cover ownership, liveness, ACLs, hook-modified input, privileged selected tenant, system/worker compatibility and absence of writes/events/custom fields on denial. `TC-CRM-8675-company-organization-ownership.spec.ts` creates fresh tenants, organizations and callers, exercises the real POST endpoint, verifies both persisted scopes and rejection without company rows, successful audit operations or index rows, and checks existing restricted update/delete isolation.
