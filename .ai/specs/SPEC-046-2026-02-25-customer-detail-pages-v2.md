# SPEC-046 — Customer Detail Pages v2 (CrudForm Rewrite)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-25 |
| **Related** | SPEC-041 (UMES), SPEC-016 (Form Headers/Footers), SPEC-017 (Version History) |

## TLDR

**Key Points:**
- Rewrite company and person detail pages from per-field inline editors to CrudForm-based whole-document save
- Two-zone layout: CrudForm (Zone 1) for entity fields saved at once + Related Data Tabs (Zone 2) for notes, activities, deals, tasks saved independently
- 100% field coverage matching existing v1 pages
- Full UMES (SPEC-041) integration with standardized injection slots
- v2 pages coexist with v1 — menus/links updated to v2, API unchanged

**Scope:**
- New pages: `companies-v2/[id]`, `people-v2/[id]` (backend detail)
- Extended: `formConfig.tsx` with edit-mode schemas, fields, groups
- New: `CustomerFormHighlights.tsx` contentHeader component
- Modified: list page row click links, cross-module links
- New: 4 integration test files

**Concerns:**
- Transition from per-field to whole-document save changes UX behavior (no auto-save on blur)
- Related data sections (notes, activities) remain independent — not part of form save

---

## Overview

Current company and person detail pages use inline editors that save each field independently on blur. This approach:
- Prevents leveraging CrudForm capabilities (validation, custom fields auto-loading, version history, dirty tracking)
- Cannot support UMES field injection (Phase G triad pattern requires a CrudForm context)
- Creates inconsistent UX (no "Save" button, no undo for unsaved changes, no batch validation)

The v2 pages adopt the DealForm pattern: CrudForm with groups-based layout, contentHeader for summary/highlights, and separate related data tabs below the form. The user edits all entity fields and clicks a single "Save" button.

> **Reference Implementation**: `packages/core/src/modules/customers/components/detail/DealForm.tsx` — CrudForm with groups, entityIds, versionHistory, custom fields, and collectCustomFieldValues pattern.

> **Existing Create Pages**: `companies/create/page.tsx` and `people/create/page.tsx` already use CrudForm with the shared `formConfig.tsx`. The v2 detail pages extend this to edit mode.

---

## Problem Statement

### Current State

1. **Per-field inline saves**: Each field (displayName, primaryEmail, status, etc.) saves independently via `updateCompanyField('fieldName')` or `updateProfileField('fieldName')`. No batch save, no form-level validation.

2. **No UMES extension surface**: The inline editor pattern has no concept of form groups or field injection points. Third-party modules cannot add fields to the company/person detail page via UMES Phase G.

3. **Duplicated form logic**: Create pages already use CrudForm with `formConfig.tsx` (schemas, fields, groups, payload builders). Detail pages reimplement all the same fields as inline editors — two parallel implementations of the same fields.

4. **No version history on edit**: CrudForm supports `versionHistory` prop for undo/redo, but inline editors cannot leverage it for the entire document.

### Goal

Unify create and edit pages under the same CrudForm pattern, with:
- Whole-document save semantics
- UMES injection slots for third-party field injection
- Shared field/schema/group definitions between create and edit modes
- Version history support
- 100% field coverage (no field regression from v1)

---

## Proposed Solution

### High-Level Architecture

