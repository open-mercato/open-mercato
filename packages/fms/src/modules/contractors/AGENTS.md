# FMS Contractors Module - Product Requirements Document

## Document Info

| Field | Value |
|-------|-------|
| Module ID | `fms_contractors` |
| Version | 1.1.0 |
| Status | Draft |
| Created | 2026-01-08 |
| Updated | 2026-01-08 |
| Author | Development Team |

---

## 1. Executive Summary

The FMS Contractors module is a critical core component designed to support B2B requirements in the freight management system. Unlike simple contractor records with basic names and labels, this module manages complex business relationships, financial risks, and multi-role partnerships.

### 1.1 Problem Statement

The existing contractor management is insufficient for B2B freight operations because:
- No support for branch-level specificity (MSC Poland vs MSC Netherlands settle differently)
- Cannot track multiple roles per contractor (a company can be both a carrier and an agent)
- No financial risk management (credit limits, payment terms)
- No structured contact person management
- No support for multiple addresses per contractor

### 1.2 Solution Overview

A standalone, shareable contractor entity that:
- Treats companies as primary entities with contact persons assigned to them
- Supports branch-level hierarchy for global entities
- Allows multiple categorized addresses (warehouse, office, billing)
- Enables multi-role tagging with role-specific data
- Manages payment terms and credit limits for B2B risk control
- Integrates with workflow for provider tracking and financial settlement

---

## 2. Goals and Non-Goals

### 2.1 Goals

1. **Comprehensive contractor identity management** - Store company information with branch hierarchy support
2. **Multi-role flexibility** - Allow contractors to hold multiple simultaneous roles across trading, carrier, intermediary, facility, and support categories
3. **Contact person management** - Track individuals associated with each contractor company
4. **Address management** - Support multiple categorized addresses per contractor
5. **Financial terms configuration** - Define default payment terms and credit limits
6. **Credit exposure tracking** - Calculate and monitor financial exposure per contractor
7. **Role-based access control integration** - Contractor roles determine data visibility
8. **Extensibility** - Support user-defined custom fields per role type

### 2.2 Non-Goals (Out of Scope for v1.0)

1. ~~Automated credit limit enforcement with booking blocks~~ - Notification only, human decision required
2. ~~Real-time credit exposure calculation~~ - Batch/on-demand calculation acceptable
3. ~~Full finance module integration~~ - Tax data and bank accounts added incrementally
4. ~~Contractor self-service portal~~ - Admin-managed only
5. ~~Document management~~ - Certificates, contracts stored elsewhere
6. ~~Rating/scoring system~~ - Future enhancement

---

## 3. User Stories

### 3.1 Contractor Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-001 | Operations Manager | Create a new contractor with company details | I can track business relationships |
| US-002 | Operations Manager | Specify if a contractor is a branch of another company | I can understand corporate hierarchies |
| US-003 | Operations Manager | Add multiple addresses with types (office, warehouse, billing) | I can use the correct address for each purpose |
| US-004 | Operations Manager | Add contact persons to a contractor | I know who to communicate with |
| US-005 | Operations Manager | Mark a primary contact and primary address | I have defaults for quick operations |
| US-006 | Operations Manager | Deactivate a contractor without deleting | I preserve history while preventing new transactions |

### 3.2 Role Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-010 | Admin | Define available contractor role types organized by category | I can categorize contractors consistently |
| US-011 | Operations Manager | Assign multiple roles to a single contractor | I can reflect that MSC is both a carrier and an agent |
| US-012 | Operations Manager | Set role-specific data per assignment | I can track carrier-specific fields for carrier role only |
| US-013 | Admin | Define custom fields per role type | Users can capture role-specific information |
| US-014 | Operations Manager | Set effective dates on role assignments | I can track when a contractor started/stopped a role |
| US-015 | Operations Manager | Filter contractors by role category | I can quickly find all carriers or all trading parties |

### 3.3 Financial Management

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-020 | Finance Manager | Set default payment terms for a contractor | Invoices automatically use correct terms |
| US-021 | Finance Manager | Set a credit limit for a contractor | I can manage financial risk exposure |
| US-022 | Finance Manager | View current credit exposure | I know how much risk we have with this contractor |
| US-023 | Finance Manager | Be notified when a booking would exceed credit limit | I can make an informed business decision |
| US-024 | Finance Manager | Store bank account details securely | I can process payments correctly |

### 3.4 Search and Filtering

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-030 | User | Search contractors by name, code, or tax ID | I can quickly find the contractor I need |
| US-031 | User | Filter contractors by role type or role category | I can see all carriers or all agents |
| US-032 | User | Filter contractors by active/inactive status | I can focus on current business partners |
| US-033 | User | View contractor hierarchy (parent/branches) | I understand the corporate structure |

---

## 4. Functional Requirements

### 4.1 Contractor Entity

#### 4.1.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Official company/branch name |
| `shortName` | string | No | Display abbreviation |
| `code` | string | No | Internal reference code (unique per org) |
| `parentId` | UUID | No | Reference to parent contractor (for branches) |
| `taxId` | string | No | VAT/Tax identification number |
| `legalName` | string | No | Full legal entity name |
| `registrationNumber` | string | No | Business registration number |
| `isActive` | boolean | Yes | Active status flag (default: true) |

#### 4.1.2 Business Rules

- `code` must be unique within organization if provided
- `parentId` cannot create circular references
- Deactivating a parent should warn about active children
- `taxId` format validation based on country (future enhancement)

### 4.2 Address Entity

#### 4.2.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `purpose` | enum | Yes | Type: `office`, `warehouse`, `billing`, `shipping`, `other` |
| `label` | string | No | User-friendly name (e.g., "Main Warehouse") |
| `addressLine1` | string | Yes | Street address line 1 |
| `addressLine2` | string | No | Street address line 2 |
| `city` | string | Yes | City name |
| `state` | string | No | State/Province/Region |
| `postalCode` | string | No | Postal/ZIP code |
| `countryCode` | string | Yes | ISO 3166-1 alpha-2 country code |
| `isPrimary` | boolean | Yes | Primary address flag (default: false) |
| `isActive` | boolean | Yes | Active status (default: true) |

