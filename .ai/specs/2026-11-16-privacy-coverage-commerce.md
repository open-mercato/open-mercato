# Privacy coverage: commerce

> **Program:** a coverage spec of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for `sales`, `cart`, `checkout`, `payment_gateways` and `warranty_claims`.
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), including its addendum on aliases and identifier subjects; [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), including its addendum; and [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, encryption map and delete commands; nothing was run. Not read: what a payment provider echoes into stored metadata, whether clearing it breaks a later refund, cart event payloads, and the status rules on warranty-claim updates.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

When a customer asks what a company holds about them, or asks for it to be erased, the answer today stops at the CRM record. Their name and address are also on every order and quote, as a copy made when the document was written; in baskets; on payments made through a pay link, where they are known only by an email address; and on warranty claims. None of these modules can export or erase anything, and deleting a CRM person the ordinary way clears the one link by which an order could later be found. **Proposed (future):** each module gets a data class that finds the person's records, exports them, and on erasure does one of three things per record — deletes it, blanks the personal parts, or keeps the minimum a commercial record needs and says until when. Each module is its own phase and ships its export and its erase together.

**Not in this spec:** invoices and credit memos, which hold nothing about a customer; card data, which is never stored; sales channels' and vendors' business contact details, which are configuration.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | An order with an invoice, a completed payment, or a shipment that was not cancelled | Kept, with a reduced buyer block — name, company, billing and shipping address, tax id — and reported as retained. Email, phone, the contact's title and department, comments and internal notes are cleared | ⚠ NEEDS HUMAN CONFIRMATION. The invoice stores no customer; the order's copy is the only place the buyer exists. Record-keeping law needs who bought and where it went, not how to reach them. |
| 2 | Until when | Until the order is older than a number of years the tenant sets. With none set, it is kept and the run says no end is defined | ⚠ NEEDS HUMAN CONFIRMATION. The period differs by country. An OSS default of "for ever" is not defensible; a default number would be a guess. |
| 3 | Other orders and quotes | Personal parts blanked; the document, its number and totals stay | Numbers are unique and sequences must not have holes. |
| 4 | How a kept order is found again | The CRM person is anonymized, not deleted, whenever a commerce class keeps something, so the order's link to them survives. Orders and quotes also get a hash of the buyer's email | The erasure spec already anonymizes the owner when a dependant retains. The hash finds documents whose link was cleared by an ordinary delete, or that never had one. |
| 5 | People known only by an email address | The contract's identifier subject | A payer through a pay link, a guest basket and a claim opened by email have no id anywhere. |
| 6 | A completed pay-link payment | Kept with the payer's name, reported as retained; email, phone, client address and user agent cleared; the provider's data kept, because a refund may need it | ⚠ NEEDS HUMAN CONFIRMATION. A completed payment is a financial record and carries the payer's acceptance of the terms. |
| 7 | Baskets | Deleted where nothing forbids it; otherwise blanked. One that is locked for a checkout in progress is left and reported as pending | Two foreign keys forbid deleting a basket that another row points to. |
| 8 | Warranty claims | A closed claim is kept with name, contact address and free text cleared. An open one is kept whole and reported as retained until it closes | Blanking an open claim removes the address needed to finish it. |
| 9 | Staff named on these records | Left as ids | Authorship is a reference. |

## 📝 Problem Statement

**sales**

- Orders and quotes carry `customer_snapshot` — display name, email, phone, names, company, and the contact's name, title and department — billing and shipping address copies, comments and internal notes, all encrypted (`sales/data/entities.ts:362-374, 431, 880-892`; `commands/documents.ts:818-852`). A caller may pass a snapshot with no customer id (`:1242-1244`). `metadata` may hold references back to inbox proposals (`sales/inbox-actions.ts:71`).
- They link to a person by `customer_entity_id` — indexed for orders (`:329`), not for quotes — and to a contact by `customer_contact_id`, which holds the contact's *profile* id and has no index (`commands/documents.ts:809-815`).
- Invoices, credit memos, payments, shipments and returns have no customer column; they are reached through the order.
- The update command refuses customer and address changes by status and writes a new before-copy (`commands/documents.ts:1168-1192`). Delete is hard, cascades, and keeps a full copy in the audit log under the document's id for undo (`:5473, 6431, 7080`).
- When a person or company is deleted the ordinary way, a subscriber clears `customer_entity_id` and nothing else — not the contact id, not the copy (`subscribers/reconcileOnCustomerDelete.ts:25-36`; `reconcileOnCompanyDelete.ts`). Every customer already deleted that way has left copies that nothing can find.
- The customer's name is copied into the search index (`search.ts:137, 152`).

**cart**

- A basket holds an encrypted email and note with no hash, a customer id (indexed), a list of customer ids in JSON, a portal user id (not indexed) and metadata (`cart/data/entities.ts:93-188`). Merge records hold a copy of the source basket.
- Two foreign keys forbid deleting a basket that a merge record or another basket's proposal points to (`:117, 566-592`). A daily job deletes resolved baskets after 90 days and skips those.

**checkout**

- A transaction holds first and last name, email, phone, free-form customer data, accepted legal consents and the client address, encrypted with no hash, and the user agent in clear (`packages/checkout/…/data/entities.ts:278-308`). It links to no person, portal user or order and has no delete path. Name and email are in the search index and are sent to the payment provider.

**payment_gateways**

- A gateway transaction has no person column. It keeps the provider's data, the client secret and a webhook log, linked by `payment_id` — for a pay link, the checkout transaction's id (`payment_gateways/data/entities.ts:14, 38-53`). A later webhook or poll merges the provider's data back in (`lib/gateway-service.ts:611-651, 729, 784`).

**warranty_claims**

- A claim holds `contact_email` (encrypted, no hash), `customer_name` (in clear, searchable), notes and a resolution summary; lines hold fault descriptions; events hold a body and the acting customer's entity id. On email intake the name falls back to the email address, in clear (`lib/emailIntake.ts:101`).
- It links to a CRM person or company by `customer_id`. Nothing records which portal user wrote it, though their display name is copied into `customer_name` (`api/portal/claims/route.ts:438`).

**What the contract's hash rule means here.** A hash column declared in an encryption map is filled only when a value is encrypted, never for a value already stored as ciphertext. Every address above is already encrypted, so the modules must write and fill their hashes themselves.

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Finds by |
|---|---|---|
| `sales.documents` | `customers:person`; `privacy:identifier` | `customer_entity_id`; `customer_contact_id` through the `profile_ids` alias; a new buyer-email hash through `email_hashes` |
| `cart.baskets` | `customers:person`; `customer_accounts:user`; `privacy:identifier` | Customer id, including the JSON list; portal user id; a new email hash |
| `checkout.payments` | `customers:person`; `privacy:identifier` | A new email hash |
| `payment_gateways.transactions` | The same as `checkout.payments` | `payment_id` equal to a checkout transaction the checkout class reports as related |
| `warranty_claims.claims` | `customers:person`; `customer_accounts:user`; `privacy:identifier` | `customer_id`; the new author column; a new contact-email hash |

A CRM person reaches their own guest baskets, pay-link payments and email claims through their `email_hashes` alias. Someone with no CRM record reaches them as an identifier subject.

### What erasure does

| Record | Outcome |
|---|---|
| Order under assumption 1, younger than the tenant's age or with none set | **Retained**: the reduced buyer block. The rest of the copy, comments and notes cleared. The run reports the date it may be erased, or that none is defined |
| The same order, older than the tenant's age | **Anonymized** |
| Other orders and quotes | **Anonymized**: customer copy, addresses, comments, notes and the two free-text reference columns cleared; number, lines, totals and the link to the anonymized person kept |
| A contact on a company's document, retained or not | The contact's part of the copy **cleared** |
| Shipments, returns, payments under a document | Follow the document; their notes are cleared, tracking numbers kept with a retained order |
| Basket | **Deleted**; **anonymized** when a foreign key forbids it; left as pending when locked |
| Completed pay-link payment | **Retained**: name and consents. Email, phone, customer data, client address and user agent cleared |
| Other pay-link payment | **Anonymized** |
| Gateway transaction of an anonymized payment | Provider data, client secret, webhook log and operation results **cleared**, and the row marked so that a later webhook or poll does not refill it |
| Gateway transaction of a retained payment | **Retained** |
| Closed warranty claim | **Anonymized**: name, contact email, notes, fault descriptions and event bodies cleared; the claim, its lines and its links kept |
| Open warranty claim | **Retained** until closed |

Blanking is done by an internal function of each module that writes through the entity and emits the module's index events, as the erasure spec's addendum describes. Each handler returns the records it touched as history records, so that the copies kept for undo — including a deleted order's full copy — are stripped. Files on shipments, returns, payments and claims are released through the attachments seam where the record is anonymized.

### Schema and behaviour changes

- **Hashes**, written by each module in its own write path and filled for existing rows by a one-off command per module, with the contract's fallback scan until it has run: `sales_orders` and `sales_quotes` buyer email; `carts.email`; `checkout_transactions.email`; `warranty_claims.contact_email`.
- **Indexes**: `sales_quotes.customer_entity_id`; `customer_contact_id` on orders and quotes; `carts.customer_user_id`; each hash, led by the tenant.
- **`warranty_claims.created_by_customer_user_id`**, filled from now on. Existing claims cannot be attributed to a portal user.
- **`gateway_transactions.anonymized_at`**, read by the code that merges provider data.
- **The intake fallback** stops writing an address into `customer_name`.
- **A tenant setting in `sales`**: the number of years a commercial record is kept. Unset by default.
- **The ordinary-delete subscriber is unchanged.** The buyer-email hash is what finds the copies it orphans, past and future.

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Delete orders | Document numbers and totals must survive, and invoices would lose their buyer. |
| Keep the whole customer copy on a retained order | Phone, email and a contact's job title are not what record-keeping needs. |
| Keep retained orders with no end | See assumption 2. |
| `sales` reading the CRM to translate a person into a profile id | A cross-module read; the alias gives the same result. |
| One subject per payment or basket | One person would be dozens of subjects, each with its own audit entries. |
| Stop the subscriber from clearing the link | The link would then point at a row that no longer exists. |
| Clear provider data on a retained payment | A refund may need it. |

### Known limits

- A person already anonymized has no address left to compute aliases from. A commerce class released after that cannot find their address-keyed records; their id-keyed ones still are.
- Two people who used the same address share its hash. The dry run shows how many records were found by address.
- A claim written by a portal user on a company's account before this change cannot be tied to them.
- Free text in line descriptions and in order metadata may still name a person.
- `payment_gateways` covers transactions that belong to a pay-link payment. One created by another caller is reached only if that caller's class reports it.

## 📝 Delta

### Capability: privacy-coverage-commerce

#### ADDED Requirement: Export of commerce records
The system SHALL include in a subject's export their orders, quotes, baskets, pay-link payments and warranty claims, whether they are tied to the subject by id or by email address.

##### Scenario: A customer with an order
- WHEN a person with an order is exported
- THEN the document has a sales section with the order's number, dates, totals and the customer copy

##### Scenario: A contact
- WHEN a person who is only the contact on a company's order is exported
- THEN that order appears, with the contact's part of the copy

##### Scenario: A payer with no CRM record
- WHEN an email address used on a pay link is exported
- THEN one subject covers every payment, basket and claim under that address

##### Scenario: A customer who also paid as a guest
- WHEN a CRM person whose address was used on a pay link is exported
- THEN that payment is included

#### MODIFIED Requirement: Erasure with commerce records
The system SHALL, on erasure, keep a reduced record of a document that was invoiced, paid or shipped and say until when, SHALL blank the personal parts of other documents, and SHALL keep the person findable while anything is retained.

##### Scenario: Invoiced order
- WHEN a person with an invoiced order is erased
- THEN the order still loads with the buyer's name and address and without their email or phone, the run reports it as retained, the person is anonymized and not deleted, and the order's link to the person remains

##### Scenario: Past the tenant's age
- WHEN the tenant has set an age and the invoiced order is older
- THEN the order is blanked like any other

##### Scenario: Open quote
- WHEN a person with only a draft quote is erased
- THEN the quote still loads, with no name, address or comment

##### Scenario: Undo copies
- WHEN an order is blanked
- THEN its audit entries no longer hold the earlier copy

##### Scenario: Basket
- WHEN a person with a basket is erased
- THEN the basket is gone, or blanked if another row points to it

##### Scenario: A late webhook
- WHEN a provider's webhook arrives for a payment that was blanked
- THEN the cleared provider data stays cleared

##### Scenario: Open claim
- WHEN a person with an open warranty claim is erased
- THEN the claim is untouched and reported as retained

Frozen by: `packages/core/src/modules/sales/__integration__/TC-SALES-CUSTOMER-DELETE.characterization.spec.ts` (to be added: today, deleting a person clears the order's link and leaves the copy)

## 📝 Architecture

- Each module: `privacy.ts` with its class, tables, retained declarations; a handler and the internal blanking function under `lib/privacy/`; the hash in its write path; a fill command.
- `customers`: `resolveAliases` with `profile_ids` and `email_hashes`.
- `sales`: the tenant setting, read through the module-configuration service.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| A module → a contact's or an address's records | Aliases from the owner class or the identifier subject | Found by person id only |
| `payment_gateways` → a payer | The checkout class reports its transactions as related records | The gateway class finds nothing |
| Classes → undo copies | History records returned to the run | Reported as retained in audit |
| Classes → files | The attachments seam | Reported as pending |

## 📝 Data Models

| Table | Change |
|---|---|
| `sales_orders`, `sales_quotes` | `customer_email_hash`; indexes for it and for the two customer columns that lack one |
| `carts` | `email_hash`; index on `customer_user_id` |
| `checkout_transactions` | `email_hash` |
| `warranty_claims` | `contact_email_hash`; `created_by_customer_user_id`, nullable |
| `gateway_transactions` | `anonymized_at`, nullable |

Additive, with migrations and snapshots. Indexes on large tables are created concurrently.

## 📝 API Contracts

- Uses the contract's `resolveAliases`, `aliases` and `privacy:identifier`, and the erasure addendum's `historyRecords`. Adds no new contract member.
- **Setting** in `sales`: commercial-record retention, in years, per tenant.
- **Commands**: `mercato sales fill-privacy-hashes`, and the same for `cart`, `checkout` and `warranty_claims`.
- The warranty claim response gains `createdByCustomerUserId`.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The fill command has not run for a tenant | Rows with no hash are scanned by decrypting, within the contract's bound; the run says the scan was used |
| A person who is the customer on one order and the contact on another | Each document is handled for the part that is theirs |
| A company's document | Not the person's; only the contact part is touched |
| An order with only a cancelled payment and a cancelled shipment | Not retained |
| A retained order when the tenant later sets an age | The next erasure run blanks it if it is older |
| A basket locked by a checkout in progress | Left; reported as pending; a re-run finishes it |
| A payment the provider still reports on | The mark stops provider data being merged back |
| The run's process has a different lookup secret from the app | Hashes do not match and nothing is found by address; the doctor's check of the lookup secret applies, and the dry run prints how many records were matched by address |
| An order whose customer was deleted the ordinary way years ago | Found by the buyer-email hash once filled |

## 📝 Migration & Backward Compatibility

Additive columns, indexes, one setting and four commands. The ordinary delete and its subscriber behave as before. Until a module's fill command has run, address lookups in that module use the slower scan.

## 📋 Phasing

Each phase is one module, ships its export and erase together, and can be released alone.

| Phase | Module | Depends on |
|---|---|---|
| 1 | `sales` | The contract's and the erasure spec's addenda; erasure spec, Phase 3 |
| 2 | `cart` | The same |
| 3 | `checkout` with `payment_gateways` | The same |
| 4 | `warranty_claims` | The same |

## 📋 Implementation Plan

For each phase:

1. The schema change, the hash in the write path and the fill command. Unit tests: written with encryption on and off; the fill; the fallback scan.
2. The class: tables, export sections, resolution for an identifier subject and by alias. Unit tests per section and a cross-tenant test.
3. The internal blanking function and the erase method, with the outcomes above and the history records. Unit tests per outcome.
4. Integration test for the module; its tables leave the coverage baseline; its fixture joins the verification suite.

Module-specific steps:

- **`sales`**: first, **characterize** that deleting a person clears an order's link and leaves the copy; commit alone. The tenant setting. The reduced buyer block.
- **`cart`**: the two foreign keys; the locked basket.
- **`checkout` / `payment_gateways`**: the mark on gateway transactions and the merge code's check; the checkout class reports its gateway transactions.
- **`warranty_claims`**: the author column; the intake fix; open and closed claims.

Before Phase 1: `customers` implements `resolveAliases`. After Phase 4: archive this Delta into `.ai/specs/capabilities/privacy-coverage-commerce.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/core/src/modules/customers/lib/privacy/*` | Modify |
| `packages/core/src/modules/{sales,cart,payment_gateways,warranty_claims}/{privacy.ts,lib/privacy/*,di.ts,cli.ts,data/entities.ts,migrations/*}` | Create / modify |
| `packages/checkout/src/modules/checkout/{privacy.ts,lib/privacy/*,di.ts,cli.ts,data/entities.ts,migrations/*}` | Create / modify |
| `packages/core/src/modules/payment_gateways/lib/gateway-service.ts`; `packages/core/src/modules/warranty_claims/lib/emailIntake.ts` | Modify |
| `packages/core/src/helpers/integration/{salesFixtures,cartFixtures,warrantyClaimsFixtures}.ts`; a checkout fixture in its own package | Modify / create |
| One integration test per module, in that module's package | Create |

## 🧪 Integration Coverage

The shared helpers have fixtures for quotes, orders, lines and shipments only. Each phase adds what it needs — an invoice and a payment, a basket, a claim, a pay-link payment — and the checkout test lives in the checkout package. The commands run as existing tests run commands, in a process that shares the app's lookup secret.

| Test | Covers |
|---|---|
| TC-PRIVACY-SALES-001 | Export lists a person's order and quote, and a company's order for its contact. After erasure, an invoiced order returns the buyer's name and no email, and is reported retained; a draft quote returns no name; the person is returned as anonymized; the order's audit entries hold no earlier copy |
| TC-PRIVACY-CART-001 | A basket tied to a person is exported and then gone; one tied only to an email address is found through an identifier subject |
| TC-PRIVACY-CHECKOUT-001 | An address used on a pay link exports its payment as one subject; an uncompleted payment is blanked and a completed one keeps its payer's name |
| TC-PRIVACY-CLAIMS-001 | A closed claim returns no name or contact address after erasure; an open one is unchanged and reported retained |

## 📝 Risks & Impact Review

#### A record that should have been kept is blanked
- **Scenario**: An order with no invoice in this system was invoiced in another.
- **Severity**: High
- **Affected area**: the tenant's commercial records
- **Mitigation**: The dry run lists each document and its outcome before anything changes; assumption 1 is marked.
- **Residual risk**: The rule looks only at what this product knows.

#### A record is kept longer than it should be
- **Scenario**: No age is set and retained orders accumulate.
- **Severity**: High
- **Affected area**: storage limitation
- **Mitigation**: Only the reduced block is kept; the run reports that no end is defined; the setting is in OSS; the doctor reports it unset.
- **Residual risk**: A tenant who never sets it.

#### Address lookups find nothing
- **Scenario**: The fill command was not run, or the command and the app disagree on the lookup secret.
- **Severity**: High
- **Affected area**: guests, payers, email claimants, orphaned orders
- **Mitigation**: The fallback scan; the dry run prints how many records were matched by address; the doctor's secret check.
- **Residual risk**: A changed secret between writing and lookup, which the key-guard spec warns about.

#### The wrong person's records are cleared
- **Scenario**: Two people used one address.
- **Severity**: Medium
- **Affected area**: address-keyed records
- **Mitigation**: The dry run shows the count found by address; records tied to another CRM person by id are left out of an address match.
- **Residual risk**: Two people with no CRM record sharing an address are one subject.

#### A refund fails
- **Scenario**: Provider data was cleared on a payment that is later refunded.
- **Severity**: Medium
- **Affected area**: uncompleted payments only, by design
- **Mitigation**: Provider data is kept on completed payments.
- **Residual risk**: A payment marked uncompleted here that the provider considers complete; the step reads how completion is decided.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the contract's handler obligations and addendum. Not reviewed in full: the `sales`, `cart` and `warranty_claims` guides.

| Rule | Status | Notes |
|---|---|---|
| No cross-module table access | Compliant | Aliases and related records; `sales` already reads CRM entities to build its copies, which is existing and not extended |
| Lookups on a hash | Compliant | Written by each module itself |
| Additive schema | Compliant | — |
| Tenant scoping | Compliant | Every lookup is led by the tenant |
| Integration coverage | Compliant | One test per module, with new fixtures |

**Verdict:** not approved until assumptions 1, 2 and 6 are answered. The design is otherwise ready, one module at a time.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions.
- Rewritten after independent review. Hashes declared in an encryption map would never have been filled for existing, already-encrypted rows, so each module writes and fills its own. Export and erase now ship together per module: shipping export first would have made `customers:person` non-erasable. Aliases and the address-only subject moved into the contract; one subject per payment was replaced by one per address. Retention is reduced to a minimal buyer block, limited to documents with a real invoice, payment or shipment, and given an end the tenant sets. Orders gain a buyer-email hash, which also finds copies orphaned by ordinary deletes. Undo copies are stripped by record, since sales logs under the document. Blanking uses internal functions, because the update command refuses it. Gateway data is kept on completed payments and protected from being refilled on the others. Open claims are retained. Not split into four files as the reviewer suggested: each module is a separate phase and release.