```
┌──────────────────────────────────────────────────────┐
│  Page Wrapper                                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ InjectionSpot: detail:customers.company:header │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ Zone 1: CrudForm (embedded=false)              │  │
│  │   title: company.displayName                    │  │
│  │   backHref: /backend/customers/companies        │  │
│  │   versionHistory: { resourceKind, resourceId }  │  │
│  │   injectionSpotId: customers.company            │  │
│  │   entityIds: [customer_entity, company_profile] │  │
│  │                                                  │  │
│  │   contentHeader: <CompanyHighlightsSummary />   │  │
│  │                                                  │  │
│  │   Groups:                                        │  │
│  │   ┌─ col 1 ──────────┐  ┌─ col 2 ──────────┐  │  │
│  │   │ "details"         │  │ "description"     │  │  │
│  │   │ displayName       │  │ description       │  │  │
│  │   │ primaryEmail      │  │                   │  │  │
│  │   │ primaryPhone      │  ├───────────────────┤  │  │
│  │   │ status            │  │ "tags"            │  │  │
│  │   │ lifecycleStage    │  │ (component group) │  │  │
│  │   │ source            │  │                   │  │  │
│  │   ├───────────────────┤  ├───────────────────┤  │  │
│  │   │ "profile"         │  │ "customFields"    │  │  │
│  │   │ legalName         │  │ (kind: custom)    │  │  │
│  │   │ brandName         │  │                   │  │  │
│  │   │ domain            │  │                   │  │  │
│  │   │ websiteUrl        │  │                   │  │  │
│  │   │ industry          │  │                   │  │  │
│  │   │ sizeBucket        │  │                   │  │  │
│  │   │ annualRevenue     │  │                   │  │  │
│  │   ├───────────────────┤  └───────────────────┘  │  │
│  │   │ "addresses"       │                          │  │
│  │   │ (component group) │                          │  │
│  │   └───────────────────┘                          │  │
│  │                                                  │  │
│  │   Footer: [Delete] [Cancel] [Save]              │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ Zone 2: Related Data Tabs (DetailTabsLayout)   │  │
│  │   [Notes] [Activities] [Deals] [People]        │  │
│  │   [Addresses] [Tasks] [+ injected tabs]        │  │
│  │                                                  │  │
│  │   Each tab: independent save, reuses existing   │  │
│  │   section components (NotesSection, etc.)       │  │
│  │                                                  │  │
│  │   InjectionSpot: detail:customers.company:tabs  │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ InjectionSpot: detail:customers.company:footer │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Page URL Structure

| Page | URL | navHidden |
|------|-----|-----------|
| Company v2 detail | `/backend/customers/companies-v2/[id]` | true |
| Person v2 detail | `/backend/customers/people-v2/[id]` | true |

Both use `navHidden: true` in `page.meta.ts` — they are reached via row click from list pages, not from the sidebar.

### Data Flow

```
1. Page loads → GET /api/customers/companies/{id}?include=todos&include=people
2. API returns CompanyOverview (company, profile, customFields, tags, comments, ...)
3. Page maps API response → CrudForm initialValues (flatten company + profile + cf_*)
4. User edits fields in CrudForm
5. User clicks Save → onSubmit(values)
6. onSubmit calls buildCompanyPayload(values) → PUT /api/customers/companies
7. On success: flash message, reload data
8. Related data tabs: independent CRUD (notes, activities, etc.) via their own APIs
```

---

## Company v2 — Complete Field Specification

### CrudForm Configuration

```typescript
<CrudForm<CompanyEditFormValues>
  title={data.company.displayName}
  backHref="/backend/customers/companies"
  versionHistory={{
    resourceKind: 'customers.company',
    resourceId: companyId,
    canUndoRedo: true,
  }}
  injectionSpotId="customers.company"
  entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
  schema={companyEditSchema}
  fields={companyEditFields}
  groups={companyEditGroups}
  initialValues={mappedInitialValues}
  contentHeader={<CompanyHighlightsSummary data={data} />}
  onSubmit={handleSubmit}
  onDelete={handleDelete}
/>
```

### Schema (Zod)

Extends `createCompanyFormSchema()` from `formConfig.tsx` with edit-mode additions:

```typescript
export const createCompanyEditSchema = () =>
  createCompanyFormSchema().extend({
    id: z.string().uuid(),
    // nextInteraction fields (added for edit mode)
    nextInteractionAt: z.string().datetime().optional().or(z.literal('')).transform(emptyToUndefined),
    nextInteractionName: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
  })