#### 4.2.2 Business Rules

- Only one address per purpose can be marked as primary
- At least one address required when contractor is activated (soft validation)
- Country code must be valid ISO 3166-1 alpha-2

### 4.3 Contact Entity

#### 4.3.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `firstName` | string | Yes | Contact's first name |
| `lastName` | string | Yes | Contact's last name |
| `jobTitle` | string | No | Position/title |
| `department` | string | No | Department name |
| `email` | string | No | Email address |
| `phone` | string | No | Office phone |
| `mobile` | string | No | Mobile phone |
| `isPrimary` | boolean | Yes | Primary contact flag (default: false) |
| `isActive` | boolean | Yes | Active status (default: true) |
| `notes` | string | No | Internal notes about contact |

#### 4.3.2 Business Rules

- Only one contact can be marked as primary per contractor
- Email format validation when provided
- At least one contact recommended when contractor is activated (soft validation)

### 4.4 Role Type Entity (Dictionary)

#### 4.4.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Unique identifier (e.g., `carrier`, `agent`) |
| `name` | string | Yes | Display name |
| `category` | enum | Yes | Role category (see 4.4.2) |
| `description` | string | No | Role description |
| `color` | string | No | UI badge color |
| `icon` | string | No | UI icon identifier |
| `hasCustomFields` | boolean | Yes | Whether this role supports custom fields |
| `sortOrder` | integer | Yes | Display ordering |
| `isSystem` | boolean | Yes | System-defined vs user-created |
| `isActive` | boolean | Yes | Active status |

#### 4.4.2 Role Categories

Roles are organized into logical categories for better UX and filtering:

| Category Code | Category Name | Description |
|---------------|---------------|-------------|
| `trading` | Trading Parties | Parties involved in buying/selling goods |
| `carrier` | Carriers | Transportation service providers by mode |
| `intermediary` | Intermediaries | Agents, brokers, forwarders |
| `facility` | Facility Operators | Terminals, warehouses, depots |
| `support` | Support Services | Insurance, banking, inspection |

#### 4.4.3 Default Role Types

##### Category: Trading Parties (`trading`)

| Code | Name | Description |
|------|------|-------------|
| `client` | Client | Customer who requests services, Beneficial Cargo Owner (BCO) |
| `shipper` | Shipper | Party responsible for shipping goods (consignor/exporter) |
| `consignee` | Consignee | Party receiving goods (importer/buyer) |
| `notify_party` | Notify Party | Party to be notified on cargo arrival |
| `manufacturer` | Manufacturer | Product maker (required by customs) |

##### Category: Carriers (`carrier`)

| Code | Name | Description |
|------|------|-------------|
| `shipping_line` | Shipping Line | Ocean carrier, Vessel Operating Common Carrier (VOCC) |
| `airline` | Airline | Air cargo carrier |
| `trucking_company` | Trucking Company | Road haulage/transport provider |
| `rail_operator` | Rail Operator | Rail freight operator |
| `nvocc` | NVOCC | Non-Vessel Operating Common Carrier, issues own B/L |
| `carrier` | Carrier | Generic/multimodal carrier |

##### Category: Intermediaries (`intermediary`)

| Code | Name | Description |
|------|------|-------------|
| `forwarder` | Freight Forwarder | Arranges and coordinates shipments |
| `customs_broker` | Customs Broker | Handles customs clearance and documentation |
| `agent` | Agent | General intermediary/representative |
| `origin_agent` | Origin Agent | Agent at origin port/location |
| `destination_agent` | Destination Agent | Agent at destination port/location |
| `lsp` | LSP | Logistics Service Provider / 3PL |
| `freight_broker` | Freight Broker | Connects shippers with carriers |
| `coloader` | Coloader | Partner forwarder for co-loading/consolidation |

##### Category: Facility Operators (`facility`)

| Code | Name | Description |
|------|------|-------------|
| `terminal` | Terminal | Port/airport terminal operator |
| `warehouse` | Warehouse | Storage facility operator |
| `container_depot` | Container Depot | Empty container storage/maintenance yard |
| `cfs` | CFS | Container Freight Station operator |

##### Category: Support Services (`support`)

| Code | Name | Description |
|------|------|-------------|
| `insurance_provider` | Insurance Provider | Cargo/marine insurance company |
| `surveyor` | Surveyor | Cargo inspection/damage assessment |
| `fumigation_provider` | Fumigation Provider | Pest control/treatment services |
| `packing_company` | Packing Company | Export packing services |
| `bank` | Bank | Trade finance, LC issuing/advising |

### 4.5 Role Assignment Entity

#### 4.5.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractorId` | UUID | Yes | Reference to contractor |
| `roleTypeId` | UUID | Yes | Reference to role type |
| `settings` | JSONB | No | Role-specific configuration |
| `isActive` | boolean | Yes | Active status |
| `effectiveFrom` | date | No | Start date of role |
| `effectiveTo` | date | No | End date of role |

#### 4.5.2 Business Rules

- Unique constraint on (contractor, roleType) combination
- `effectiveTo` must be after `effectiveFrom` if both provided
- Role-specific custom fields stored via Custom Fields system

### 4.6 Payment Terms Entity

#### 4.6.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentDays` | integer | Yes | Net payment days (7, 30, 45, 60, etc.) |
| `paymentMethod` | string | No | Preferred method: `bank_transfer`, `card`, `cash` |
| `currencyCode` | string | Yes | Default currency (ISO 4217) |
| `bankName` | string | No | Bank name (encrypted) |
| `bankAccountNumber` | string | No | Account number (encrypted) |
| `bankRoutingNumber` | string | No | Routing/sort code (encrypted) |
| `iban` | string | No | IBAN (encrypted) |
| `swiftBic` | string | No | SWIFT/BIC code (encrypted) |
| `notes` | string | No | Additional payment instructions |

#### 4.6.2 Business Rules

- One payment terms record per contractor (OneToOne)
- Bank details encrypted at rest
- Currency code must be valid ISO 4217

### 4.7 Credit Limit Entity

#### 4.7.1 Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `creditLimit` | decimal(18,2) | Yes | Maximum credit exposure allowed |
| `currencyCode` | string | Yes | Credit limit currency |
| `isUnlimited` | boolean | Yes | Bypass credit limit checks |
| `currentExposure` | decimal(18,2) | Yes | Calculated current exposure |
| `lastCalculatedAt` | timestamp | No | When exposure was last calculated |
| `requiresApprovalAbove` | decimal(18,2) | No | Threshold for manager approval |
| `approvedById` | UUID | No | User who approved current limit |
| `approvedAt` | timestamp | No | When limit was approved |
| `notes` | string | No | Approval notes |

#### 4.7.2 Business Rules

- One credit limit record per contractor (OneToOne)
- `currentExposure` = sum of open files + invoiced but unpaid amounts
- Exposure calculation triggered on-demand or by scheduled job
- When `isUnlimited = true`, credit checks are bypassed

#### 4.7.3 Credit Exposure Calculation

```
Current Exposure =
  SUM(value of files in service) +
  SUM(value of invoiced but unpaid files)
```

---

## 5. Data Model

### 5.1 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     fms_contractors                              │
│─────────────────────────────────────────────────────────────────│
│ PK  id: uuid                                                    │
│     organization_id: uuid                                       │
│     tenant_id: uuid                                             │
│     name: text                                                  │
│     short_name: text?                                           │
│     code: text?                                                 │
│ FK  parent_id: uuid? ──────────────────────┐ (self-reference)   │
│     tax_id: text?                          │                    │
│     legal_name: text?                      │                    │
│     registration_number: text?             │                    │
│     is_active: boolean                     │                    │
│     created_at: timestamp                  │                    │
│     updated_at: timestamp                  │                    │
│     deleted_at: timestamp?                 │                    │
└──────────────────────┬─────────────────────┘                    │
                       │                                          │
                       │ (1:N)                                    │
       ┌───────────────┼───────────────┬───────────────┐          │
       │               │               │               │          │
       ▼               ▼               ▼               ▼          │
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  addresses   │ │   contacts   │ │    roles     │ │payment_terms │
│──────────────│ │──────────────│ │──────────────│ │──────────────│
│ purpose      │ │ first_name   │ │FK role_type  │ │ payment_days │
│ label        │ │ last_name    │ │ settings     │ │ currency     │
│ address_line1│ │ job_title    │ │ effective_*  │ │ bank_* (enc) │
│ city         │ │ email        │ │ is_active    │ │              │
│ country_code │ │ phone        │ │              │ │              │
│ is_primary   │ │ is_primary   │ │              │ │              │
└──────────────┘ └──────────────┘ └──────┬───────┘ └──────────────┘
                                         │
                                         │ (N:1)
                                         ▼
                              ┌────────────────────┐
                              │    role_types      │
                              │────────────────────│
                              │ code               │
                              │ name               │
                              │ category           │
                              │ has_custom_fields  │
                              │ is_system          │
                              │ sort_order         │
                              └────────────────────┘

┌──────────────┐
│credit_limits │ (1:1 with contractors)
│──────────────│
│ credit_limit │
│ currency     │
│ is_unlimited │
│ current_     │
│   exposure   │
│ requires_    │
│   approval   │
└──────────────┘
```

### 5.2 Table Names

| Entity | Table Name |
|--------|------------|
| Contractor | `fms_contractors` |
| Address | `fms_contractor_addresses` |
| Contact | `fms_contractor_contacts` |
| Role Type | `fms_contractor_role_types` |
| Role Assignment | `fms_contractor_roles` |
| Payment Terms | `fms_contractor_payment_terms` |
| Credit Limit | `fms_contractor_credit_limits` |

### 5.3 Indexes

| Table | Index | Columns | Condition |
|-------|-------|---------|-----------|
| fms_contractors | Primary lookup | `tenant_id, organization_id, id` | `deleted_at IS NULL` |
| fms_contractors | Code unique | `tenant_id, organization_id, code` | `deleted_at IS NULL AND code IS NOT NULL` |
| fms_contractors | Parent lookup | `parent_id` | - |
| fms_contractor_roles | Role type filter | `tenant_id, organization_id, role_type_id` | `is_active = true` |
| fms_contractor_role_types | Category filter | `tenant_id, organization_id, category` | `is_active = true` |

---

## 6. API Endpoints

### 6.1 Contractor CRUD

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fms-contractors` | List contractors (paginated, filterable) |
| GET | `/api/fms-contractors/:id` | Get contractor details |
| POST | `/api/fms-contractors` | Create contractor |
| PATCH | `/api/fms-contractors/:id` | Update contractor |
| DELETE | `/api/fms-contractors/:id` | Soft delete contractor |

### 6.2 Nested Resources

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fms-contractors/:id/addresses` | List addresses |
| POST | `/api/fms-contractors/:id/addresses` | Add address |
| PATCH | `/api/fms-contractors/:id/addresses/:addressId` | Update address |
| DELETE | `/api/fms-contractors/:id/addresses/:addressId` | Remove address |
| GET | `/api/fms-contractors/:id/contacts` | List contacts |
| POST | `/api/fms-contractors/:id/contacts` | Add contact |
| PATCH | `/api/fms-contractors/:id/contacts/:contactId` | Update contact |
| DELETE | `/api/fms-contractors/:id/contacts/:contactId` | Remove contact |
| GET | `/api/fms-contractors/:id/roles` | List role assignments |
| POST | `/api/fms-contractors/:id/roles` | Assign role |
| PATCH | `/api/fms-contractors/:id/roles/:roleId` | Update role assignment |
| DELETE | `/api/fms-contractors/:id/roles/:roleId` | Remove role |

### 6.3 Financial Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fms-contractors/:id/payment-terms` | Get payment terms |
| PUT | `/api/fms-contractors/:id/payment-terms` | Set/update payment terms |
| GET | `/api/fms-contractors/:id/credit-limit` | Get credit limit config |
| PUT | `/api/fms-contractors/:id/credit-limit` | Set/update credit limit |
| POST | `/api/fms-contractors/:id/credit-limit/recalculate` | Trigger exposure recalculation |