```

### Fields — Group "details" (column 1)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `displayName` | text | yes | full | Standard text input |
| `primaryEmail` | custom | no | half | `PrimaryEmailField` (duplicate check) |
| `primaryPhone` | custom | no | half | `PrimaryPhoneField` (PhoneNumberField) |
| `status` | custom | no | third | `DictionarySelectField` kind: "statuses" |
| `lifecycleStage` | custom | no | third | `DictionarySelectField` kind: "lifecycle-stages" |
| `source` | custom | no | third | `DictionarySelectField` kind: "sources" |

### Fields — Group "profile" (column 1)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `legalName` | text | no | half | Standard text input |
| `brandName` | text | no | half | Standard text input |
| `domain` | text | no | half | Standard text input, placeholder: "example.com" |
| `websiteUrl` | text | no | half | Standard text input, url validation |
| `industry` | custom | no | half | `DictionarySelectField` kind: "industries" |
| `sizeBucket` | text | no | half | Standard text input |
| `annualRevenue` | custom | no | half | `AnnualRevenueField` (amount + currency cf) |

### Fields — Group "description" (column 2)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `description` | textarea | no | full | Textarea, richtext editor option |

### Fields — Group "addresses" (column 1, component group)

| Field ID | Type | Component |
|----------|------|-----------|
| `addresses` | custom | `CustomerAddressTiles` (create/update/delete tiles) |

**Note**: Addresses in the CrudForm are part of the form state. On submit, new/modified addresses are persisted via separate `createCrud('customers/addresses', ...)` calls (same pattern as create page).

### Fields — Group "tags" (column 2, component group)

| Field ID | Type | Component |
|----------|------|-----------|
| (tags) | custom | `TagsSection` (existing component, wrapped in group component) |

**Note**: Tags are saved independently via their own API — the group component calls tag APIs directly, not through CrudForm submit.

### Fields — Group "customFields" (column 2, kind: 'customFields')

- Entity IDs: `[E.customers.customer_entity, E.customers.customer_company_profile]`
- Auto-loaded from custom field definitions
- Saved via `collectCustomFieldValues()` in onSubmit

### Related Data Tabs (Zone 2)

| Tab ID | Component | Props |
|--------|-----------|-------|
| `notes` | `NotesSection` | entity: company, deal select for linking |
| `activities` | `ActivitiesSection` | scope: company |
| `deals` | `DealsSection` | scope: { kind: 'company', entityId } |
| `people` | `CompanyPeopleSection` | people: data.people |
| `addresses` | `AddressesSection` | persisted addresses (separate from form addresses) |
| `tasks` | `TasksSection` | scope: company |

Plus injected tabs from widget system via `useInjectionWidgets('detail:customers.company:tabs')`.

### contentHeader: CompanyHighlightsSummary

A read-only summary card showing key metrics at the top of the form:
- Primary email (with mailto link)
- Primary phone
- Status badge (with color/icon)
- Next interaction (date + name)

This is display-only and updates after form save (re-fetched from API).

---

## Person v2 — Complete Field Specification

### CrudForm Configuration

```typescript
<CrudForm<PersonEditFormValues>
  title={data.person.displayName}
  backHref="/backend/customers/people"
  versionHistory={{
    resourceKind: 'customers.person',
    resourceId: personId,
    canUndoRedo: true,
  }}
  injectionSpotId="customers.person"
  entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
  schema={personEditSchema}
  fields={personEditFields}
  groups={personEditGroups}
  initialValues={mappedInitialValues}
  contentHeader={<PersonHighlightsSummary data={data} />}
  onSubmit={handleSubmit}
  onDelete={handleDelete}
/>
```

### Schema (Zod)

Extends `createPersonFormSchema()` with edit-mode additions:

```typescript
export const createPersonEditSchema = () =>
  createPersonFormSchema().extend({
    id: z.string().uuid(),
    department: z.string().trim().optional().or(z.literal('')).transform(emptyToUndefined),
    linkedInUrl: z.string().trim().url().optional().or(z.literal('')).transform(emptyToUndefined),
    twitterUrl: z.string().trim().url().optional().or(z.literal('')).transform(emptyToUndefined),
    nextInteractionAt: z.string().datetime().optional().or(z.literal('')).transform(emptyToUndefined),
    nextInteractionName: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
  })