### 6.4 Role Types (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fms-contractor-role-types` | List role types |
| GET | `/api/fms-contractor-role-types?category=carrier` | List role types by category |
| POST | `/api/fms-contractor-role-types` | Create role type |
| PATCH | `/api/fms-contractor-role-types/:id` | Update role type |
| DELETE | `/api/fms-contractor-role-types/:id` | Delete role type (if not system) |

---

## 7. UI/UX Requirements

### 7.1 Backend Pages

| Path | Description |
|------|-------------|
| `/backend/fms-contractors` | Contractor list with filters |
| `/backend/fms-contractors/new` | Create contractor form |
| `/backend/fms-contractors/:id` | Contractor detail/edit page |
| `/backend/fms-contractors/:id/addresses` | Address management tab |
| `/backend/fms-contractors/:id/contacts` | Contact management tab |
| `/backend/fms-contractors/:id/roles` | Role management tab |
| `/backend/fms-contractors/:id/financial` | Payment terms & credit limit tab |
| `/backend/admin/fms-contractor-role-types` | Role type administration |

### 7.2 List View Implementation

The contractors list uses the **DataTable** component from `@open-mercato/ui/backend/DataTable`.

#### 7.2.1 Column Definitions

```typescript
const columns: ColumnDef<ContractorRow>[] = [
  {
    accessorKey: 'name',
    header: t('fms_contractors.list.columns.name'),
    cell: ({ row }) => (
      <Link href={`/backend/fms-contractors/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'code',
    header: t('fms_contractors.list.columns.code'),
    cell: ({ row }) => row.original.code || noValue,
  },
  {
    accessorKey: 'roles',
    header: t('fms_contractors.list.columns.roles'),
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.roles?.map((role) => (
          <Badge key={role.code} variant="outline" style={{ borderColor: role.color }}>
            {role.name}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    accessorKey: 'primaryContact',
    header: t('fms_contractors.list.columns.primaryContact'),
    cell: ({ row }) => row.original.primaryContactName || noValue,
  },
  {
    accessorKey: 'country',
    header: t('fms_contractors.list.columns.country'),
    cell: ({ row }) => row.original.primaryAddressCountry || noValue,
  },
  {
    accessorKey: 'creditLimit',
    header: t('fms_contractors.list.columns.creditLimit'),
    cell: ({ row }) => {
      if (row.original.isUnlimitedCredit) return <Badge variant="secondary">Unlimited</Badge>
      if (!row.original.creditLimit) return noValue
      return formatCurrency(row.original.creditLimit, row.original.creditCurrency)
    },
  },
  {
    accessorKey: 'currentExposure',
    header: t('fms_contractors.list.columns.exposure'),
    cell: ({ row }) => {
      const exposure = row.original.currentExposure
      const limit = row.original.creditLimit
      if (!exposure) return noValue
      const isOverLimit = limit && parseFloat(exposure) > parseFloat(limit)
      return (
        <span className={isOverLimit ? 'text-destructive font-medium' : ''}>
          {formatCurrency(exposure, row.original.creditCurrency)}
        </span>
      )
    },
  },
  {
    accessorKey: 'isActive',
    header: t('fms_contractors.list.columns.status'),
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
        {row.original.isActive ? 'Active' : 'Inactive'}
      </Badge>
    ),
  },
]
```

#### 7.2.2 Filter Definitions

```typescript
const filters: FilterDef[] = [
  {
    id: 'roleCategory',
    label: t('fms_contractors.list.filters.roleCategory'),
    type: 'select',
    options: [
      { value: 'trading', label: 'Trading Parties' },
      { value: 'carrier', label: 'Carriers' },
      { value: 'intermediary', label: 'Intermediaries' },
      { value: 'facility', label: 'Facility Operators' },
      { value: 'support', label: 'Support Services' },
    ],
  },
  {
    id: 'roleType',
    label: t('fms_contractors.list.filters.roleType'),
    type: 'select',
    loadOptions: loadRoleTypeOptions, // Async load from API
  },
  {
    id: 'isActive',
    label: t('fms_contractors.list.filters.status'),
    type: 'select',
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
  },
  {
    id: 'country',
    label: t('fms_contractors.list.filters.country'),
    type: 'select',
    loadOptions: loadCountryOptions,
  },
  {
    id: 'hasParent',
    label: t('fms_contractors.list.filters.isBranch'),
    type: 'checkbox',
  },
  {
    id: 'creditExceeded',
    label: t('fms_contractors.list.filters.creditExceeded'),
    type: 'checkbox',
  },
  {
    id: 'createdAt',
    label: t('fms_contractors.list.filters.createdAt'),
    type: 'dateRange',
  },
]
```

#### 7.2.3 DataTable Usage

```tsx
<DataTable<ContractorRow>
  title={t('fms_contractors.list.title')}
  columns={columns}
  data={rows}

  // Search
  searchValue={search}
  onSearchChange={(value) => { setSearch(value); setPage(1) }}
  searchPlaceholder={t('fms_contractors.list.searchPlaceholder')}

  // Filters
  filters={filters}
  filterValues={filterValues}
  onFiltersApply={handleFiltersApply}
  onFiltersClear={handleFiltersClear}

  // Custom fields support
  entityIds={[E.fms_contractors.fms_contractor]}

  // Pagination
  pagination={{
    page,
    pageSize,
    total,
    totalPages,
    onPageChange: setPage,
    cacheStatus,
  }}

  // Row interactions
  onRowClick={(row) => router.push(`/backend/fms-contractors/${row.id}`)}
  rowActions={(row) => (
    <RowActions
      items={[
        {
          label: t('fms_contractors.list.actions.view'),
          onSelect: () => router.push(`/backend/fms-contractors/${row.id}`),
        },
        {
          label: t('fms_contractors.list.actions.edit'),
          onSelect: () => router.push(`/backend/fms-contractors/${row.id}/edit`),
        },
        {
          label: row.isActive
            ? t('fms_contractors.list.actions.deactivate')
            : t('fms_contractors.list.actions.activate'),
          onSelect: () => handleToggleActive(row),
        },
        {
          label: t('fms_contractors.list.actions.delete'),
          destructive: true,
          onSelect: () => handleDelete(row),
        },
      ]}
    />
  )}

  // Export
  exporter={{
    view: {
      getUrl: (format) => buildCrudExportUrl('fms-contractors', currentParams, format),
    },
    full: {
      getUrl: (format) => buildCrudExportUrl('fms-contractors', { ...currentParams, all: 'true' }, format),
    },
  }}

  // Perspectives (saved views)
  perspective={{ tableId: 'fms_contractors.list' }}

  // Actions
  actions={(
    <Button asChild>
      <Link href="/backend/fms-contractors/new">
        {t('fms_contractors.list.actions.new')}
      </Link>
    </Button>
  )}

  // Refresh
  refreshButton={{
    label: t('fms_contractors.list.actions.refresh'),
    onRefresh: handleRefresh,
  }}

  isLoading={isLoading}
/>
```

### 7.3 Detail View Tabs

1. **Overview** - Basic info, hierarchy visualization, quick role badges
2. **Addresses** - Address list with add/edit/delete (embedded DataTable)
3. **Contacts** - Contact list with add/edit/delete (embedded DataTable)
4. **Roles** - Role assignments grouped by category with custom fields per role
5. **Financial** - Payment terms, bank details, credit limit with exposure visualization

#### 7.3.1 Embedded Tables for Addresses/Contacts

```tsx
<DataTable<AddressRow>
  columns={addressColumns}
  data={addresses}
  embedded={true}
  rowActions={(row) => (
    <RowActions items={[
      { label: 'Edit', onSelect: () => openAddressDialog(row) },
      { label: 'Set Primary', onSelect: () => handleSetPrimary(row), disabled: row.isPrimary },
      { label: 'Delete', destructive: true, onSelect: () => handleDeleteAddress(row) },
    ]} />
  )}
  actions={(
    <Button size="sm" onClick={() => openAddressDialog()}>
      Add Address
    </Button>
  )}
/>
```

### 7.4 Role Assignment UI

- Roles displayed grouped by category (Trading, Carriers, Intermediaries, Facilities, Support)
- Toggle switches to assign/unassign roles
- Expandable sections for role-specific custom fields (when `hasCustomFields = true`)
- Visual badges showing active roles on contractor cards
- Effective date pickers for role assignments

```tsx
// Role assignment card structure
<Card>
  <CardHeader>
    <CardTitle>Carriers</CardTitle>
  </CardHeader>
  <CardContent>
    {carrierRoles.map((roleType) => (
      <div key={roleType.id} className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Badge style={{ backgroundColor: roleType.color }}>{roleType.name}</Badge>
          <span className="text-sm text-muted-foreground">{roleType.description}</span>
        </div>
        <Switch
          checked={isRoleAssigned(roleType.id)}
          onCheckedChange={(checked) => handleRoleToggle(roleType.id, checked)}
        />
      </div>
    ))}
  </CardContent>
</Card>
```

### 7.5 Credit Limit Visualization

```tsx
// Credit exposure gauge component
<div className="space-y-2">
  <div className="flex justify-between text-sm">
    <span>Current Exposure</span>
    <span className={isOverLimit ? 'text-destructive' : ''}>
      {formatCurrency(currentExposure)} / {formatCurrency(creditLimit)}
    </span>
  </div>
  <Progress
    value={exposurePercentage}
    className={exposurePercentage > 100 ? 'bg-destructive/20' : ''}
  />
  {isOverLimit && (
    <Alert variant="destructive">
      <AlertDescription>
        Credit limit exceeded by {formatCurrency(currentExposure - creditLimit)}
      </AlertDescription>
    </Alert>
  )}
</div>
```

### 7.6 Drawer-Based Detail View

When users click on specific columns in the contractors list, a drawer opens showing detailed, editable data in tabular format.

#### 7.6.1 Clickable Column Mapping

| Column Clicked | Drawer Content | Editable |
|----------------|----------------|----------|
| Name | Contractor overview + basic info form | Yes |
| Roles | Role assignments table grouped by category | Yes |
| Primary Contact | All contacts table | Yes |
| Country | All addresses table | Yes |
| Credit Limit | Financial details (payment terms + credit) | Yes |
| Current Exposure | Credit exposure breakdown table | View only |

#### 7.6.2 Drawer Component Structure

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'

// Main list with drawer
const [drawerOpen, setDrawerOpen] = useState(false)
const [drawerType, setDrawerType] = useState<DrawerType | null>(null)
const [selectedContractor, setSelectedContractor] = useState<ContractorRow | null>(null)

type DrawerType = 'overview' | 'roles' | 'contacts' | 'addresses' | 'financial' | 'exposure'

// Column click handler
const handleColumnClick = (row: ContractorRow, columnId: string) => {
  setSelectedContractor(row)

  const columnToDrawer: Record<string, DrawerType> = {
    name: 'overview',
    roles: 'roles',
    primaryContact: 'contacts',
    country: 'addresses',
    creditLimit: 'financial',
    currentExposure: 'exposure',
  }

  const drawerType = columnToDrawer[columnId]
  if (drawerType) {
    setDrawerType(drawerType)
    setDrawerOpen(true)
  }
}

// Drawer component
<Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
  <SheetContent className="w-[600px] sm:max-w-[600px]">
    <SheetHeader>
      <SheetTitle>{selectedContractor?.name} - {drawerTitles[drawerType]}</SheetTitle>
    </SheetHeader>
    <div className="mt-6">
      {drawerType === 'contacts' && <ContactsDrawerContent contractor={selectedContractor} />}
      {drawerType === 'addresses' && <AddressesDrawerContent contractor={selectedContractor} />}
      {drawerType === 'roles' && <RolesDrawerContent contractor={selectedContractor} />}
      {drawerType === 'financial' && <FinancialDrawerContent contractor={selectedContractor} />}
      {drawerType === 'exposure' && <ExposureDrawerContent contractor={selectedContractor} />}
      {drawerType === 'overview' && <OverviewDrawerContent contractor={selectedContractor} />}
    </div>
  </SheetContent>
</Sheet>
```