```

### Fields — Group "details" (column 1, with DisplayNameSection component)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `displayName` | text | yes | full | Hidden in form, shown via DisplayNameSection group component |
| `firstName` | text | yes | half | Standard text input |
| `lastName` | text | yes | half | Standard text input |
| `primaryEmail` | custom | no | half | `PrimaryEmailField` (duplicate check) |
| `primaryPhone` | custom | no | half | `PrimaryPhoneField` (PhoneNumberField) |
| `companyEntityId` | custom | no | half | `CompanySelectField` (search + inline create) |
| `jobTitle` | custom | no | half | `DictionarySelectField` kind: "job-titles" |
| `status` | custom | no | third | `DictionarySelectField` kind: "statuses" |
| `lifecycleStage` | custom | no | third | `DictionarySelectField` kind: "lifecycle-stages" |
| `source` | custom | no | third | `DictionarySelectField` kind: "sources" |

**DisplayNameSection**: Group component renders a derived display name from firstName + lastName with manual override capability. Reuses `createDisplayNameSection(t)` from `formConfig.tsx`.

### Fields — Group "social" (column 1)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `department` | text | no | half | Standard text input |
| `linkedInUrl` | text | no | half | Standard text input, URL validation |
| `twitterUrl` | text | no | half | Standard text input, URL validation |

### Fields — Group "description" (column 2)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `description` | textarea | no | full | Textarea, richtext editor option |

### Fields — Group "addresses" (column 1, component group)

Same as company — `CustomerAddressTiles`.

### Fields — Group "tags" (column 2, component group)

Same as company — `TagsSection`.

### Fields — Group "customFields" (column 2, kind: 'customFields')

- Entity IDs: `[E.customers.customer_entity, E.customers.customer_person_profile]`

### Related Data Tabs (Zone 2)

| Tab ID | Component | Props |
|--------|-----------|-------|
| `notes` | `NotesSection` | entity: person, deal select |
| `activities` | `ActivitiesSection` | scope: person, defaultEntityId |
| `deals` | `DealsSection` | scope: { kind: 'person', entityId } |
| `addresses` | `AddressesSection` | persisted addresses |
| `tasks` | `TasksSection` | scope: person |

Plus injected tabs from `useInjectionWidgets('detail:customers.person:tabs')`.

---

## Shared formConfig.tsx Extensions

### New Exports for Edit Mode

| Export | Purpose |
|--------|---------|
| `createCompanyEditSchema()` | Zod schema for company edit (extends create schema + id, nextInteraction) |
| `createCompanyEditFields(t)` | Field array for company edit (extends create fields + industry dictionary, annualRevenue custom) |
| `createCompanyEditGroups(t)` | Group array for company edit (adds profile group, tags group) |
| `buildCompanyEditPayload(values, orgId)` | Payload builder (extends create payload + handles addresses diff) |
| `createPersonEditSchema()` | Zod schema for person edit |
| `createPersonEditFields(t)` | Field array for person edit (extends create fields + social fields) |
| `createPersonEditGroups(t)` | Group array for person edit (adds social group, tags group) |
| `buildPersonEditPayload(values, orgId)` | Payload builder for person edit |
| `mapCompanyOverviewToFormValues(overview)` | Maps API response → CrudForm initialValues |
| `mapPersonOverviewToFormValues(overview)` | Maps API response → CrudForm initialValues |

### Mapping API Response → Initial Values

**Company**:
```typescript
function mapCompanyOverviewToFormValues(overview: CompanyOverview): Partial<CompanyEditFormValues> {
  return {
    id: overview.company.id,
    displayName: overview.company.displayName,
    primaryEmail: overview.company.primaryEmail ?? '',
    primaryPhone: overview.company.primaryPhone ?? '',
    status: overview.company.status ?? '',
    lifecycleStage: overview.company.lifecycleStage ?? '',
    source: overview.company.source ?? '',
    description: overview.company.description ?? '',
    // Profile fields
    legalName: overview.profile?.legalName ?? '',
    brandName: overview.profile?.brandName ?? '',
    domain: overview.profile?.domain ?? '',
    websiteUrl: overview.profile?.websiteUrl ?? '',
    industry: overview.profile?.industry ?? '',
    sizeBucket: overview.profile?.sizeBucket ?? '',
    annualRevenue: overview.profile?.annualRevenue ?? '',
    // Addresses from API
    addresses: [], // Addresses are managed in Zone 2, not in the form
    // Custom fields (cf_* prefix)
    ...overview.customFields,
  }
}
```

**Person**:
```typescript
function mapPersonOverviewToFormValues(overview: PersonOverview): Partial<PersonEditFormValues> {
  return {
    id: overview.person.id,
    displayName: overview.person.displayName,
    firstName: overview.profile?.firstName ?? '',
    lastName: overview.profile?.lastName ?? '',
    primaryEmail: overview.person.primaryEmail ?? '',
    primaryPhone: overview.person.primaryPhone ?? '',
    companyEntityId: overview.profile?.companyEntityId ?? '',
    jobTitle: overview.profile?.jobTitle ?? '',
    status: overview.person.status ?? '',
    lifecycleStage: overview.person.lifecycleStage ?? '',
    source: overview.person.source ?? '',
    description: overview.person.description ?? '',
    department: overview.profile?.department ?? '',
    linkedInUrl: overview.profile?.linkedInUrl ?? '',
    twitterUrl: overview.profile?.twitterUrl ?? '',
    addresses: [],
    ...overview.customFields,
  }
}
```

---

## UMES Integration

### Injection Spot IDs

| Spot | Location | Purpose |
|------|----------|---------|
| `crud-form:customers.company:*` | CrudForm (auto-generated) | Field injection, before/after fields, header/footer/sidebar |
| `crud-form:customers.person:*` | CrudForm (auto-generated) | Same |
| `detail:customers.company:header` | Page wrapper | Above CrudForm |
| `detail:customers.company:tabs` | Zone 2 tabs area | Tab injection |
| `detail:customers.company:footer` | Page wrapper | Below all content |
| `detail:customers.company:status-badges` | Near status in header | Status indicator injection |
| `detail:customers.person:header` | Page wrapper | Above CrudForm |
| `detail:customers.person:tabs` | Zone 2 tabs area | Tab injection |
| `detail:customers.person:footer` | Page wrapper | Below all content |
| `detail:customers.person:status-badges` | Near status in header | Status indicator injection |

### Phase G — Field Injection (Triad Pattern)

Third-party modules can inject fields into any CrudForm group:

```
1. LOAD:   ResponseEnricher adds _loyalty.tier to GET /api/customers/companies/:id
2. RENDER: InjectionFieldWidget declares field { id: '_loyalty.tier', group: 'details', type: 'select' }
3. SAVE:   Widget onSave calls PUT /api/loyalty/customer-tiers/:id { tier: 'gold' }
```

The core `PUT /api/customers/companies` never receives `_loyalty.tier` — the widget handles its own persistence.

### Phase D — Response Enrichers

Enrichers declared in `data/enrichers.ts` of any module can add data to the company/person API response. The v2 page loads enriched data via the standard API call — enrichers run server-side.

---

## Files to Create

| File (relative to `packages/core/src/modules/customers/`) | Purpose |
|-----------------------------------------------------------|---------|
| `backend/customers/companies-v2/[id]/page.tsx` | Company v2 detail page |
| `backend/customers/companies-v2/[id]/page.meta.ts` | `{ navHidden: true, requireAuth: true, requireFeatures: ['customers.companies.view'] }` |
| `backend/customers/people-v2/[id]/page.tsx` | Person v2 detail page |
| `backend/customers/people-v2/[id]/page.meta.ts` | `{ navHidden: true, requireAuth: true, requireFeatures: ['customers.people.view'] }` |
| `components/detail/CustomerFormHighlights.tsx` | Shared highlights contentHeader |

## Files to Modify

| File | Change |
|------|--------|
| `components/formConfig.tsx` | Add edit-mode schemas, fields, groups, payload builders, mapping functions |
| `backend/customers/companies/page.tsx` | Row click href → `/backend/customers/companies-v2/${id}` |
| `backend/customers/people/page.tsx` | Row click href → `/backend/customers/people-v2/${id}` |
| `components/detail/CompanyPeopleSection.tsx` | People links → `/backend/customers/people-v2/${id}` |
| `components/detail/DealsSection.tsx` | Company/person links → v2 paths |

## Files NOT Modified (Backward Compatible)

| File | Reason |
|------|--------|
| `api/companies/route.ts` | API unchanged — same GET/PUT/POST/DELETE |
| `api/companies/[id]/route.ts` | API unchanged |
| `api/people/route.ts` | API unchanged |
| `api/people/[id]/route.ts` | API unchanged |
| `backend/customers/companies/[id]/page.tsx` | v1 page remains, still accessible via direct URL |
| `backend/customers/people/[id]/page.tsx` | v1 page remains |

---

## Integration Tests

### TC-CRM-V2-001: Company v2 — CRUD Fields

```
Setup: createCompanyFixture via API
Navigate: /backend/customers/companies-v2/{id}

Verify initial values:
  - displayName matches fixture
  - primaryEmail matches fixture
  - all fields render with correct values

Edit fields:
  - Change displayName
  - Change primaryEmail
  - Change status (via dictionary select)
  - Change legalName
  - Add description

Click Save:
  - Verify success flash message
  - Reload page
  - Verify all changed values persisted

Delete:
  - Click delete button
  - Confirm dialog
  - Verify redirect to list page

Cleanup: deleteEntityIfExists
```

### TC-CRM-V2-002: Person v2 — CRUD Fields

```
Setup: createPersonFixture via API
Navigate: /backend/customers/people-v2/{id}

Verify initial values:
  - firstName, lastName, displayName match
  - primaryEmail matches
  - companyEntityId shows linked company

Edit fields:
  - Change firstName, lastName
  - Verify displayName auto-derives
  - Change jobTitle (dictionary select)
  - Add linkedInUrl
  - Change status

Click Save → verify persistence → reload → verify values

Delete → confirm → verify redirect

Cleanup: deleteEntityIfExists
```

### TC-CRM-V2-003: Company v2 — Related Data Tabs

```
Setup: createCompanyFixture, login
Navigate: /backend/customers/companies-v2/{id}

Notes tab:
  - Add a note
  - Verify note appears
  - Tab does NOT trigger CrudForm dirty state