#### 7.6.3 Contacts Drawer Content

```tsx
function ContactsDrawerContent({ contractor }: { contractor: ContractorRow }) {
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const contactColumns: ColumnDef<ContactRow>[] = [
    {
      accessorKey: 'firstName',
      header: 'First Name',
      cell: ({ row }) => editingId === row.original.id
        ? <Input value={row.original.firstName} onChange={...} />
        : row.original.firstName,
    },
    {
      accessorKey: 'lastName',
      header: 'Last Name',
      cell: ({ row }) => editingId === row.original.id
        ? <Input value={row.original.lastName} onChange={...} />
        : row.original.lastName,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => editingId === row.original.id
        ? <Input type="email" value={row.original.email} onChange={...} />
        : row.original.email,
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      cell: ({ row }) => editingId === row.original.id
        ? <Input value={row.original.phone} onChange={...} />
        : row.original.phone,
    },
    {
      accessorKey: 'jobTitle',
      header: 'Job Title',
    },
    {
      accessorKey: 'isPrimary',
      header: 'Primary',
      cell: ({ row }) => (
        <Checkbox
          checked={row.original.isPrimary}
          onCheckedChange={(checked) => handleSetPrimary(row.original.id, checked)}
        />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <DataTable<ContactRow>
        columns={contactColumns}
        data={contacts}
        embedded={true}
        rowActions={(row) => (
          <RowActions items={[
            {
              label: editingId === row.id ? 'Save' : 'Edit',
              onSelect: () => editingId === row.id ? handleSave(row) : setEditingId(row.id)
            },
            {
              label: 'Cancel',
              onSelect: () => setEditingId(null),
              hidden: editingId !== row.id,
            },
            { label: 'Delete', destructive: true, onSelect: () => handleDelete(row) },
          ]} />
        )}
        actions={<Button size="sm" onClick={handleAddContact}>Add Contact</Button>}
      />
    </div>
  )
}
```

#### 7.6.4 Addresses Drawer Content

```tsx
function AddressesDrawerContent({ contractor }: { contractor: ContractorRow }) {
  const addressColumns: ColumnDef<AddressRow>[] = [
    {
      accessorKey: 'purpose',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.purpose}</Badge>
      ),
    },
    {
      accessorKey: 'label',
      header: 'Label',
    },
    {
      accessorKey: 'addressLine1',
      header: 'Address',
      cell: ({ row }) => (
        <div className="text-sm">
          <div>{row.original.addressLine1}</div>
          {row.original.addressLine2 && <div>{row.original.addressLine2}</div>}
          <div className="text-muted-foreground">
            {row.original.city}, {row.original.state} {row.original.postalCode}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'countryCode',
      header: 'Country',
      cell: ({ row }) => <CountryFlag code={row.original.countryCode} />,
    },
    {
      accessorKey: 'isPrimary',
      header: 'Primary',
      cell: ({ row }) => row.original.isPrimary && <Badge>Primary</Badge>,
    },
  ]

  return (
    <div className="space-y-4">
      <DataTable<AddressRow>
        columns={addressColumns}
        data={addresses}
        embedded={true}
        rowActions={(row) => (
          <RowActions items={[
            { label: 'Edit', onSelect: () => openAddressDialog(row) },
            { label: 'Set Primary', onSelect: () => handleSetPrimary(row), disabled: row.isPrimary },
            { label: 'Delete', destructive: true, onSelect: () => handleDelete(row) },
          ]} />
        )}
        actions={<Button size="sm" onClick={() => openAddressDialog()}>Add Address</Button>}
      />

      {/* Address Edit Dialog */}
      <AddressFormDialog
        open={dialogOpen}
        address={editingAddress}
        onSave={handleSaveAddress}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}
```

#### 7.6.5 Roles Drawer Content