Activities tab:
  - Verify activities section renders

Deals tab:
  - Verify deals section renders

People tab:
  - Verify people section renders

Addresses tab:
  - Add an address
  - Verify address appears

Tasks tab:
  - Verify tasks section renders

Cleanup: delete fixtures
```

### TC-CRM-V2-004: Person v2 — Related Data Tabs

```
Same pattern as TC-CRM-V2-003 but for person:
  - Notes, Activities, Deals, Addresses, Tasks tabs
  - Verify each renders and operates independently
```

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users expect auto-save (v1 behavior) | Medium | Clear "Save" button UX, unsaved changes warning on navigate |
| Field regression (missing field in v2) | High | 100% field inventory in this spec, integration tests verify all fields |
| Cross-module links break | Medium | Grep all `/customers/companies/` and `/customers/people/` hrefs, update to v2 |
| Custom field save race condition | Low | collectCustomFieldValues() is synchronous; save is sequential |
| v1 pages still linked from bookmarks/external | Low | v1 pages remain accessible, consider future redirect |

---

## Final Compliance Report

- [ ] All fields from v1 pages are present in v2 spec
- [ ] CrudForm props match DealForm reference pattern
- [ ] UMES injection spots follow SPEC-041 naming convention
- [ ] Integration tests cover create, read, update, delete for both entities
- [ ] API endpoints unchanged (backward compatible)
- [ ] No new database migrations required
- [ ] formConfig.tsx reuses existing schemas/builders (DRY)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-25 | Initial draft |