```tsx
function RolesDrawerContent({ contractor }: { contractor: ContractorRow }) {
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([])
  const [roleTypes, setRoleTypes] = useState<RoleType[]>([])

  // Group role types by category
  const rolesByCategory = useMemo(() => {
    return roleTypes.reduce((acc, role) => {
      const category = role.category
      if (!acc[category]) acc[category] = []
      acc[category].push(role)
      return acc
    }, {} as Record<string, RoleType[]>)
  }, [roleTypes])

  const categoryLabels: Record<string, string> = {
    trading: 'Trading Parties',
    carrier: 'Carriers',
    intermediary: 'Intermediaries',
    facility: 'Facility Operators',
    support: 'Support Services',
  }

  return (
    <div className="space-y-6">
      {Object.entries(rolesByCategory).map(([category, roles]) => (
        <Card key={category}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium">{categoryLabels[category]}</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((roleType) => {
                  const assignment = roleAssignments.find(a => a.roleTypeId === roleType.id)
                  return (
                    <TableRow key={roleType.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: roleType.color }}
                          />
                          <span className="font-medium">{roleType.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{roleType.description}</span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={!!assignment?.isActive}
                          onCheckedChange={(checked) => handleRoleToggle(roleType.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        {assignment && (
                          <DatePicker
                            value={assignment.effectiveFrom}
                            onChange={(date) => handleUpdateAssignment(assignment.id, { effectiveFrom: date })}
                            disabled={!assignment.isActive}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {assignment && (
                          <DatePicker
                            value={assignment.effectiveTo}
                            onChange={(date) => handleUpdateAssignment(assignment.id, { effectiveTo: date })}
                            disabled={!assignment.isActive}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {roleType.hasCustomFields && assignment?.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openCustomFieldsDialog(assignment)}
                          >
                            Settings
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

#### 7.6.6 Financial Drawer Content

```tsx
function FinancialDrawerContent({ contractor }: { contractor: ContractorRow }) {
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms | null>(null)
  const [creditLimit, setCreditLimit] = useState<CreditLimit | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div className="space-y-6">
      {/* Payment Terms Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm font-medium">Payment Terms</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
            {isEditing ? 'Cancel' : 'Edit'}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Payment Days</TableCell>
                <TableCell>
                  {isEditing ? (
                    <Select value={paymentTerms?.paymentDays?.toString()} onValueChange={...}>
                      <SelectItem value="7">Net 7</SelectItem>
                      <SelectItem value="14">Net 14</SelectItem>
                      <SelectItem value="30">Net 30</SelectItem>
                      <SelectItem value="45">Net 45</SelectItem>
                      <SelectItem value="60">Net 60</SelectItem>
                      <SelectItem value="90">Net 90</SelectItem>
                    </Select>
                  ) : (
                    <span>Net {paymentTerms?.paymentDays || 30}</span>
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Currency</TableCell>
                <TableCell>
                  {isEditing ? (
                    <CurrencySelect value={paymentTerms?.currencyCode} onChange={...} />
                  ) : (
                    paymentTerms?.currencyCode || 'USD'
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Payment Method</TableCell>
                <TableCell>
                  {isEditing ? (
                    <Select value={paymentTerms?.paymentMethod} onValueChange={...}>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </Select>
                  ) : (
                    paymentTerms?.paymentMethod || '-'
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bank Details Section (Encrypted) */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">Bank Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Bank Name</TableCell>
                <TableCell>
                  {isEditing ? <Input value={paymentTerms?.bankName} onChange={...} /> : paymentTerms?.bankName || '-'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">IBAN</TableCell>
                <TableCell>
                  {isEditing ? <Input value={paymentTerms?.iban} onChange={...} /> : maskIban(paymentTerms?.iban)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">SWIFT/BIC</TableCell>
                <TableCell>
                  {isEditing ? <Input value={paymentTerms?.swiftBic} onChange={...} /> : paymentTerms?.swiftBic || '-'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Credit Limit Section */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">Credit Limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Unlimited Credit</span>
            <Switch
              checked={creditLimit?.isUnlimited}
              onCheckedChange={(checked) => handleUpdateCreditLimit({ isUnlimited: checked })}
              disabled={!isEditing}
            />
          </div>

          {!creditLimit?.isUnlimited && (
            <>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Credit Limit</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={creditLimit?.creditLimit}
                            onChange={...}
                          />
                          <CurrencySelect value={creditLimit?.currencyCode} onChange={...} />
                        </div>
                      ) : (
                        formatCurrency(creditLimit?.creditLimit, creditLimit?.currencyCode)
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Current Exposure</TableCell>
                    <TableCell className={isOverLimit ? 'text-destructive font-medium' : ''}>
                      {formatCurrency(creditLimit?.currentExposure, creditLimit?.currencyCode)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Available Credit</TableCell>
                    <TableCell>
                      {formatCurrency(availableCredit, creditLimit?.currencyCode)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {/* Exposure Gauge */}
              <div className="pt-2">
                <Progress value={exposurePercentage} className={exposurePercentage > 100 ? 'bg-destructive/20' : ''} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0%</span>
                  <span>{exposurePercentage.toFixed(1)}% used</span>
                  <span>100%</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      {isEditing && (
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
          <Button onClick={handleSaveFinancial}>Save Changes</Button>
        </div>
      )}
    </div>
  )
}
```

#### 7.6.7 Exposure Breakdown Drawer (View Only)

```tsx
function ExposureDrawerContent({ contractor }: { contractor: ContractorRow }) {
  const [exposureItems, setExposureItems] = useState<ExposureItem[]>([])

  const exposureColumns: ColumnDef<ExposureItem>[] = [
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant={row.original.type === 'open_file' ? 'default' : 'secondary'}>
          {row.original.type === 'open_file' ? 'In Service' : 'Unpaid Invoice'}
        </Badge>
      ),
    },
    {
      accessorKey: 'reference',
      header: 'Reference',
      cell: ({ row }) => (
        <Link href={row.original.link} className="text-primary hover:underline">
          {row.original.reference}
        </Link>
      ),
    },
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => formatCurrency(row.original.amount, row.original.currency),
    },
    {
      accessorKey: 'status',
      header: 'Status',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{formatCurrency(openFilesTotal)}</div>
            <div className="text-sm text-muted-foreground">Open Files</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{formatCurrency(unpaidInvoicesTotal)}</div>
            <div className="text-sm text-muted-foreground">Unpaid Invoices</div>
          </CardContent>
        </Card>
      </div>

      {/* Exposure Breakdown Table */}
      <DataTable<ExposureItem>
        columns={exposureColumns}
        data={exposureItems}
        embedded={true}
        sortable={true}
      />

      {/* Last Calculated */}
      <div className="text-xs text-muted-foreground text-right">
        Last calculated: {formatDateTime(contractor.creditLastCalculatedAt)}
        <Button variant="link" size="sm" onClick={handleRecalculate}>
          Recalculate
        </Button>
      </div>
    </div>
  )
}
```

#### 7.6.8 Drawer Width by Content Type

| Drawer Type | Width | Reason |
|-------------|-------|--------|
| Overview | 500px | Simple form layout |
| Contacts | 700px | Table with multiple columns |
| Addresses | 700px | Table + address formatting |
| Roles | 600px | Grouped cards with toggles |
| Financial | 550px | Form-style tables |
| Exposure | 800px | Wide table + summary cards |

### 7.7 Keyboard Shortcuts

- `Cmd/Ctrl + Enter` - Save/submit forms
- `Escape` - Cancel/close dialogs and drawers
- `Cmd/Ctrl + K` - Focus search in list view

---

## 8. Access Control

### 8.1 Features (Permissions)

| Feature | Description |
|---------|-------------|
| `fms_contractors.view` | View contractor list and details |
| `fms_contractors.create` | Create new contractors |
| `fms_contractors.edit` | Edit contractor information |
| `fms_contractors.delete` | Soft delete contractors |
| `fms_contractors.manage_roles` | Assign/remove roles |
| `fms_contractors.manage_financial` | Edit payment terms and credit limits |
| `fms_contractors.admin` | Manage role types |

### 8.2 Role-Based Data Visibility (Future)

- Agents see only files they're contracted to handle
- Carriers see only shipments assigned to them
- Full visibility requires appropriate feature flags

---

## 9. Integration Points

### 9.1 Module Dependencies

| Module | Integration |
|--------|-------------|
| `entities` | Custom fields for role-specific data |
| `auth` | User/role management for access control |
| `directory` | Organization/tenant scoping |

### 9.2 Events Published

| Event | Payload | Description |
|-------|---------|-------------|
| `fms_contractors.created` | Contractor entity | New contractor created |
| `fms_contractors.updated` | Contractor entity | Contractor updated |
| `fms_contractors.deleted` | Contractor ID | Contractor soft deleted |
| `fms_contractors.role_assigned` | Role assignment | Role added to contractor |
| `fms_contractors.role_removed` | Role assignment ID | Role removed |
| `fms_contractors.credit_exceeded` | Contractor, exposure | Credit limit warning |

### 9.3 Events Consumed

| Event | Action |
|-------|--------|
| `sales.order.created` | Recalculate credit exposure |
| `sales.payment.received` | Recalculate credit exposure |
| `sales.invoice.created` | Recalculate credit exposure |

---

## 10. Data Migration

### 10.1 From Legacy System

If migrating from existing contractor data:

1. Map legacy contractor records to new `fms_contractors` table
2. Split addresses into `fms_contractor_addresses`
3. Create contact records if person data exists
4. Map contractor types to role assignments
5. Import payment terms if available

### 10.2 Seed Data

Default role types to be seeded on module initialization (28 roles across 5 categories):

**Trading Parties (5):** client, shipper, consignee, notify_party, manufacturer

**Carriers (6):** shipping_line, airline, trucking_company, rail_operator, nvocc, carrier

**Intermediaries (8):** forwarder, customs_broker, agent, origin_agent, destination_agent, lsp, freight_broker, coloader

**Facility Operators (4):** terminal, warehouse, container_depot, cfs

**Support Services (5):** insurance_provider, surveyor, fumigation_provider, packing_company, bank

### 10.3 CLI Commands

#### Seed Contractor Role Types

To seed the default contractor role types for an organization, run:

```bash
mercato contractors seed-role-types --tenant <tenantId> --org <organizationId>
```

**Required parameters:**
- `--tenant` (or `--tenantId`) - The tenant ID
- `--org` (or `--orgId` or `--organizationId`) - The organization ID

**Example:**
```bash
mercato contractors seed-role-types --tenant abc123 --org org456
```

The command will:
- Create 24 default contractor role types across 4 categories (Trading, Carrier, Intermediary, Facility)
- Skip any role types that already exist for the given organization
- Output the number of created and skipped roles

**Output:**
```
Contractor role types seeded for organization org456:
  Created: 24
  Skipped (already exist): 0
```

---

## 11. Non-Functional Requirements

### 11.1 Performance

- Contractor list: < 200ms for 1000 records with filters
- Detail page load: < 300ms including nested data
- Credit exposure calculation: < 2s per contractor

### 11.2 Security

- Bank account details encrypted at rest (AES-256)
- Tax ID optionally encrypted based on tenant settings
- Audit log for financial data changes
- Multi-tenant isolation enforced at query level

### 11.3 Scalability

- Support 100,000+ contractors per tenant
- Efficient indexing for role-based queries
- Pagination required for all list endpoints

---

## 12. Success Metrics

| Metric | Target |
|--------|--------|
| Contractor creation time | < 2 minutes |
| Role assignment accuracy | 100% |
| Credit limit breach detection | Within 5 minutes of transaction |
| User adoption | 80% of operations using new module within 30 days |

---

## 13. Open Questions

1. **Tax ID validation** - Should we validate tax ID format per country?
2. **Credit limit currency conversion** - How to handle multi-currency exposure?
3. **Historical tracking** - Do we need full audit trail for role changes?
4. **Integration timeline** - When will finance module consume payment terms?
5. **Bulk import** - Is CSV/Excel import required for initial data load?
6. **Role inheritance** - Should child branches inherit parent's roles?

---

## 14. Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| BCO | Beneficial Cargo Owner - the actual customer/shipper |
| LSP | Logistics Service Provider / 3PL |
| NVOCC | Non-Vessel Operating Common Carrier - issues own B/L without owning vessels |
| VOCC | Vessel Operating Common Carrier - shipping line that owns/operates vessels |
| CFS | Container Freight Station - facility for stuffing/unstuffing containers |
| B/L | Bill of Lading - transport document |
| Credit Exposure | Total financial risk = open files + unpaid invoices |
| Payment Terms | Net days for invoice payment (e.g., Net 30) |

### B. Role Category Summary

| Category | Count | Primary Use Case |
|----------|-------|------------------|
| Trading Parties | 5 | Parties in buy/sell transactions |
| Carriers | 6 | Transport providers by mode |
| Intermediaries | 8 | Agents, brokers, forwarders |
| Facility Operators | 4 | Terminals, warehouses, depots |
| Support Services | 5 | Insurance, banking, inspection |
| **Total** | **28** | |

### C. References

- [Freight Forwarder Workflows | AltexSoft](https://www.altexsoft.com/blog/freight-forwarder/)
- [Parties in Shipping | Shippabo](https://blog.shippabo.com/what-is-the-role-and-responsibility-of-each-party-within-the-shipping-process)
- [International Shipment Parties | iContainers](https://www.icontainers.com/help/parties-involved-in-an-international-shipment/)
- [CargoWise Overview | Calsoft](https://www.calsoft.com/everything-you-need-to-know-about-cargowise/)
