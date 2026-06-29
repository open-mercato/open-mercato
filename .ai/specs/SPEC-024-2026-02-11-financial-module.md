# SPEC-024: ERP Financial Modules

**Created:** 2026-02-11
**Module:** `financial`
**Status:** Specification

> **Note:** This specification documents the **planned Financial Management module** for the Open Mercato ERP system. It defines a three-layer architecture (Core Engine, Localization Contracts, Country Plugins) to support multi-country financial operations with country-specific tax, invoicing, payroll, and compliance requirements.

## Overview

The Financial Management module serves as the backbone of the ERP system, centralizing all monetary transactions, providing real-time visibility into financial health, and ensuring regulatory compliance across multiple jurisdictions.

### Purpose

- **Multi-country support**: Single installation handles entities in different countries via plugin architecture
- **Regulatory compliance**: Country-specific tax, invoicing, and reporting through localization plugins
- **Real-time financial visibility**: Centralized ledger integrating with all ERP components
- **Functional programming**: Pure functions, immutability, and effect isolation for correctness and testability

### Key Features

- Three-layer architecture: Core Engine, Localization Type Contracts, Country Plugins
- General Ledger, Accounts Payable/Receivable, Cash Management, Fixed Assets
- Multi-currency with configurable rounding rules
- Plugin system for country-specific tax, e-invoicing, payroll, and compliance
- Support for both cash and accrual accounting methods
- GAAP, IFRS, and local GAAP compliance foundations

---

## Document Information
- **Project:** Open Mercato ERP
- **Module:** Financial Management
- **Version:** 2.3 (Complete with Original Scope)
- **Last Updated:** 2025-01-28

---

## Table of Contents
1. [Overview](#overview)
2. [Three-Layer Architecture](#three-layer-architecture)
3. [Layer 1: Core Engine](#layer-1-core-engine)
4. [Layer 2: Localization Type Contracts](#layer-2-localization-type-contracts)
5. [Layer 3: Country Plugins](#layer-3-country-plugins)
6. [Core Financial Modules](#core-financial-modules)
7. [Advanced Financial Modules](#advanced-financial-modules)
8. [Financial Reporting & Analytics](#financial-reporting--analytics)
9. [Integration Points](#integration-points)
10. [Plugin Development Guide](#plugin-development-guide)
11. [Implementation Priority](#implementation-priority)
12. [Correctness Properties & Invariants](#correctness-properties--invariants) *(from Gregory)*
13. [Technical Considerations](#technical-considerations)
14. [Open Questions & Technical Risks](#open-questions--technical-risks) *(expanded from Gregory)*
15. [User Stories](#user-stories) *(from original scope)*
16. [Non-Functional Requirements](#non-functional-requirements) *(from original scope)*
17. [Database Schema](#database-schema-mvp) *(from original scope)*
18. [API Design](#api-design) *(from original scope)*
19. [Use Case Examples](#use-case-examples) *(from original scope)*
20. [Success Criteria](#success-criteria) *(from original scope)*
21. [Out of Scope](#out-of-scope-future-iterations) *(from original scope)*

---

## Overview

The Financial Management module serves as the backbone of the ERP system, centralizing all monetary transactions, providing real-time visibility into financial health, and ensuring regulatory compliance. Unlike standalone accounting software, this module integrates with all other ERP components (manufacturing, inventory, sales, HRM) to provide a unified view of business operations.

### Key Objectives
- Automate financial processes to reduce manual work and errors
- Provide real-time financial visibility for decision-making
- **Support multiple countries with different regulatory requirements**
- Support multi-currency operations for international trade
- Enable accurate cost tracking for manufacturing operations

### Accounting Method Support

> **📋 Adjusted by Gregory spec:** Added explicit accounting method support.

The module supports both accounting methods:

| Method | Description | Revenue Recognition | Expense Recognition |
|--------|-------------|---------------------|---------------------|
| **Cash Basis** | Record when cash changes hands | When payment received | When payment made |
| **Accrual Basis** | Record when transaction occurs | When earned (invoice sent) | When incurred (invoice received) |

Organizations can configure their preferred method at the entity level. The system maintains the data to support both methods and can generate reports in either basis.

### Compliance Framework

> **📋 Adjusted by Gregory spec:** Added explicit compliance standards support.

| Standard | Scope | Support Level |
|----------|-------|---------------|
| **GAAP** (US Generally Accepted Accounting Principles) | US entities | Foundation provided |
| **IFRS** (International Financial Reporting Standards) | International entities | Foundation provided |
| **SOX** (Sarbanes-Oxley) | US public companies | Audit trail, access controls |
| **Local GAAP** | Country-specific (Polish GAAP, HGB, etc.) | Via country plugins |

**Note:** The module provides the *foundation* for compliance. Actual compliance depends on how the organization configures accounts, processes, and internal controls.

---

## Three-Layer Architecture

The financial module is built on a three-layer architecture that separates universal business logic from country-specific implementations. This allows the system to support multiple countries (e.g., Poland, USA, Germany) simultaneously within the same installation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LAYER 3: COUNTRY PLUGINS                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Poland Plugin  │  │   USA Plugin    │  │  Germany Plugin │   ...        │
│  │                 │  │                 │  │                 │              │
│  │ • JPK Reporting │  │ • 1099/W-9      │  │ • DATEV Export  │              │
│  │ • KSeF e-Invoice│  │ • Sales Tax     │  │ • GoBD Compliance│             │
│  │ • VAT-7/VAT-EU  │  │ • GAAP Rules    │  │ • VAT Germany   │              │
│  │ • Polish GAAP   │  │ • ACH Payments  │  │ • SEPA Payments │              │
│  │ • ZUS/PIT/CIT   │  │ • State Taxes   │  │ • E-Bilanz      │              │
│  │ • NBP Rates     │  │ • Fed Reserve   │  │ • ECB Rates     │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
├───────────┴────────────────────┴────────────────────┴────────────────────────┤
│                     LAYER 2: LOCALIZATION INTERFACES                         │
│                                                                              │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐             │
│  │ ITaxEngine       │ │ IReportGenerator │ │ IPaymentFormat   │             │
│  ├──────────────────┤ ├──────────────────┤ ├──────────────────┤             │
│  │ IInvoiceFormat   │ │ IChartOfAccounts │ │ IBankIntegration │             │
│  ├──────────────────┤ ├──────────────────┤ ├──────────────────┤             │
│  │ IPayrollCalc     │ │ IDepreciation    │ │ IExchangeRates   │             │
│  ├──────────────────┤ ├──────────────────┤ ├──────────────────┤             │
│  │ IFiscalCalendar  │ │ INumberFormat    │ │ IComplianceCheck │             │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘             │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                       LAYER 1: CORE ENGINE                                   │
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  General    │ │  Accounts   │ │  Accounts   │ │    Cash     │            │
│  │  Ledger     │ │  Payable    │ │  Receivable │ │  Management │            │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │   Fixed     │ │   Multi     │ │  Budgeting  │ │    Cost     │            │
│  │   Assets    │ │  Currency   │ │ &Forecasting│ │  Accounting │            │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                                              │
│                    [ Country-Agnostic Business Logic ]                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

| Principle | Description |
|-----------|-------------|
| **Separation of Concerns** | Core business logic never contains country-specific code |
| **Plugin Discovery** | Country plugins are auto-discovered and registered at runtime |
| **Multi-Country Support** | Single installation can handle entities in different countries |
| **Type Contracts** | All country variations implement standardized type signatures |
| **Fallback Behavior** | Core engine provides sensible defaults when no plugin is active |
| **Hot-Pluggable** | Plugins can be added/updated without system restart |
| **Testability** | Each layer can be tested independently (pure functions) |

### Functional Programming Principles

| Principle | Description |
|-----------|-------------|
| **Pure Functions** | All business logic implemented as pure functions with no side effects |
| **Immutability** | All data structures are immutable; transformations return new data |
| **Function Composition** | Complex operations built by composing simple functions |
| **Type Safety** | Strong typing with algebraic data types (ADT) for domain modeling |
| **Effect Isolation** | Side effects (DB, API, I/O) isolated at boundaries using Effect pattern |
| **Higher-Order Functions** | Plugins provide functions that Core Engine composes |
| **Declarative Style** | Describe "what" not "how"; use map, filter, reduce over loops |
| **Railway-Oriented Programming** | Error handling via Result/Either types, not exceptions |

### FP Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LAYER 3: COUNTRY PLUGINS                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Poland Plugin  │  │   USA Plugin    │  │  Germany Plugin │   ...        │
│  │  (Functions)    │  │  (Functions)    │  │  (Functions)    │              │
│  │                 │  │                 │  │                 │              │
│  │ calculateVAT    │  │ calculateSales  │  │ calculateMwSt   │              │
│  │ generateJPK     │  │ Tax             │  │ generateDATEV   │              │
│  │ formatElixir    │  │ generate1099    │  │ formatSEPA      │              │
│  │ fetchNBPRates   │  │ formatACH       │  │ fetchECBRates   │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
│           └────────────────────┴────────────────────┘                        │
│                                │                                             │
│                    Plugin Registry (Function Map)                            │
│                                │                                             │
├────────────────────────────────┼─────────────────────────────────────────────┤
│                     LAYER 2: TYPE CONTRACTS                                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Type Definitions (Algebraic Data Types)                              │   │
│  │  ─────────────────────────────────────────                           │   │
│  │  type TaxCalculation = (transaction: Transaction) => TaxResult       │   │
│  │  type InvoiceValidator = (invoice: Invoice) => ValidationResult      │   │
│  │  type PaymentFormatter = (payments: Payment[]) => PaymentFile        │   │
│  │  type RateProvider = (date: Date) => Task<ExchangeRate[]>           │   │
│  │  type PayrollCalculator = (employee: Employee) => PayrollResult      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                       LAYER 1: CORE ENGINE                                   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Pure Functions + Composition                                         │   │
│  │  ─────────────────────────────                                       │   │
│  │  postJournalEntry :: JournalEntry -> Result<PostedEntry, Error>      │   │
│  │  calculateBalance :: AccountId -> Period -> Money                     │   │
│  │  matchPayments :: BankTx[] -> GLEntry[] -> MatchResult[]             │   │
│  │  processInvoice :: Invoice -> TaxCalc -> Result<ProcessedInvoice>    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Effect Boundary (Side Effects Isolated Here)                         │   │
│  │  ─────────────────────────────────────────────                       │   │
│  │  saveToDatabase :: PostedEntry -> Task<Unit>                         │   │
│  │  fetchFromAPI :: URL -> Task<Response>                               │   │
│  │  sendNotification :: Message -> Task<Unit>                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Core Engine

**What it is:** The foundational layer containing all country-agnostic financial logic. This is the "universal truth" of accounting that applies regardless of jurisdiction. Implemented as pure functions with isolated side effects.

### 1.1 Core Engine Modules (Function Groups)

#### General Ledger Module

> **📋 Adjusted by Gregory spec:** Added journal entry types (Standard, Adjusting, Closing, Reversing) and enhanced period states.

```typescript
// Domain Types
type AccountId = Brand<string, 'AccountId'>
type Money = { amount: Decimal; currency: CurrencyCode }
type JournalLine = { accountId: AccountId; debit: Money; credit: Money; costCenter?: CostCenterId }

// Journal Entry Types (from Gregory spec)
type JournalEntryType = 'standard' | 'adjusting' | 'closing' | 'reversing'

type JournalEntry = { 
  id: EntryId
  entryNumber: string           // Sequential within fiscal period
  entryDate: LocalDate          // When transaction occurred
  postingDate: LocalDate        // When posted to GL
  reference: string
  description: string
  entryType: JournalEntryType   // Added: Standard, Adjusting, Closing, Reversing
  lines: NonEmptyArray<JournalLine>
  status: 'draft' | 'pending_approval' | 'posted' | 'reversed'
  reversesEntryId: Option<EntryId>  // If this is a reversing entry
  reversedByEntryId: Option<EntryId> // If this entry was reversed
  scheduledReversalDate: Option<LocalDate> // For auto-reversing entries
}

// Fiscal Period with soft/hard close states (from Gregory spec)
type PeriodStatus = 'open' | 'soft_closed' | 'hard_closed'

type FiscalPeriod = {
  id: PeriodId
  fiscalYear: number
  periodNumber: number
  startDate: LocalDate
  endDate: LocalDate
  status: PeriodStatus
  closedAt: Option<Instant>
  closedBy: Option<UserId>
}

// Period close rules
// OPEN: Anyone can post
// SOFT_CLOSED: Only approved users can post (requires elevated permission)
// HARD_CLOSED: No posting allowed, period is immutable

// Pure Functions
const validateEntry: (entry: JournalEntry) => Validation<JournalEntry, ValidationError[]>
const isBalanced: (entry: JournalEntry) => boolean
const calculateBalance: (accountId: AccountId, period: Period) => Reader<GLRepository, Money>
const postEntry: (entry: JournalEntry) => StateT<GLState, Result<PostedEntry, PostingError>>
const reverseEntry: (entryId: EntryId, reason: string) => Result<JournalEntry, ReversalError>
const closePeriod: (period: Period) => Reader<Config, Result<ClosingEntry, CloseError>>

// New: Auto-reversing entry support (from Gregory spec)
const createReversingEntry: (
  original: JournalEntry, 
  reversalDate: LocalDate
) => JournalEntry

const generatePeriodClosingEntries: (
  period: FiscalPeriod,
  accounts: Account[]
) => JournalEntry[]
```

| Function | Description | Pure? |
|----------|-------------|-------|
| `validateEntry` | Validates journal entry structure and balancing | ✅ Yes |
| `isBalanced` | Checks if debits equal credits | ✅ Yes |
| `calculateBalance` | Computes account balance for period | ✅ Yes |
| `postEntry` | Transitions entry from draft to posted | ✅ Yes |
| `reverseEntry` | Creates reversing entry | ✅ Yes |
| `closePeriod` | Generates closing entries | ✅ Yes |
| `createReversingEntry` | Creates auto-reversing entry for specified date | ✅ Yes |
| `generatePeriodClosingEntries` | Generates period-end closing entries | ✅ Yes |

#### Accounts Payable Module

```typescript
// Domain Types
type VendorId = Brand<string, 'VendorId'>
type InvoiceId = Brand<string, 'InvoiceId'>
type Invoice = {
  id: InvoiceId
  vendorId: VendorId
  invoiceNumber: string
  invoiceDate: LocalDate
  dueDate: LocalDate
  currency: CurrencyCode
  lines: NonEmptyArray<InvoiceLine>
  taxAmount: Money
  status: InvoiceStatus
  countryCode: CountryCode
  countryData: Record<string, unknown>  // Plugin-specific data
}

// Pure Functions  
const createInvoice: (data: InvoiceInput) => Validation<Invoice, ValidationError[]>
const matchToOrder: (invoice: Invoice, po: PurchaseOrder, receipt: GoodsReceipt) 
                    => Result<MatchedInvoice, MatchError>
const calculateDueDate: (invoiceDate: LocalDate, terms: PaymentTerms) => LocalDate
const applyTax: (invoice: Invoice, taxCalc: TaxCalculation) => Invoice
const schedulePayment: (invoice: Invoice) => PaymentProposal
const processPayment: (proposal: PaymentProposal) => Result<Payment, PaymentError>
```

| Function | Description | Pure? |
|----------|-------------|-------|
| `createInvoice` | Creates new invoice with validation | ✅ Yes |
| `matchToOrder` | Three-way matching logic | ✅ Yes |
| `calculateDueDate` | Computes due date from terms | ✅ Yes |
| `applyTax` | Applies tax calculation (from plugin) | ✅ Yes |
| `schedulePayment` | Creates payment proposal | ✅ Yes |
| `processPayment` | Processes payment transaction | ✅ Yes |

#### Accounts Receivable Module

> **📋 Adjusted by Gregory spec:** Added write-off handling and enhanced invoice statuses.

```typescript
// Domain Types
type CustomerId = Brand<string, 'CustomerId'>

// Enhanced AR Invoice Status (from Gregory spec)
type ARInvoiceStatus = 
  | 'draft' 
  | 'sent' 
  | 'partially_paid' 
  | 'paid' 
  | 'overdue' 
  | 'written_off'  // Added: for uncollectible receivables

type CustomerInvoice = {
  id: InvoiceId
  customerId: CustomerId
  invoiceNumber: string
  invoiceDate: LocalDate
  dueDate: LocalDate
  lines: NonEmptyArray<InvoiceLine>
  status: ARInvoiceStatus
  countryCode: CountryCode
  // Added from Gregory spec:
  amountPaid: Money
  writeOffAmount: Option<Money>
  writeOffReason: Option<string>
  writeOffDate: Option<LocalDate>
}

// Write-off result (from Gregory spec)
type WriteOffResult = Readonly<{
  invoice: CustomerInvoice
  journalEntry: JournalEntry  // DR: Bad Debt Expense, CR: AR
  writeOffAmount: Money
  reason: string
}>

// Pure Functions
const generateInvoiceNumber: (context: NumberingContext, formatter: NumberFormatter) => string
const calculateAging: (invoices: Invoice[], asOfDate: LocalDate) => AgingReport
const applyPayment: (invoice: CustomerInvoice, payment: Payment) => Result<AppliedPayment, ApplyError>
const calculateInterest: (invoice: CustomerInvoice, rate: InterestRate, asOf: LocalDate) => Money
const generateDunning: (customer: Customer, level: DunningLevel) => DunningLetter

// Added from Gregory spec: Write-off uncollectible receivables
const writeOffInvoice: (
  invoice: CustomerInvoice,
  reason: string,
  badDebtAccount: AccountId,
  approvedBy: UserId
) => Result<WriteOffResult, WriteOffError>

// Partial write-off support
const partialWriteOff: (
  invoice: CustomerInvoice,
  amount: Money,
  reason: string,
  badDebtAccount: AccountId
) => Result<WriteOffResult, WriteOffError>
```

#### Cash Management Module

```typescript
// Domain Types
type BankAccountId = Brand<string, 'BankAccountId'>
type BankTransaction = {
  id: TransactionId
  bankAccountId: BankAccountId
  transactionDate: LocalDate
  valueDate: LocalDate
  amount: Money
  reference: string
  matchedEntryId: Option<EntryId>
}

// Pure Functions
const parseStatement: (raw: string, parser: StatementParser) => Result<BankStatement, ParseError>
const matchTransaction: (bankTx: BankTransaction, glEntries: GLEntry[]) 
                       => Option<MatchResult>
const reconcile: (statement: BankStatement, glEntries: GLEntry[], rules: MatchingRule[]) 
                => ReconciliationResult
const calculateCashPosition: (accounts: BankAccount[]) => CashPosition
const forecastCashFlow: (ar: ARSummary, ap: APSummary, horizon: number) => CashForecast[]
```

#### Fixed Asset Module

```typescript
// Domain Types
type AssetId = Brand<string, 'AssetId'>
type Asset = {
  id: AssetId
  description: string
  acquisitionDate: LocalDate
  acquisitionCost: Money
  usefulLife: number
  salvageValue: Money
  depreciationMethod: DepreciationMethodId
  accumulatedDepreciation: Money
  countryCode: CountryCode
}

// Pure Functions
const calculateDepreciation: (asset: Asset, method: DepreciationCalculator, period: Period) 
                            => DepreciationEntry
const disposeAsset: (asset: Asset, disposalDate: LocalDate, proceeds: Money) 
                   => Result<DisposalResult, DisposalError>
const revalueAsset: (asset: Asset, newValue: Money, reason: string) => Asset
const transferAsset: (asset: Asset, toCostCenter: CostCenterId) => Asset
```

#### Multi-Currency Module

> **📋 Adjusted by Gregory spec:** Added currency rounding rules and enhanced revaluation types.

```typescript
// Domain Types
type CurrencyCode = Brand<string, 'CurrencyCode'>

// Currency with rounding rules (from Gregory spec)
type Currency = Readonly<{
  code: CurrencyCode
  name: string
  symbol: string
  decimalPlaces: number          // e.g., 2 for USD, 0 for JPY
  roundingMode: RoundingMode     // How to round amounts
  smallestUnit: Decimal          // e.g., 0.01 for USD, 1 for JPY
}>

// Rounding modes (from Gregory spec)
type RoundingMode = 
  | 'half_up'      // 0.5 -> 1 (most common)
  | 'half_down'    // 0.5 -> 0
  | 'half_even'    // Banker's rounding (0.5 -> nearest even)
  | 'ceiling'      // Always round up
  | 'floor'        // Always round down

type ExchangeRate = {
  fromCurrency: CurrencyCode
  toCurrency: CurrencyCode
  rate: Decimal
  date: LocalDate
  source: string
  rateType: 'spot' | 'average' | 'closing'  // Added from Gregory spec
}

// Revaluation result with gain/loss breakdown (from Gregory spec)
type RevaluationResult = Readonly<{
  account: AccountId
  originalAmount: Money
  revaluedAmount: Money
  unrealizedGainLoss: Money
  rateUsed: ExchangeRate
  revaluationDate: LocalDate
}>

// Pure Functions
const convert: (amount: Money, to: CurrencyCode, rate: ExchangeRate) => Money
const calculateFXGainLoss: (original: Money, settled: Money, rate: ExchangeRate) 
                          => FXGainLoss
const revalueOpenItems: (items: OpenItem[], rates: ExchangeRate[]) 
                       => RevaluationResult[]
const getRate: (from: CurrencyCode, to: CurrencyCode, date: LocalDate, provider: RateProvider) 
              => Task<ExchangeRate>

// Added from Gregory spec: Rounding function
const roundToSmallestUnit: (amount: Decimal, currency: Currency) => Decimal

// Added from Gregory spec: Validate currency amount
const isValidCurrencyAmount: (amount: Money, currency: Currency) => boolean
```

### 1.2 Core Data Types (Algebraic Data Types)

```typescript
// ============================================
// Base Types (Branded Types for Type Safety)
// ============================================
type Brand<T, B> = T & { readonly brand: B }

type EntityId = Brand<string, 'EntityId'>
type AccountId = Brand<string, 'AccountId'>
type VendorId = Brand<string, 'VendorId'>
type CustomerId = Brand<string, 'CustomerId'>
type CurrencyCode = Brand<string, 'CurrencyCode'>
type CountryCode = Brand<string, 'CountryCode'>

// ============================================
// Money Type (Value Object)
// ============================================
type Money = Readonly<{
  amount: Decimal
  currency: CurrencyCode
}>

const Money = {
  zero: (currency: CurrencyCode): Money => ({ amount: Decimal.ZERO, currency }),
  add: (a: Money, b: Money): Result<Money, CurrencyMismatch> => ...,
  subtract: (a: Money, b: Money): Result<Money, CurrencyMismatch> => ...,
  multiply: (m: Money, factor: Decimal): Money => ...,
  negate: (m: Money): Money => ...,
  isPositive: (m: Money): boolean => ...,
  isZero: (m: Money): boolean => ...,
}

// ============================================
// Result Type (Railway-Oriented Programming)
// ============================================
type Result<T, E> = Success<T> | Failure<E>
type Success<T> = { readonly tag: 'success'; readonly value: T }
type Failure<E> = { readonly tag: 'failure'; readonly error: E }

const Result = {
  success: <T>(value: T): Result<T, never> => ({ tag: 'success', value }),
  failure: <E>(error: E): Result<never, E> => ({ tag: 'failure', error }),
  map: <T, U, E>(result: Result<T, E>, fn: (t: T) => U): Result<U, E> => ...,
  flatMap: <T, U, E>(result: Result<T, E>, fn: (t: T) => Result<U, E>): Result<U, E> => ...,
  mapError: <T, E, F>(result: Result<T, E>, fn: (e: E) => F): Result<T, F> => ...,
}

// ============================================
// Option Type (Null Safety)
// ============================================
type Option<T> = Some<T> | None
type Some<T> = { readonly tag: 'some'; readonly value: T }
type None = { readonly tag: 'none' }

// ============================================
// Validation Type (Accumulating Errors)
// ============================================
type Validation<T, E> = Valid<T> | Invalid<E>
type Valid<T> = { readonly tag: 'valid'; readonly value: T }
type Invalid<E> = { readonly tag: 'invalid'; readonly errors: NonEmptyArray<E> }

// ============================================
// Task Type (Async Effects)
// ============================================
type Task<T> = () => Promise<T>
type TaskResult<T, E> = Task<Result<T, E>>

// ============================================
// Domain Entities
// ============================================
type Account = Readonly<{
  id: AccountId
  code: string
  name: string
  type: AccountType
  parentId: Option<AccountId>
  currency: CurrencyCode
  isActive: boolean
  localizedNames: Record<string, string>  // EAV pattern
}>

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs'

type JournalEntry = Readonly<{
  id: EntryId
  entryDate: LocalDate
  postingDate: LocalDate
  reference: string
  description: string
  lines: NonEmptyArray<JournalLine>
  status: EntryStatus
  createdBy: UserId
  createdAt: Instant
}>

type JournalLine = Readonly<{
  accountId: AccountId
  debit: Money
  credit: Money
  description: Option<string>
  costCenterId: Option<CostCenterId>
  dimensions: Record<string, string>
}>

type EntryStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed'

type Invoice = Readonly<{
  id: InvoiceId
  invoiceNumber: string
  invoiceDate: LocalDate
  dueDate: LocalDate
  vendorId: VendorId
  currency: CurrencyCode
  lines: NonEmptyArray<InvoiceLine>
  netAmount: Money
  taxAmount: Money
  grossAmount: Money
  status: InvoiceStatus
  countryCode: CountryCode
  countryData: Readonly<Record<string, unknown>>  // Plugin extension point
}>

type InvoiceStatus = 
  | 'draft'
  | 'pending_approval' 
  | 'approved'
  | 'posted'
  | 'partially_paid'
  | 'paid'
  | 'cancelled'

type BankTransaction = Readonly<{
  id: TransactionId
  bankAccountId: BankAccountId
  transactionDate: LocalDate
  valueDate: LocalDate
  amount: Money
  reference: string
  description: string
  matchedEntryId: Option<EntryId>
  status: ReconciliationStatus
}>

type ReconciliationStatus = 'unmatched' | 'matched' | 'reconciled' | 'excluded'
```

### 1.3 Core Engine Events (For Plugin Hooks)

Events are implemented as discriminated unions that plugins can subscribe to:

```typescript
// Event Types (Discriminated Union)
type FinanceEvent =
  | { type: 'INVOICE_CREATED'; payload: Invoice }
  | { type: 'INVOICE_POSTED'; payload: Invoice }
  | { type: 'PAYMENT_CREATED'; payload: Payment }
  | { type: 'PERIOD_CLOSING'; payload: Period }
  | { type: 'PERIOD_CLOSED'; payload: Period }
  | { type: 'TAX_CALCULATING'; payload: TaxContext }
  | { type: 'REPORT_GENERATING'; payload: ReportContext }
  | { type: 'VENDOR_VALIDATING'; payload: Vendor }
  | { type: 'EXCHANGE_RATE_NEEDED'; payload: RateRequest }

// Event Handler Type
type EventHandler<E extends FinanceEvent> = (event: E) => Task<void>

// Event Subscription
type EventSubscription = {
  eventType: FinanceEvent['type']
  handler: EventHandler<FinanceEvent>
  priority: number
}
```

| Event | Description | Plugin Use Case |
|-------|-------------|-----------------|
| `INVOICE_CREATED` | New invoice created | Validate against country rules |
| `INVOICE_POSTED` | Invoice posted to GL | Generate e-invoice (KSeF) |
| `PAYMENT_CREATED` | Payment initiated | Apply country payment format |
| `PERIOD_CLOSING` | Period being closed | Generate tax reports |
| `PERIOD_CLOSED` | Period closed | Submit statutory filings |
| `TAX_CALCULATING` | Tax being calculated | Apply country tax rules |
| `REPORT_GENERATING` | Report requested | Apply country format |
| `VENDOR_VALIDATING` | Vendor being saved | Validate tax ID format |
| `EXCHANGE_RATE_NEEDED` | Rate requested | Fetch from country source |

---

## Layer 2: Localization Type Contracts

**What it is:** Type definitions (contracts) that define HOW country-specific functionality should be implemented. Plugins must provide functions matching these type signatures to integrate with the Core Engine.

### 2.1 Tax Type Contracts

> **📋 Adjusted by Gregory spec:** Added compound tax support, tax-inclusive/exclusive pricing, and tax jurisdiction handling.

#### TaxCalculation
```typescript
// ============================================
// Tax Calculation Types
// ============================================

type TaxCode = Readonly<{
  code: string
  name: string
  rate: Decimal
  type: 'vat' | 'sales' | 'withholding' | 'excise' | 'gst'
  isDefault: boolean
  // Added from Gregory spec:
  isCompound: boolean           // Tax calculated on base + previous taxes
  priceInclusive: boolean       // Rate already included in price
  effectiveFrom: LocalDate
  effectiveTo: Option<LocalDate>
  jurisdictionCode: Option<string>  // For multi-jurisdiction (US states, etc.)
}>

// Compound tax configuration (from Gregory spec)
type CompoundTaxRule = Readonly<{
  taxCode: string
  appliesAfter: string[]  // Tax codes that must be calculated first
  order: number           // Calculation order (lower = first)
}>

// Tax calculation mode (from Gregory spec)
type TaxCalculationMode = 'exclusive' | 'inclusive'
// exclusive: tax added on top of base price (price + tax = total)
// inclusive: tax extracted from total price (total - tax = base)

type TaxResult = Readonly<{
  taxCode: TaxCode
  baseAmount: Money
  taxAmount: Money
  isReverseCharge: boolean
  isExempt: boolean
  exemptReason: Option<string>
  // Added from Gregory spec:
  calculationMode: TaxCalculationMode
  isCompoundTax: boolean
  compoundBase: Option<Money>  // Base including prior taxes (for compound)
}>

type TaxContext = Readonly<{
  transaction: Transaction
  vendor: Option<Vendor>
  customer: Option<Customer>
  transactionDate: LocalDate
  countryCode: CountryCode
  // Added from Gregory spec:
  jurisdictionCode: Option<string>  // State/province for US/CA
  calculationMode: TaxCalculationMode
}>

type ValidationResult<T> = Result<T, NonEmptyArray<ValidationError>>
type ValidationError = { code: string; message: string; field: Option<string> }

// ============================================
// Tax Function Contracts (Plugin must provide)
// ============================================

type TaxCalculation = (context: TaxContext) => TaxResult[]

type TaxCodeProvider = () => TaxCode[]

type TaxIdValidator = (taxId: string, entityType: 'vendor' | 'customer') => ValidationResult<string>

type TaxRateProvider = (date: LocalDate, category: string) => TaxCode[]

type ReverseChargeChecker = (context: TaxContext) => boolean

type TaxExemptionChecker = (context: TaxContext) => Option<ExemptionResult>

type WithholdingCalculator = (payment: Payment) => Option<WithholdingResult>

// Added from Gregory spec: Compound tax support
type CompoundTaxCalculator = (
  baseAmount: Money,
  taxCodes: TaxCode[],
  rules: CompoundTaxRule[]
) => TaxResult[]

// Added from Gregory spec: Extract tax from inclusive price
type TaxExtractor = (
  totalAmount: Money,
  taxCode: TaxCode
) => { baseAmount: Money; taxAmount: Money }

// Combined Tax Module Type
type TaxModule = Readonly<{
  calculateTax: TaxCalculation
  getTaxCodes: TaxCodeProvider
  validateTaxId: TaxIdValidator
  getTaxRates: TaxRateProvider
  isReverseCharge: ReverseChargeChecker
  checkExemption: TaxExemptionChecker
  calculateWithholding: WithholdingCalculator
  // Added from Gregory spec:
  calculateCompoundTax: CompoundTaxCalculator
  extractTaxFromInclusive: TaxExtractor
  getJurisdictions: () => TaxJurisdiction[]
}>

// Tax jurisdiction for multi-state/province support
type TaxJurisdiction = Readonly<{
  code: string
  name: string
  parentCode: Option<string>  // e.g., US for US-CA
  level: 'country' | 'state' | 'county' | 'city'
}>
```

#### TaxReporting
```typescript
// ============================================
// Tax Reporting Types
// ============================================

type TaxReturn = Readonly<{
  period: Period
  returnType: string
  data: Record<string, unknown>
  generatedAt: Instant
  status: 'draft' | 'final' | 'submitted'
}>

type TaxObligation = Readonly<{
  code: string
  name: string
  frequency: 'monthly' | 'quarterly' | 'annual'
  deadline: (period: Period) => LocalDate
}>

type SubmissionResult = Result<
  { confirmationNumber: string; submittedAt: Instant },
  SubmissionError
>

// Tax Reporting Function Contracts
type VATReturnGenerator = (period: Period) => Task<TaxReturn>

type AnnualTaxReportGenerator = (year: number) => Task<TaxReturn>

type TaxObligationProvider = (entity: Entity) => TaxObligation[]

type TaxReportValidator = (report: TaxReturn) => ValidationResult<TaxReturn>

type TaxSubmitter = (report: TaxReturn) => Task<SubmissionResult>

// Combined Tax Reporting Module Type
type TaxReportingModule = Readonly<{
  generateVATReturn: VATReturnGenerator
  generateAnnualReport: AnnualTaxReportGenerator
  getObligations: TaxObligationProvider
  validateReport: TaxReportValidator
  submitToAuthority: TaxSubmitter
}>
```

### 2.2 Invoice Type Contracts

#### InvoiceFormat
```typescript
// ============================================
// Invoice Format Types
// ============================================

type FieldDefinition = Readonly<{
  name: string
  type: 'string' | 'number' | 'date' | 'money' | 'enum'
  required: boolean
  maxLength: Option<number>
  enumValues: Option<string[]>
}>

type InvoiceType = 'standard' | 'corrective' | 'proforma' | 'advance' | 'final'

type NumberingContext = Readonly<{
  entityId: EntityId
  invoiceType: InvoiceType
  date: LocalDate
  sequence: number
}>

type PrintFormat = Readonly<{
  template: string
  data: Record<string, unknown>
  language: string
}>

// Invoice Format Function Contracts
type RequiredFieldsProvider = () => FieldDefinition[]

type InvoiceValidator = (invoice: Invoice) => ValidationResult<Invoice>

type InvoiceNumberGenerator = (context: NumberingContext) => string

type PrintFormatter = (invoice: Invoice) => PrintFormat

type InvoiceTypesProvider = () => InvoiceType[]

// Combined Invoice Format Module Type
type InvoiceFormatModule = Readonly<{
  getRequiredFields: RequiredFieldsProvider
  validateInvoice: InvoiceValidator
  generateNumber: InvoiceNumberGenerator
  formatForPrint: PrintFormatter
  getInvoiceTypes: InvoiceTypesProvider
}>
```

#### EInvoice
```typescript
// ============================================
// E-Invoice Types
// ============================================

type EInvoiceDocument = Readonly<{
  format: string  // 'KSEF_FA2' | 'XRECHNUNG' | 'FACTUR_X' | etc.
  content: string | Uint8Array
  metadata: Record<string, unknown>
}>

type EInvoiceStatus = 
  | { status: 'not_required' }
  | { status: 'pending'; queuedAt: Instant }
  | { status: 'submitted'; referenceNumber: string; submittedAt: Instant }
  | { status: 'accepted'; acceptedAt: Instant }
  | { status: 'rejected'; reason: string; rejectedAt: Instant }

// E-Invoice Function Contracts
type EInvoiceRequiredChecker = (invoice: Invoice) => boolean

type EInvoiceConverter = (invoice: Invoice) => Result<EInvoiceDocument, ConversionError>

type EInvoiceSubmitter = (document: EInvoiceDocument) => Task<SubmissionResult>

type EInvoiceReceiver = (externalId: string) => Task<Result<Invoice, ReceiveError>>

type EInvoiceStatusChecker = (invoice: Invoice) => Task<EInvoiceStatus>

// Combined E-Invoice Module Type
type EInvoiceModule = Readonly<{
  isRequired: EInvoiceRequiredChecker
  convert: EInvoiceConverter
  submit: EInvoiceSubmitter
  receive: EInvoiceReceiver
  getStatus: EInvoiceStatusChecker
}>
```

### 2.3 Payment Type Contracts

#### PaymentFormat
```typescript
// ============================================
// Payment Format Types  
// ============================================

type PaymentFormat = 'SEPA' | 'ELIXIR' | 'ACH' | 'WIRE' | 'BACS' | 'SWIFT'

type PaymentFile = Readonly<{
  format: PaymentFormat
  content: string | Uint8Array
  filename: string
  paymentCount: number
  totalAmount: Money
  generatedAt: Instant
}>

type PaymentConfirmation = Readonly<{
  paymentId: PaymentId
  status: 'confirmed' | 'rejected' | 'pending'
  bankReference: Option<string>
  processedAt: Option<Instant>
  errorMessage: Option<string>
}>

type BankAccountValidation = Result<
  { normalized: string; bankName: Option<string> },
  ValidationError
>

// Payment Format Function Contracts
type SupportedFormatsProvider = () => PaymentFormat[]

type PaymentFileGenerator = (payments: Payment[], format: PaymentFormat) => Result<PaymentFile, GenerationError>

type PaymentConfirmationParser = (file: string | Uint8Array) => Result<PaymentConfirmation[], ParseError>

type BankAccountValidator = (account: BankAccount) => BankAccountValidation

// Combined Payment Format Module Type
type PaymentFormatModule = Readonly<{
  getSupportedFormats: SupportedFormatsProvider
  generateFile: PaymentFileGenerator
  parseConfirmation: PaymentConfirmationParser
  validateBankAccount: BankAccountValidator
}>
```

#### BankStatementFormat
```typescript
// ============================================
// Bank Statement Types
// ============================================

type StatementFormat = 'MT940' | 'CAMT053' | 'BAI2' | 'OFX' | 'CSV'

type BankStatement = Readonly<{
  accountNumber: string
  statementDate: LocalDate
  openingBalance: Money
  closingBalance: Money
  transactions: BankStatementTransaction[]
}>

type BankStatementTransaction = Readonly<{
  transactionDate: LocalDate
  valueDate: LocalDate
  amount: Money
  reference: string
  description: string
  transactionCode: string
  counterparty: Option<CounterpartyInfo>
}>

type TransactionType = 
  | 'payment_received'
  | 'payment_sent'
  | 'transfer_in'
  | 'transfer_out'
  | 'fee'
  | 'interest'
  | 'other'

// Bank Statement Function Contracts
type SupportedStatementFormatsProvider = () => StatementFormat[]

type StatementParser = (file: string | Uint8Array, format: StatementFormat) 
                      => Result<BankStatement, ParseError>

type TransactionCodeMapper = (code: string) => TransactionType

// Combined Bank Statement Module Type
type BankStatementModule = Readonly<{
  getSupportedFormats: SupportedStatementFormatsProvider
  parseStatement: StatementParser
  mapTransactionCode: TransactionCodeMapper
}>
```

### 2.4 Accounting Standards Type Contracts

#### ChartOfAccountsTemplate
```typescript
// ============================================
// Chart of Accounts Types
// ============================================

type AccountTemplate = Readonly<{
  code: string
  name: string
  type: AccountType
  parentCode: Option<string>
  description: Option<string>
  taxCode: Option<string>
  tags: string[]
}>

type AccountMapping = Readonly<{
  accountCode: string
  reportLine: string
  reportSection: string
}>

// Chart of Accounts Function Contracts
type StandardChartProvider = () => AccountTemplate[]

type AccountMappingsProvider = () => AccountMapping[]

type ChartValidator = (accounts: Account[]) => ValidationResult<Account[]>

type RequiredAccountsProvider = () => AccountTemplate[]

// Combined CoA Module Type
type ChartOfAccountsModule = Readonly<{
  getStandardChart: StandardChartProvider
  getMappings: AccountMappingsProvider
  validateStructure: ChartValidator
  getRequiredAccounts: RequiredAccountsProvider
}>
```

#### FinancialStatementFormat
```typescript
// ============================================
// Financial Statement Types
// ============================================

type ReportFormat = Readonly<{
  name: string
  sections: ReportSection[]
  totals: ReportTotal[]
}>

type ReportSection = Readonly<{
  code: string
  name: string
  lines: ReportLine[]
}>

type ReportLine = Readonly<{
  code: string
  name: string
  formula: string  // e.g., "SUM(1000:1999)" or "LINE(A) - LINE(B)"
  style: 'normal' | 'bold' | 'italic' | 'header'
}>

type Disclosure = Readonly<{
  code: string
  title: string
  required: boolean
  template: string
}>

// Financial Statement Function Contracts
type BalanceSheetFormatProvider = () => ReportFormat

type IncomeStatementFormatProvider = () => ReportFormat

type CashFlowFormatProvider = () => ReportFormat

type StatutoryReportGenerator = (type: string, period: Period) => Task<Report>

type DisclosureRequirementsProvider = () => Disclosure[]

// Combined Financial Statement Module Type
type FinancialStatementModule = Readonly<{
  getBalanceSheetFormat: BalanceSheetFormatProvider
  getIncomeStatementFormat: IncomeStatementFormatProvider
  getCashFlowFormat: CashFlowFormatProvider
  generateStatutoryReport: StatutoryReportGenerator
  getDisclosureRequirements: DisclosureRequirementsProvider
}>
```

### 2.5 Payroll Type Contracts

#### PayrollCalculation
```typescript
// ============================================
// Payroll Types
// ============================================

type PayrollResult = Readonly<{
  grossPay: Money
  deductions: Deduction[]
  netPay: Money
  employerCosts: EmployerCost[]
  totalCost: Money
}>

type Deduction = Readonly<{
  code: string
  name: string
  amount: Money
  type: 'tax' | 'social_security' | 'benefit' | 'other'
  employeeShare: Money
  employerShare: Money
}>

type EmployerCost = Readonly<{
  code: string
  name: string
  amount: Money
  type: 'social_security' | 'benefit' | 'tax' | 'other'
}>

type TaxBracket = Readonly<{
  minIncome: Money
  maxIncome: Option<Money>
  rate: Decimal
  fixedAmount: Money
}>

type PayrollPeriod = Readonly<{
  year: number
  month: number
  startDate: LocalDate
  endDate: LocalDate
  payDate: LocalDate
}>

// Payroll Calculation Function Contracts
type GrossToNetCalculator = (employee: Employee, gross: Money, period: PayrollPeriod) 
                           => PayrollResult

type TaxBracketsProvider = (year: number) => TaxBracket[]

type SocialSecurityCalculator = (employee: Employee, gross: Money) => Deduction[]

type EmployerCostCalculator = (employee: Employee, gross: Money) => EmployerCost[]

type MinimumWageProvider = (date: LocalDate, employmentType: string) => Money

type PayrollCalendarProvider = (year: number) => PayrollPeriod[]

// Combined Payroll Calculation Module Type
type PayrollCalculationModule = Readonly<{
  calculateGrossToNet: GrossToNetCalculator
  getTaxBrackets: TaxBracketsProvider
  calculateSocialSecurity: SocialSecurityCalculator
  calculateEmployerCosts: EmployerCostCalculator
  getMinimumWage: MinimumWageProvider
  getPayrollCalendar: PayrollCalendarProvider
}>
```

#### PayrollReporting
```typescript
// ============================================
// Payroll Reporting Types
// ============================================

type Payslip = Readonly<{
  employee: Employee
  period: PayrollPeriod
  grossPay: Money
  deductions: Deduction[]
  netPay: Money
  yearToDate: YearToDateSummary
}>

type AnnualStatement = Readonly<{
  employee: Employee
  year: number
  totalGross: Money
  totalTax: Money
  totalSocialSecurity: Money
  statementType: string  // 'W2' | 'PIT11' | 'Lohnsteuerbescheinigung'
  data: Record<string, unknown>
}>

// Payroll Reporting Function Contracts
type PayslipGenerator = (employee: Employee, period: PayrollPeriod) => Payslip

type AnnualStatementGenerator = (employee: Employee, year: number) => AnnualStatement

type SocialSecurityReportGenerator = (period: PayrollPeriod) => Task<Report>

type PayrollTaxSubmitter = (period: PayrollPeriod) => Task<SubmissionResult>

// Combined Payroll Reporting Module Type
type PayrollReportingModule = Readonly<{
  generatePayslip: PayslipGenerator
  generateAnnualStatement: AnnualStatementGenerator
  generateSocialSecurityReport: SocialSecurityReportGenerator
  submitPayrollTax: PayrollTaxSubmitter
}>
```

### 2.6 Fixed Asset Type Contracts

#### DepreciationMethod
```typescript
// ============================================
// Depreciation Types
// ============================================

type DepreciationMethod = Readonly<{
  code: string
  name: string
  type: 'straight_line' | 'declining_balance' | 'units_of_production' | 'sum_of_years' | 'custom'
}>

type AssetClass = Readonly<{
  code: string
  name: string
  defaultUsefulLife: number
  defaultMethod: DepreciationMethod
  taxUsefulLife: Option<number>
  taxMethod: Option<DepreciationMethod>
}>

type SpecialDepreciation = Readonly<{
  code: string
  name: string
  type: 'bonus' | 'accelerated' | 'section179' | 'other'
  maxAmount: Option<Money>
  rate: Option<Decimal>
  eligibilityChecker: (asset: Asset) => boolean
}>

// Depreciation Function Contracts
type AllowedMethodsProvider = () => DepreciationMethod[]

type AssetClassificationsProvider = () => AssetClass[]

type UsefulLifeProvider = (assetClass: string) => number

type DepreciationCalculator = (asset: Asset, method: DepreciationMethod, period: Period) 
                             => Money

type SpecialDepreciationProvider = (asset: Asset) => SpecialDepreciation[]

// Combined Depreciation Module Type
type DepreciationModule = Readonly<{
  getAllowedMethods: AllowedMethodsProvider
  getAssetClassifications: AssetClassificationsProvider
  getUsefulLife: UsefulLifeProvider
  calculateDepreciation: DepreciationCalculator
  getSpecialDepreciation: SpecialDepreciationProvider
}>
```

### 2.7 Compliance Type Contracts

#### ComplianceCheck
```typescript
// ============================================
// Compliance Types
// ============================================

type ComplianceResult = Result<
  { passed: true },
  { passed: false; violations: ComplianceViolation[] }
>

type ComplianceViolation = Readonly<{
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  field: Option<string>
  remediation: Option<string>
}>

type ComplianceRule = Readonly<{
  code: string
  name: string
  description: string
  category: string
  checker: (context: unknown) => ComplianceResult
}>

type AuditFile = Readonly<{
  format: string
  content: string | Uint8Array
  period: Period
  generatedAt: Instant
  checksum: string
}>

// Compliance Function Contracts
type TransactionComplianceChecker = (transaction: Transaction) => ComplianceResult

type VendorComplianceChecker = (vendor: Vendor) => Task<ComplianceResult>

type ComplianceRulesProvider = () => ComplianceRule[]

type AuditFileGenerator = (format: string, period: Period, scope: string) 
                         => Task<Result<AuditFile, GenerationError>>

// Combined Compliance Module Type
type ComplianceModule = Readonly<{
  checkTransaction: TransactionComplianceChecker
  checkVendor: VendorComplianceChecker
  getRules: ComplianceRulesProvider
  generateAuditFile: AuditFileGenerator
}>
```

### 2.8 Localization Type Contracts

#### NumberFormat
```typescript
// ============================================
// Number Format Types
// ============================================

type FormattedNumber = string

// Number Format Function Contracts
type CurrencyFormatter = (amount: Money) => FormattedNumber

type NumberFormatter = (value: number, decimals: number) => FormattedNumber

type NumberParser = (text: string) => Result<number, ParseError>

type DecimalSeparatorProvider = () => string

type ThousandsSeparatorProvider = () => string

// Combined Number Format Module Type
type NumberFormatModule = Readonly<{
  formatCurrency: CurrencyFormatter
  formatNumber: NumberFormatter
  parseNumber: NumberParser
  getDecimalSeparator: DecimalSeparatorProvider
  getThousandsSeparator: ThousandsSeparatorProvider
}>
```

#### FiscalCalendar
```typescript
// ============================================
// Fiscal Calendar Types
// ============================================

type FiscalPeriod = Readonly<{
  year: number
  period: number
  startDate: LocalDate
  endDate: LocalDate
  name: string
}>

type Holiday = Readonly<{
  date: LocalDate
  name: string
  type: 'national' | 'regional' | 'bank'
}>

// Fiscal Calendar Function Contracts
type FiscalYearStartProvider = (year: number) => LocalDate

type FiscalPeriodsProvider = (year: number) => FiscalPeriod[]

type HolidaysProvider = (year: number) => Holiday[]

type BusinessDaysCalculator = (from: LocalDate, to: LocalDate) => number

// Combined Fiscal Calendar Module Type
type FiscalCalendarModule = Readonly<{
  getFiscalYearStart: FiscalYearStartProvider
  getFiscalPeriods: FiscalPeriodsProvider
  getHolidays: HolidaysProvider
  calculateBusinessDays: BusinessDaysCalculator
}>
```

#### ExchangeRateProvider
```typescript
// ============================================
// Exchange Rate Types
// ============================================

type ExchangeRate = Readonly<{
  fromCurrency: CurrencyCode
  toCurrency: CurrencyCode
  rate: Decimal
  date: LocalDate
  source: string
  type: 'mid' | 'buy' | 'sell'
}>

// Exchange Rate Function Contracts
type OfficialSourceProvider = () => string

type RatesFetcher = (date: LocalDate) => Task<ExchangeRate[]>

type HistoricalRateProvider = (currency: CurrencyCode, date: LocalDate) 
                             => Task<Option<ExchangeRate>>

type RateTypeProvider = () => 'mid' | 'buy' | 'sell'

// Combined Exchange Rate Module Type
type ExchangeRateModule = Readonly<{
  getOfficialSource: OfficialSourceProvider
  fetchRates: RatesFetcher
  getHistoricalRate: HistoricalRateProvider
  getRateType: RateTypeProvider
}>
```

### 2.9 Complete Plugin Contract

```typescript
// ============================================
// Full Country Plugin Type Contract
// ============================================

type CountryPlugin = Readonly<{
  // Metadata
  countryCode: CountryCode
  countryCurrency: CurrencyCode
  countryName: string
  
  // Required Modules
  tax: TaxModule
  taxReporting: TaxReportingModule
  invoiceFormat: InvoiceFormatModule
  paymentFormat: PaymentFormatModule
  bankStatement: BankStatementModule
  chartOfAccounts: ChartOfAccountsModule
  numberFormat: NumberFormatModule
  fiscalCalendar: FiscalCalendarModule
  exchangeRates: ExchangeRateModule
  
  // Optional Modules
  eInvoice: Option<EInvoiceModule>
  payroll: Option<PayrollCalculationModule>
  payrollReporting: Option<PayrollReportingModule>
  depreciation: Option<DepreciationModule>
  financialStatements: Option<FinancialStatementModule>
  compliance: Option<ComplianceModule>
}>

// Plugin Registry Type
type PluginRegistry = Map<CountryCode, CountryPlugin>

// Plugin Resolver (returns plugin functions for a country)
type PluginResolver = <K extends keyof CountryPlugin>(
  countryCode: CountryCode,
  module: K
) => Option<CountryPlugin[K]>
```

---

## Layer 3: Country Plugins

**What it is:** Concrete implementations of Layer 2 type contracts for specific countries. Each plugin is a self-contained module that exports functions matching the required type signatures.

### 3.1 Plugin Structure (Functional)

```
plugins/
├── poland/
│   ├── manifest.json              # Plugin metadata
│   ├── index.ts                   # Main export (plugin factory function)
│   ├── src/
│   │   ├── tax/
│   │   │   ├── vatCalculation.ts  # Pure functions for VAT
│   │   │   ├── taxCodes.ts        # Tax code data
│   │   │   └── jpkReporting.ts    # JPK generation functions
│   │   ├── invoice/
│   │   │   ├── invoiceFormat.ts   # Invoice validation functions
│   │   │   └── ksef.ts            # KSeF integration functions
│   │   ├── payment/
│   │   │   ├── elixir.ts          # Elixir format functions
│   │   │   └── sepa.ts            # SEPA format functions
│   │   ├── payroll/
│   │   │   ├── zusCalculation.ts  # ZUS contribution functions
│   │   │   └── pitCalculation.ts  # PIT tax functions
│   │   ├── accounting/
│   │   │   ├── polishCoa.ts       # Polish CoA template
│   │   │   └── statements.ts      # Polish GAAP statements
│   │   ├── compliance/
│   │   │   ├── whiteList.ts       # White list validation
│   │   │   └── splitPayment.ts    # MPP rules
│   │   └── localization/
│   │       ├── numberFormat.ts    # Polish number formatting
│   │       ├── calendar.ts        # Polish fiscal calendar
│   │       └── nbpRates.ts        # NBP rate fetching
│   ├── data/
│   │   ├── tax-rates.json         # VAT rates data
│   │   ├── chart-of-accounts.json # Standard Polish CoA
│   │   ├── kst-classes.json       # Asset classification
│   │   └── holidays.json          # Polish holidays
│   └── __tests__/
│       ├── tax.test.ts
│       ├── invoice.test.ts
│       └── payroll.test.ts
│
├── usa/
│   ├── manifest.json
│   ├── index.ts
│   ├── src/
│   │   ├── tax/
│   │   │   ├── salesTax.ts        # State sales tax functions
│   │   │   ├── federalTax.ts      # Federal tax functions
│   │   │   └── form1099.ts        # 1099 generation
│   │   ├── invoice/
│   │   │   └── usInvoiceFormat.ts
│   │   ├── payment/
│   │   │   ├── ach.ts             # ACH format functions
│   │   │   └── wire.ts            # Wire transfer functions
│   │   ├── payroll/
│   │   │   ├── ficaCalculation.ts # FICA functions
│   │   │   ├── federalWithholding.ts
│   │   │   └── stateWithholding.ts
│   │   └── accounting/
│   │       ├── usGaapCoa.ts
│   │       └── statements.ts
│   └── data/
│       ├── state-tax-rates.json
│       ├── federal-brackets.json
│       └── holidays.json
│
└── common/                         # Shared utilities
    ├── validation.ts
    ├── money.ts
    └── date.ts
```

### 3.2 Plugin Factory Function

```typescript
// plugins/poland/index.ts

import { pipe } from 'fp-ts/function'
import * as O from 'fp-ts/Option'

import { createTaxModule } from './src/tax/vatCalculation'
import { createTaxReportingModule } from './src/tax/jpkReporting'
import { createInvoiceFormatModule } from './src/invoice/invoiceFormat'
import { createEInvoiceModule } from './src/invoice/ksef'
import { createPaymentFormatModule } from './src/payment/elixir'
import { createBankStatementModule } from './src/payment/mt940'
import { createChartOfAccountsModule } from './src/accounting/polishCoa'
import { createPayrollModule } from './src/payroll/zusCalculation'
import { createComplianceModule } from './src/compliance/whiteList'
import { createNumberFormatModule } from './src/localization/numberFormat'
import { createFiscalCalendarModule } from './src/localization/calendar'
import { createExchangeRateModule } from './src/localization/nbpRates'

import type { CountryPlugin } from '@erp/core/types'

// Plugin factory function - creates the plugin with configuration
export const createPolandPlugin = (config: PolandPluginConfig): CountryPlugin => ({
  // Metadata
  countryCode: 'PL',
  countryCurrency: 'PLN',
  countryName: 'Poland',
  
  // Required Modules (all functions, no classes)
  tax: createTaxModule(config),
  taxReporting: createTaxReportingModule(config),
  invoiceFormat: createInvoiceFormatModule(config),
  paymentFormat: createPaymentFormatModule(config),
  bankStatement: createBankStatementModule(),
  chartOfAccounts: createChartOfAccountsModule(),
  numberFormat: createNumberFormatModule(),
  fiscalCalendar: createFiscalCalendarModule(),
  exchangeRates: createExchangeRateModule(config),
  
  // Optional Modules
  eInvoice: config.ksefEnabled ? O.some(createEInvoiceModule(config)) : O.none,
  payroll: O.some(createPayrollModule(config)),
  payrollReporting: O.some(createPayrollReportingModule(config)),
  depreciation: O.some(createDepreciationModule()),
  financialStatements: O.some(createFinancialStatementsModule()),
  compliance: O.some(createComplianceModule(config)),
})

// Plugin configuration type
type PolandPluginConfig = Readonly<{
  ksefEnabled: boolean
  ksefApiUrl: string
  ksefApiKey: string
  jpkAutoSubmit: boolean
  nbpRateTable: 'A' | 'B' | 'C'
  whiteListApiUrl: string
}>

// Default export
export default createPolandPlugin
```

### 3.3 Example: Tax Module Implementation (Functional)

```typescript
// plugins/poland/src/tax/vatCalculation.ts

import { pipe } from 'fp-ts/function'
import * as A from 'fp-ts/Array'
import * as O from 'fp-ts/Option'
import * as E from 'fp-ts/Either'
import { Decimal } from 'decimal.js'

import type { 
  TaxModule, 
  TaxContext, 
  TaxResult, 
  TaxCode,
  ValidationResult 
} from '@erp/core/types'

// ============================================
// Tax Codes (Pure Data)
// ============================================
const polishTaxCodes: readonly TaxCode[] = [
  { code: 'VAT23', name: 'VAT 23%', rate: new Decimal('0.23'), type: 'vat', isDefault: true },
  { code: 'VAT8', name: 'VAT 8%', rate: new Decimal('0.08'), type: 'vat', isDefault: false },
  { code: 'VAT5', name: 'VAT 5%', rate: new Decimal('0.05'), type: 'vat', isDefault: false },
  { code: 'VAT0', name: 'VAT 0%', rate: new Decimal('0'), type: 'vat', isDefault: false },
  { code: 'VATNP', name: 'VAT NP', rate: new Decimal('0'), type: 'vat', isDefault: false },
  { code: 'VATZW', name: 'VAT ZW', rate: new Decimal('0'), type: 'vat', isDefault: false },
] as const

// ============================================
// Pure Functions
// ============================================

// Get tax code by code string
const findTaxCode = (code: string): O.Option<TaxCode> =>
  pipe(
    polishTaxCodes,
    A.findFirst(tc => tc.code === code)
  )

// Calculate VAT amount (pure)
const calculateVatAmount = (netAmount: Money, rate: Decimal): Money => ({
  amount: netAmount.amount.mul(rate),
  currency: netAmount.currency,
})

// Check if transaction is intra-EU B2B (pure)
const isIntraEuB2B = (context: TaxContext): boolean =>
  pipe(
    context.vendor,
    O.map(v => v.countryCode !== 'PL' && isEuCountry(v.countryCode) && v.isVatRegistered),
    O.getOrElse(() => false)
  )

// Validate Polish NIP (pure)
const validateNip = (nip: string): boolean => {
  const cleanNip = nip.replace(/[\s-]/g, '')
  if (cleanNip.length !== 10 || !/^\d{10}$/.test(cleanNip)) return false
  
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const checksum = weights.reduce((sum, weight, i) => 
    sum + weight * parseInt(cleanNip[i]), 0
  )
  
  return checksum % 11 === parseInt(cleanNip[9])
}

// Main tax calculation function (pure)
const calculateTax: TaxCalculation = (context) =>
  pipe(
    context.transaction.lines,
    A.map(line => {
      const taxCode = pipe(
        findTaxCode(line.taxCode),
        O.getOrElse(() => polishTaxCodes[0])
      )
      
      return {
        taxCode,
        baseAmount: line.netAmount,
        taxAmount: calculateVatAmount(line.netAmount, taxCode.rate),
        isReverseCharge: false,
        isExempt: false,
        exemptReason: O.none,
      }
    })
  )

// Tax ID validator (pure)
const validateTaxId: TaxIdValidator = (taxId, entityType) => {
  const cleanId = taxId.replace(/[\s-]/g, '').toUpperCase()
  
  if (/^\d{10}$/.test(cleanId)) {
    return validateNip(cleanId) 
      ? E.right(cleanId)
      : E.left([{ code: 'INVALID_NIP', message: 'Invalid NIP checksum', field: O.some('taxId') }])
  }
  
  if (/^PL\d{10}$/.test(cleanId)) {
    return validateNip(cleanId.slice(2))
      ? E.right(cleanId)
      : E.left([{ code: 'INVALID_VAT_ID', message: 'Invalid Polish VAT ID', field: O.some('taxId') }])
  }
  
  return E.left([{ code: 'UNKNOWN_FORMAT', message: 'Unknown tax ID format', field: O.some('taxId') }])
}

// ============================================
// Module Factory (returns record of functions)
// ============================================
export const createTaxModule = (config: PolandPluginConfig): TaxModule => ({
  calculateTax,
  getTaxCodes: () => [...polishTaxCodes],
  validateTaxId,
  getTaxRates: (date, category) => pipe(polishTaxCodes, A.filter(tc => tc.type === 'vat')),
  isReverseCharge: isIntraEuB2B,
  checkExemption: () => O.none,
  calculateWithholding: () => O.none,
})
```

### 3.4 Example: Payroll Module (Functional)

```typescript
// plugins/poland/src/payroll/zusCalculation.ts

import { pipe } from 'fp-ts/function'
import * as A from 'fp-ts/Array'
import { Decimal } from 'decimal.js'

// ============================================
// ZUS Rates 2025 (Immutable Data)
// ============================================
const zusRates = {
  emerytalna: { employee: new Decimal('0.0976'), employer: new Decimal('0.0976') },
  rentowa: { employee: new Decimal('0.015'), employer: new Decimal('0.065') },
  chorobowa: { employee: new Decimal('0.0245'), employer: new Decimal('0') },
  wypadkowa: { employee: new Decimal('0'), employer: new Decimal('0.0167') },
  zdrowotna: { employee: new Decimal('0.09'), employer: new Decimal('0') },
} as const

// ============================================
// Pure Calculation Functions
// ============================================

// Calculate single ZUS contribution (pure)
const calculateContribution = (
  gross: Money, 
  rate: Decimal, 
  code: string, 
  name: string
): Deduction => ({
  code,
  name,
  amount: { amount: gross.amount.mul(rate), currency: gross.currency },
  type: 'social_security',
  employeeShare: { amount: gross.amount.mul(rate), currency: gross.currency },
  employerShare: { amount: new Decimal(0), currency: gross.currency },
})

// Calculate all employee ZUS (pure, using composition)
const calculateEmployeeZus = (gross: Money): readonly Deduction[] => [
  calculateContribution(gross, zusRates.emerytalna.employee, 'ZUS_EMER', 'Składka emerytalna'),
  calculateContribution(gross, zusRates.rentowa.employee, 'ZUS_RENT', 'Składka rentowa'),
  calculateContribution(gross, zusRates.chorobowa.employee, 'ZUS_CHOR', 'Składka chorobowa'),
]

// Sum deductions (pure)
const sumDeductions = (deductions: readonly Deduction[]): Decimal =>
  pipe(
    deductions,
    A.reduce(new Decimal(0), (acc, d) => acc.add(d.amount.amount))
  )

// Main gross-to-net calculation (pure function composition)
const calculateGrossToNet: GrossToNetCalculator = (employee, gross, period) => {
  const employeeZus = calculateEmployeeZus(gross)
  const totalZus = sumDeductions(employeeZus)
  
  const grossAfterZus: Money = {
    amount: gross.amount.sub(totalZus),
    currency: gross.currency,
  }
  
  const healthInsurance = calculateContribution(
    grossAfterZus, 
    zusRates.zdrowotna.employee, 
    'NFZ', 
    'Składka zdrowotna'
  )
  
  const allDeductions = [...employeeZus, healthInsurance]
  const totalDeductions = sumDeductions(allDeductions)
  
  return {
    grossPay: gross,
    deductions: allDeductions,
    netPay: { amount: gross.amount.sub(totalDeductions), currency: gross.currency },
    employerCosts: calculateEmployerZus(gross),
    totalCost: { amount: gross.amount.add(sumEmployerCosts(gross)), currency: gross.currency },
  }
}

// Module factory
export const createPayrollModule = (config: PolandPluginConfig): PayrollCalculationModule => ({
  calculateGrossToNet,
  getTaxBrackets: (year) => pitBrackets2025,
  calculateSocialSecurity: calculateEmployeeZus,
  calculateEmployerCosts: calculateEmployerZus,
  getMinimumWage: () => ({ amount: new Decimal(4666), currency: 'PLN' }),
  getPayrollCalendar: generatePolishPayrollCalendar,
})
```

### 3.5 Plugin Manifest

```json
{
  "id": "finance-plugin-poland",
  "name": "Poland Financial Localization",
  "version": "1.0.0",
  "countryCode": "PL",
  "countryCurrency": "PLN",
  "implements": [
    "TaxModule",
    "TaxReportingModule",
    "InvoiceFormatModule",
    "EInvoiceModule",
    "PaymentFormatModule",
    "BankStatementModule",
    "ChartOfAccountsModule",
    "PayrollCalculationModule",
    "ComplianceModule",
    "NumberFormatModule",
    "FiscalCalendarModule",
    "ExchangeRateModule"
  ],
  "configuration": {
    "ksefEnabled": { "type": "boolean", "default": false },
    "jpkAutoSubmit": { "type": "boolean", "default": false },
    "nbpRateTable": { "type": "string", "enum": ["A", "B", "C"], "default": "A" }
  }
}
```

### 3.6 Comparison Matrix

| Feature | Poland | USA | Germany |
|---------|--------|-----|---------|
| **Tax Type** | VAT | Sales Tax | VAT |
| **Standard Rate** | 23% | Varies by state | 19% |
| **E-Invoicing** | KSeF (mandatory 2026) | Optional | XRechnung |
| **Audit File** | JPK (SAF-T PL) | None standard | GoBD |
| **Payment Format** | Elixir/SEPA | ACH | SEPA |
| **Accounting Standard** | Polish GAAP | US GAAP | HGB/IFRS |
| **Social Security** | ZUS | FICA | Sozialversicherung |
| **Currency** | PLN | USD | EUR |
| **Exchange Rate Source** | NBP | Federal Reserve | ECB |

---

## Core Financial Modules

> **Note:** This section describes the Core Engine (Layer 1) functionality. Country-specific behaviors are implemented in Layer 3 plugins and accessed through Layer 2 interfaces.

### 1. General Ledger (GL)

**What it is:** The central repository for all financial transactions. Every money movement in the company eventually posts here. It's the "single source of truth" for financial data.

#### 1.1 Chart of Accounts (CoA)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Hierarchical structure | Multi-level account organization | Core | High |
| Account types | Asset, Liability, Equity, Revenue, Expense, COGS | Core | High |
| Account attributes | Currency, tax code, cost center assignment, status | Core | High |
| **Country templates** | Standard CoA for country (via `IChartOfAccountsTemplate`) | Plugin | High |
| Flexible numbering | Configurable account numbering scheme | Core | Medium |
| **Statutory mapping** | Map accounts to statutory report lines | Plugin | Medium |

#### 1.2 Journal Entries

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Manual entries | User-created entries with debit/credit validation | Core | High |
| Automated entries | System-generated from sub-ledgers (AP, AR, Inventory) | Core | High |
| Recurring entries | Scheduled automatic entries | Core | High |
| Reversing entries | Automatic reversal of accruals | Core | Medium |
| Template entries | Predefined templates for common transactions | Core | Medium |
| Multi-line entries | Complex entries with multiple lines | Core | High |
| Attachment support | Link documents to entries | Core | High |
| **Number formatting** | Country-specific number display (via `INumberFormat`) | Plugin | Medium |

#### 1.3 Period Management

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Fiscal year setup | Define fiscal year structure | Core | High |
| **Fiscal calendar** | Country-specific calendar (via `IFiscalCalendar`) | Plugin | High |
| Period opening/closing | Control which periods accept postings | Core | High |
| Soft close | Allow specific users to post to closed periods | Core | Medium |
| Year-end close | Closing entries and retained earnings | Core | High |
| **Statutory periods** | Country-required reporting periods | Plugin | Medium |

#### 1.4 Audit Trail

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Transaction logging | Record who, when, what for every transaction | Core | High |
| Change history | Track modifications to posted entries | Core | High |
| **Document numbering** | Country-compliant sequential numbering | Plugin | High |
| IP/session tracking | Record access details | Core | Medium |
| **Audit file export** | Generate audit files (via `IAuditFileFormat`) | Plugin | High |

---

### 2. Accounts Payable (AP)

**What it is:** Manages everything you owe to suppliers/vendors. Tracks invoices, schedules payments, and ensures you pay the right amount at the right time.

#### 2.1 Vendor Management

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Vendor master data | Company info, payment terms, bank accounts | Core | High |
| **Tax ID validation** | Validate NIP, EIN, VAT ID (via `ITaxEngine`) | Plugin | High |
| Multiple addresses | Ordering, remittance, correspondence addresses | Core | Medium |
| Vendor categories | Classification for reporting and workflows | Core | Medium |
| Payment terms | Net 30, 2/10 Net 30, etc. | Core | High |
| **Compliance check** | Whitelist, sanctions (via `IComplianceCheck`) | Plugin | High |
| Vendor portal | Self-service for vendors | Core | Low |

#### 2.2 Invoice Processing

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Manual entry | Traditional invoice data entry | Core | High |
| OCR integration | Automatic data extraction | Core | High |
| Three-way matching | Invoice ↔ PO ↔ Goods Receipt | Core | High |
| Two-way matching | Invoice ↔ PO (for services) | Core | High |
| Tolerance handling | Define acceptable variances | Core | Medium |
| Duplicate detection | Prevent duplicate invoice entry | Core | High |
| Multi-currency | Accept invoices in foreign currencies | Core | High |
| Split coding | Distribute across GL accounts/cost centers | Core | Medium |
| **Invoice validation** | Country requirements (via `IInvoiceFormat`) | Plugin | High |
| **Tax calculation** | Calculate taxes (via `ITaxEngine`) | Plugin | High |
| **E-invoice receive** | Receive from KSeF, etc. (via `IEInvoice`) | Plugin | High |

#### 2.3 Approval Workflow

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Approval routing | Route based on amount, vendor, category | Core | High |
| Multi-level approval | Sequential or parallel chains | Core | High |
| Delegation | Temporary rights delegation | Core | Medium |
| Mobile approval | Mobile app approval | Core | Low |
| Escalation | Auto-escalate stuck approvals | Core | Medium |

#### 2.4 Payment Processing

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Payment proposals | System-suggested payments by due date | Core | High |
| Payment methods | Transfer, card, cash, compensation | Core | High |
| Batch payments | Group invoices into single payment run | Core | High |
| Partial payments | Pay portion, track remainder | Core | Medium |
| Payment scheduling | Schedule future-dated payments | Core | Medium |
| **Payment file generation** | Elixir, SEPA, ACH (via `IPaymentFormat`) | Plugin | High |
| **Payment confirmation** | Parse bank confirmations | Plugin | High |
| **Split payment handling** | Country-specific (via `IComplianceCheck`) | Plugin | Medium |

#### 2.5 Reporting

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Aging report | Outstanding by age bucket | Core | High |
| Cash requirements | Forecast cash needed | Core | High |
| Vendor ledger | Transaction history per vendor | Core | High |
| Payment history | Track all payments | Core | High |
| **VAT/Tax reports** | Country tax reports (via `ITaxReporting`) | Plugin | High |

---

### 3. Accounts Receivable (AR)

**What it is:** Manages money owed TO you by customers. Tracks invoices, collections, and ensures healthy cash flow.

#### 3.1 Customer Management

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Customer master data | Company info, payment terms, addresses | Core | High |
| **Tax ID validation** | Validate customer tax ID | Plugin | High |
| Credit management | Credit limits, holds, scoring | Core | High |
| Customer hierarchy | Parent/child for corporate accounts | Core | Medium |
| Payment terms | Standard and customer-specific | Core | High |
| Dunning profiles | Collection aggressiveness per customer | Core | Medium |

#### 3.2 Invoicing

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Sales invoice generation | From sales orders or manual | Core | High |
| Pro-forma invoices | Quotes before actual invoice | Core | Medium |
| Recurring invoices | Automated for subscriptions | Core | Medium |
| Credit notes | Credits for returns, corrections | Core | High |
| Invoice templates | Customizable layouts | Core | Medium |
| Multi-currency invoices | Bill in customer currency | Core | High |
| **Invoice numbering** | Country-compliant (via `IInvoiceFormat`) | Plugin | High |
| **Required fields** | Country-mandatory fields | Plugin | High |
| **E-invoicing** | KSeF, XRechnung (via `IEInvoice`) | Plugin | High |
| **Tax calculation** | Apply correct tax (via `ITaxEngine`) | Plugin | High |

#### 3.3 Payment Collection

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Payment application | Match payments to invoices | Core | High |
| Auto-matching | Automatic based on reference | Core | High |
| Partial payments | Accept and track partial | Core | High |
| Overpayment handling | Credit balance management | Core | Medium |
| Write-offs | Bad debt with approval | Core | Medium |
| Payment reminders | Automated reminder emails | Core | Medium |

#### 3.4 Dunning (Collections)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Dunning levels | Progressive collection letters | Core | Medium |
| Dunning automation | Auto-generate and send | Core | Medium |
| **Interest calculation** | Country statutory rate (via Plugin) | Plugin | Medium |
| Collection actions | Track calls, emails, promises | Core | Low |
| Legal handoff | Flag for legal collection | Core | Low |

#### 3.5 Revenue Recognition

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Recognition rules | When revenue is recognized | Core | Medium |
| Deferred revenue | Track and release over time | Core | Medium |
| Contract revenue | Long-term with milestones | Core | Low |
| **IFRS 15 / US GAAP** | Standard compliance (via Plugin) | Plugin | Low |

---

### 4. Cash & Bank Management

**What it is:** Tracks all cash movements, manages bank accounts, and ensures your books match actual bank balances.

#### 4.1 Bank Account Management

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Multiple accounts | Manage across multiple banks | Core | High |
| Multi-currency accounts | PLN, EUR, USD, etc. | Core | High |
| Account hierarchy | Group by entity, region, purpose | Core | Medium |
| Balance tracking | Real-time visibility | Core | High |
| **Bank account validation** | IBAN, routing (via `IPaymentFormat`) | Plugin | High |

#### 4.2 Bank Reconciliation

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| **Statement import** | MT940, CAMT, BAI2 (via `IBankStatementFormat`) | Plugin | High |
| Auto-matching | Match bank to GL entries | Core | High |
| Matching rules | Configurable rules | Core | High |
| Manual matching | UI for unmatched items | Core | High |
| Reconciliation report | Matched/unmatched, balance | Core | High |
| In-transit items | Track pending transfers | Core | Medium |

#### 4.3 Cash Flow Management

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Cash position | Real-time across all accounts | Core | High |
| Cash forecast | Project based on AR/AP | Core | High |
| Liquidity planning | Plan cash needs | Core | Medium |
| What-if scenarios | Model payment timing | Core | Low |

#### 4.4 Payment Processing

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Outgoing payments | Vendor, salary, tax payments | Core | High |
| Incoming payments | Customer payment recording | Core | High |
| Internal transfers | Between own accounts | Core | High |
| Standing orders | Recurring scheduled payments | Core | Medium |
| Payment status | Monitor lifecycle | Core | High |

---

### 5. Fixed Asset Management

**What it is:** Tracks physical and intangible assets, calculates depreciation, manages lifecycle from acquisition to disposal.

#### 5.1 Asset Register

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Asset master data | Description, location, custodian, serial | Core | High |
| Asset categories | Buildings, machinery, vehicles, IT | Core | High |
| **Asset classification** | KŚT, MACRS (via `IDepreciationMethod`) | Plugin | High |
| Asset hierarchy | Parent/child relationships | Core | Medium |
| Barcode/QR tracking | Physical identification | Core | Low |

#### 5.2 Asset Acquisition

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Purchase capitalization | Create from AP invoice | Core | High |
| Direct entry | Manual asset creation | Core | High |
| Asset transfer | Receive from other entities | Core | Medium |
| Construction in progress | Track assets being built | Core | Medium |
| Capitalization thresholds | Auto-expense below threshold | Core | High |

#### 5.3 Depreciation

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| **Depreciation methods** | Country-allowed (via `IDepreciationMethod`) | Plugin | High |
| Multiple books | Financial vs. tax depreciation | Core | High |
| Depreciation schedules | Preview future depreciation | Core | Medium |
| Automatic posting | Monthly depreciation entries | Core | High |
| Mid-period conventions | Handle mid-month/mid-year | Core | Medium |
| **Useful life lookup** | Standard by asset class | Plugin | High |
| **Special depreciation** | Bonus, accelerated | Plugin | Medium |

#### 5.4 Asset Lifecycle

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Asset transfers | Move between locations/entities | Core | Medium |
| Revaluation | Adjust values (impairment) | Core | Medium |
| Disposal | Sell, scrap with gain/loss | Core | High |
| Retirement | Remove fully depreciated | Core | High |

---

## Advanced Financial Modules

> **Note:** Advanced modules also follow the three-layer architecture. Country-specific implementations are accessed through Layer 2 interfaces.

### 6. Multi-Currency Management

**What it is:** Handles all complexities of operating in multiple currencies—converting transactions, tracking exchange gains/losses, and reporting in different currencies.

#### 6.1 Currency Setup

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Currency master | Define all currencies (PLN, EUR, USD, etc.) | Core | High |
| Base/functional currency | Set company's primary reporting currency | Core | High |
| Exchange rate types | Spot, average, budget, historical rates | Core | High |
| **Rate sources** | Country official source (via `IExchangeRateProvider`) | Plugin | High |
| Rate history | Maintain historical rates | Core | High |

#### 6.2 Transaction Processing

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Multi-currency entry | Post transactions in any currency | Core | High |
| Automatic conversion | Convert at transaction date rate | Core | High |
| Rate override | Manual rate entry when needed | Core | Medium |
| **Currency rounding** | Country-specific rules | Plugin | High |

#### 6.3 Foreign Exchange (FX)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Realized gain/loss | Calculate when payment settles | Core | High |
| Unrealized gain/loss | Revalue open items at period end | Core | High |
| Revaluation process | Monthly/quarterly revaluation | Core | High |
| FX exposure report | Currency exposure across AR/AP/Cash | Core | Medium |
| **FX accounting rules** | Country GAAP requirements | Plugin | Medium |

#### 6.4 Multi-Currency Reporting

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Report currency | Generate reports in any currency | Core | Medium |
| Parallel reporting | Maintain books in multiple currencies | Core | Low |
| Consolidation rates | Apply group rates | Core | Low |

---

### 7. Budgeting & Forecasting

**What it is:** Plan future financial performance, set spending limits, and compare actual results against plans.

#### 7.1 Budget Structure

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Budget hierarchy | Company, department, project, account level | Core | High |
| Budget versions | Draft, approved, revised versions | Core | High |
| Budget periods | Annual, quarterly, monthly breakdown | Core | High |
| Budget templates | Copy from prior year, adjust | Core | Medium |
| Budget workflow | Approval process | Core | Medium |

#### 7.2 Budget Entry

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Manual entry | Direct budget amount entry | Core | High |
| Spread methods | Even, seasonal, custom distribution | Core | Medium |
| Driver-based | Calculate based on drivers | Core | Medium |
| Top-down allocation | Allocate corporate to departments | Core | Medium |
| Bottom-up rollup | Aggregate departments to corporate | Core | Medium |

#### 7.3 Forecasting

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Rolling forecasts | Continuous 12-month forward view | Core | Medium |
| Forecast models | Statistical based on historical data | Core | Low |
| Scenario planning | Best, worst, most likely scenarios | Core | Medium |
| Forecast accuracy | Track vs. actual accuracy | Core | Low |

#### 7.4 Variance Analysis

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Budget vs. Actual | Compare by any dimension | Core | High |
| Variance reports | Amount and percentage variances | Core | High |
| Drill-down | Investigate to transaction level | Core | High |
| Variance alerts | Notify when thresholds exceeded | Core | Medium |
| Commentary | Allow variance explanations | Core | Medium |

---

### 8. Cost Accounting

**What it is:** Detailed tracking of costs to understand true profitability. Essential for manufacturing operations.

#### 8.1 Cost Centers

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Cost center hierarchy | Organize by function | Core | High |
| Cost center master | Define with responsible managers | Core | High |
| Direct cost posting | Post expenses directly | Core | High |
| Cost center reporting | P&L by cost center | Core | High |

#### 8.2 Cost Allocation

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Allocation rules | Define distribution rules | Core | High |
| Allocation bases | Sq meters, headcount, machine hours, revenue | Core | High |
| Step-down allocation | Sequential from service to production | Core | Medium |
| Reciprocal allocation | Mutual service between centers | Core | Low |
| Allocation cycles | Monthly processing | Core | High |

#### 8.3 Product Costing (Manufacturing Integration)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Standard costs | Expected cost per product | Core | High |
| Actual costing | Real cost from production | Core | High |
| Cost components | Material, labor, overhead breakdown | Core | High |
| Cost rollup | Calculate from BOM | Core | High |
| Variance analysis | Standard vs. actual variances | Core | High |

#### 8.4 Project Accounting

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Project master | Define with budgets, timelines | Core | Medium |
| Project cost tracking | Accumulate costs to projects | Core | Medium |
| Project billing | Bill based on progress | Core | Medium |
| WIP accounting | Work-in-progress | Core | Low |
| Project profitability | Revenue minus costs | Core | Medium |

#### 8.5 Profitability Analysis

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Multi-dimensional | By product, customer, region, channel | Core | Medium |
| Contribution margin | Revenue minus variable costs | Core | Medium |
| Full costing | Include allocated overhead | Core | Medium |
| What-if analysis | Model different scenarios | Core | Low |

---

### 9. Multi-Entity / Intercompany

**What it is:** Manage multiple legal entities with automatic handling of transactions between them and consolidated reporting.

#### 9.1 Entity Structure

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Entity master | Define legal entities | Core | Medium |
| Entity hierarchy | Parent/subsidiary relationships | Core | Medium |
| Shared master data | Share vendors, customers, CoA | Core | Medium |
| **Entity country** | Assign country plugin to entity | Plugin | High |
| **Entity-specific settings** | Local currency, tax rules | Plugin | Medium |

#### 9.2 Intercompany Transactions

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Intercompany invoicing | Bill between entities | Core | Medium |
| Automatic mirroring | Create offsetting entry | Core | Medium |
| Transfer pricing | Appropriate pricing between entities | Core | Low |
| Intercompany reconciliation | Match and reconcile balances | Core | Medium |

#### 9.3 Consolidation

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Elimination entries | Remove intercompany transactions | Core | Medium |
| Currency translation | Convert subsidiaries to group currency | Core | Medium |
| Minority interest | Non-controlling interests | Core | Low |
| **Consolidated statements** | Country-format (via `IFinancialStatementFormat`) | Plugin | Medium |

---

### 10. Tax Management

**What it is:** Handles all tax calculations, filings, and compliance. This module is HEAVILY plugin-dependent as tax rules vary dramatically by country.

> ⚠️ **Important:** Tax Management is almost entirely implemented through country plugins. The Core Engine provides only the framework for tax handling.

#### 10.1 Tax Framework (Core)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Tax code registry | Store tax codes from plugins | Core | High |
| Tax calculation hook | Invoke plugin tax calculation | Core | High |
| Tax amount storage | Store calculated tax amounts | Core | High |
| Tax account mapping | Map tax codes to GL accounts | Core | High |
| Tax reporting hook | Invoke plugin tax reports | Core | High |

#### 10.2 Tax Implementation (Plugin)

| Feature | Description | Interface | Priority |
|---------|-------------|-----------|----------|
| Tax rate management | Define country tax rates | `ITaxEngine` | High |
| Tax calculation | Calculate taxes on transactions | `ITaxEngine` | High |
| Tax validation | Validate tax requirements | `ITaxEngine` | High |
| VAT/Sales tax return | Generate tax returns | `ITaxReporting` | High |
| Tax submission | Submit to tax authority | `ITaxReporting` | High |
| Withholding tax | Calculate WHT on payments | `ITaxEngine` | Medium |
| Tax exemptions | Handle exempt transactions | `ITaxEngine` | Medium |

#### 10.3 Tax Types by Country

| Country | Primary Tax | Other Taxes |
|---------|-------------|-------------|
| Poland | VAT (23%, 8%, 5%, 0%) | CIT, PIT, ZUS |
| USA | Sales Tax (varies) | Federal/State income |
| Germany | VAT (19%, 7%) | Solidarity surcharge |
| UK | VAT (20%, 5%, 0%) | Corporation tax |

---

## Financial Reporting & Analytics

### 11. Financial Statements

**What it is:** Standard financial reports required by law and used by stakeholders. Format and structure are country-dependent.

#### 11.1 Core Reporting Engine

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Report builder | Define report structure and data sources | Core | High |
| Data aggregation | Aggregate GL data by dimensions | Core | High |
| Period comparison | Current vs. prior period/year | Core | High |
| Drill-down engine | Navigate from summary to detail | Core | High |
| Export formats | PDF, Excel, HTML, CSV | Core | High |
| Report scheduler | Automated generation and distribution | Core | Medium |
| Report caching | Cache for performance | Core | Medium |

#### 11.2 Statutory Reports (Plugin-Dependent)

| Report | Description | Interface |
|--------|-------------|-----------|
| Balance Sheet | Assets, Liabilities, Equity | `IFinancialStatementFormat` |
| Income Statement (P&L) | Revenue and expenses | `IFinancialStatementFormat` |
| Cash Flow Statement | Cash movements | `IFinancialStatementFormat` |
| Statement of Changes in Equity | Equity movement | `IFinancialStatementFormat` |
| Notes to Statements | Required disclosures | `IFinancialStatementFormat` |

#### 11.3 Country Statement Formats

| Country | Balance Sheet | P&L | Notes |
|---------|---------------|-----|-------|
| Poland | Bilans (Ustawa) | RZiS | Per Ustawa o rachunkowości |
| USA | US GAAP format | Multi-step/Single-step | MD&A |
| Germany | HGB format | GKV/UKV | Anhang |
| IFRS | IAS 1 format | By function/nature | Full IFRS |

### 12. Management Reporting

**What it is:** Internal reports for decision-making, not constrained by accounting standards.

#### 12.1 Dashboards

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| KPI dashboards | Key metrics at a glance | Core | High |
| Real-time updates | Live data refresh | Core | High |
| Role-based views | Different dashboards per role | Core | Medium |
| Mobile access | View on mobile devices | Core | Low |
| Widget library | Reusable dashboard components | Core | Medium |

#### 12.2 Analytics

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Trend analysis | Historical performance trends | Core | Medium |
| Ratio analysis | Liquidity, profitability, efficiency | Core | Medium |
| Benchmarking | Compare against targets | Core | Medium |
| Ad-hoc queries | User-created analysis | Core | Medium |
| Data export | Export for external BI tools | Core | Medium |

### 13. Compliance & Audit

**What it is:** Features ensuring regulatory compliance and audit support. Heavily plugin-dependent.

#### 13.1 Internal Controls (Core)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Segregation of duties | Prevent conflicting actions | Core | High |
| Approval limits | Authority by amount | Core | High |
| Access controls | Role-based permissions | Core | High |
| Audit logging | Track all access and changes | Core | High |

#### 13.2 Audit Support (Core + Plugin)

| Feature | Description | Layer | Priority |
|---------|-------------|-------|----------|
| Audit trail reports | Trace to source | Core | High |
| Document retention | Maintain per legal requirements | Core | High |
| Auditor access | Read-only for external auditors | Core | Medium |
| Confirmation letters | AR/AP confirmation requests | Core | Low |
| **Audit file generation** | SAF-T, GoBD (via `IAuditFileFormat`) | Plugin | High |

#### 13.3 Country Audit Requirements

| Country | Audit File | Retention | Other |
|---------|------------|-----------|-------|
| Poland | JPK (SAF-T PL) | 5 years | KSeF integration |
| Germany | GoBD | 10 years | DATEV export |
| France | FEC | 10 years | E-invoicing |
| UK | MTD | 6 years | Making Tax Digital |

---

## Integration Points

### Internal Module Integrations

> **Note:** Internal integrations are Core Engine (Layer 1) functionality. They work identically regardless of country.

#### Manufacturing Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Production costs | Material, labor, overhead from production orders | High |
| WIP valuation | Work-in-progress inventory value | High |
| Finished goods | Cost of completed products to inventory | High |
| Scrap and waste | Write-off of production losses | High |
| Variance posting | Standard vs. actual cost variances | High |

#### Inventory Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Inventory valuation | Total inventory value for balance sheet | High |
| COGS | Cost of goods sold when items shipped | High |
| Inventory adjustments | Write-offs, write-ups, cycle count adjustments | High |
| Receipt accruals | Goods received not invoiced (GRNI) | High |
| Inventory transfers | Intercompany inventory movements | Medium |

#### Sales Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Sales orders | Revenue recognition trigger | High |
| Customer invoices | AR invoice creation from sales | High |
| Returns and credits | Credit note processing | High |
| Shipping | Revenue recognition on delivery | High |
| Commissions | Sales commission accruals | Medium |

#### Purchasing Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Purchase orders | Commitment tracking | High |
| Goods receipts | Accrual of received goods | High |
| Vendor invoices | AP invoice matching to PO | High |
| Returns to vendor | Debit note processing | Medium |

#### HRM Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Employee master | Employee data for payroll processing | High |
| Time tracking | Labor hours for cost allocation | High |
| Attendance data | Input for payroll calculation | High |
| Expense reports | Employee expense reimbursements | High |
| Headcount data | For budget planning and allocation | Medium |
| **Gross salary** | Input to payroll calculation | High |
| **Payroll calculation** | Via `IPayrollCalculation` plugin | High |
| **Payroll journal** | Monthly payroll accounting entries | High |
| **Tax deductions** | Income tax, social security | High |
| **Benefit costs** | Health insurance, pension contributions | High |
| **Leave accruals** | Vacation and sick leave liability | Medium |
| **Bonus accruals** | Performance bonus provisions | Medium |
| **Payroll reports** | Via `IPayrollReporting` plugin | High |

##### HRM → Finance Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            HRM MODULE                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Employee    Time &        Leave        Expense      Benefits           │
│  Master      Attendance    Management   Reports      Enrollment         │
│     │            │             │            │             │              │
└─────┼────────────┼─────────────┼────────────┼─────────────┼──────────────┘
      │            │             │            │             │
      ▼            ▼             ▼            ▼             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PAYROLL PROCESSING (Finance Module)                   │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              IPayrollCalculation (Country Plugin)                │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │
│  │  │ Gross Pay   │→ │ Deductions  │→ │ Net Pay                 │  │    │
│  │  │ Calculation │  │ • Income Tax│  │                         │  │    │
│  │  │             │  │ • Soc.Secur.│  │ Poland: ZUS, PIT, NFZ   │  │    │
│  │  │             │  │ • Benefits  │  │ USA: FICA, Fed/State Tax│  │    │
│  │  │             │  │ • Other     │  │ Germany: Sozialvers.    │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                   │                                      │
│                                   ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    PAYROLL JOURNAL CREATION                      │    │
│  │  DR: Salary Expense (by cost center)         XXX                 │    │
│  │  DR: Employer Social Security Expense        XXX                 │    │
│  │  DR: Benefits Expense                        XXX                 │    │
│  │      CR: Salaries Payable                         XXX            │    │
│  │      CR: Income Tax Payable                       XXX            │    │
│  │      CR: Social Security Payable                  XXX            │    │
│  │      CR: Benefits Payable                         XXX            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                   │                                      │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            ┌───────────────┐              ┌───────────────┐
            │ General Ledger│              │ Bank/Payment  │
            │    Posting    │              │  Processing   │
            └───────────────┘              └───────────────┘
```

#### CRM Module → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Customer data | Customer master sync | High |
| Opportunities | Revenue forecasting | Medium |
| Contracts | Billing schedules, revenue recognition | Medium |
| Customer credit | Credit limit updates | Medium |

#### Project Management → Finance

| Data Flow | Description | Priority |
|-----------|-------------|----------|
| Project costs | Labor, materials, expenses to projects | Medium |
| Project billing | Invoice generation from milestones | Medium |
| Project budgets | Budget vs. actual tracking | Medium |
| Resource costs | Hourly rates for time tracking | Medium |

---

### External System Integrations

> **Note:** External integrations are primarily implemented through country plugins (Layer 3), using interfaces defined in Layer 2.

#### Banking Integration

| Integration | Description | Interface | Priority |
|-------------|-------------|-----------|----------|
| Bank statement import | MT940, CAMT, BAI2, CSV | `IBankStatementFormat` | High |
| Payment file export | SEPA, ACH, Elixir, SWIFT | `IPaymentFormat` | High |
| Direct bank connection | API (Open Banking, PSD2) | `IBankIntegration` | Medium |
| Real-time balance | Live balance inquiry | `IBankIntegration` | Low |

##### Banking Integration by Country

| Country | Statement Formats | Payment Formats | Direct Connection |
|---------|-------------------|-----------------|-------------------|
| Poland | MT940, CAMT.053 | Elixir, SEPA | Open Banking API |
| USA | BAI2, OFX | ACH, Wire | Plaid, bank APIs |
| Germany | MT940, CAMT.053 | SEPA | FinTS/HBCI |
| UK | MT940, CAMT.053 | BACS, SEPA | Open Banking |

#### Tax Authority Integration

| Integration | Description | Interface | Priority |
|-------------|-------------|-----------|----------|
| Tax filing submission | Submit returns electronically | `ITaxReporting` | High |
| E-invoicing | National systems | `IEInvoice` | High |
| Tax validation | Validate tax IDs | `IComplianceCheck` | High |

##### Tax Authority Integration by Country

| Country | Tax Submission | E-Invoicing | Other |
|---------|----------------|-------------|-------|
| Poland | JPK via e-Deklaracje | KSeF | White List API |
| USA | IRS e-file | N/A | State portals |
| Germany | ELSTER | XRechnung | - |
| Italy | Agenzia Entrate | SDI | - |
| France | impots.gouv.fr | Chorus Pro | FEC |

#### OCR / Document Processing

| Integration | Description | Layer | Priority |
|-------------|-------------|-------|----------|
| Invoice OCR | Extract data from scanned invoices | Core | High |
| Receipt scanning | Process expense receipts | Core | Medium |
| Document classification | Auto-categorize documents | Core | Medium |
| **Data validation** | Validate against country rules | Plugin | High |

#### Payment Gateways

| Integration | Description | Layer | Priority |
|-------------|-------------|-------|----------|
| Credit card processing | Accept customer card payments | Core | Medium |
| Online payments | PayPal, Stripe | Core | Low |
| **Local methods** | BLIK (PL), Zelle (US), etc. | Plugin | Low |

#### External Data Feeds

| Integration | Description | Interface | Priority |
|-------------|-------------|-----------|----------|
| Exchange rates | Official rates | `IExchangeRateProvider` | High |
| Credit scoring | External credit services | Core | Low |
| Address validation | Postal address verification | Plugin | Low |

##### Exchange Rate Sources by Country

| Country | Official Source | Endpoint |
|---------|-----------------|----------|
| Poland | NBP | api.nbp.pl |
| USA | Federal Reserve | federalreserve.gov |
| Eurozone | ECB | ecb.europa.eu |
| UK | Bank of England | bankofengland.co.uk |

#### BI / Analytics Platforms

| Integration | Description | Layer | Priority |
|-------------|-------------|-------|----------|
| Data warehouse export | Feed to DW/BI | Core | Medium |
| API access | REST API for external tools | Core | Medium |
| Real-time streaming | Live data for dashboards | Core | Low |

---

### Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SYSTEMS                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Banks  │ │Tax Auth.│ │E-Invoice│ │   OCR   │ │ Payment │ │   BI    │   │
│  │         │ │         │ │ Systems │ │Services │ │Gateways │ │ Tools   │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       │          │          │          │          │          │             │
└───────┼──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┘
        │          │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     LAYER 3: COUNTRY PLUGINS                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Poland: Elixir, KSeF, NBP, JPK, White List                           │   │
│  │ USA: ACH, IRS e-file, Fed Reserve, state tax                         │   │
│  │ Germany: SEPA, ELSTER, ECB, XRechnung                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
├────────────────────────────────────┼─────────────────────────────────────────┤
│                     LAYER 2: INTERFACES                                      │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐    │
│  │IBankStatement │ │ITaxReporting  │ │IEInvoice      │ │IExchangeRate  │    │
│  │Format         │ │               │ │               │ │Provider       │    │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘    │
│          │                 │                 │                 │             │
├──────────┼─────────────────┼─────────────────┼─────────────────┼─────────────┤
│          ▼                 ▼                 ▼                 ▼             │
│                     LAYER 1: CORE ENGINE                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Integration Manager (orchestrates all integrations)                  │   │
│  │  • Queues outbound messages                                          │   │
│  │  • Processes inbound data                                            │   │
│  │  • Handles retries and errors                                        │   │
│  │  • Logs all integration activity                                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    FINANCIAL MODULES                                  │   │
│  │    GL    │    AP    │    AR    │   Cash   │  Assets  │   Tax        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Plugin Development Guide

### Creating a New Country Plugin

This section provides guidelines for implementing a new country localization plugin.

#### Step 1: Create Plugin Structure

```
plugins/
└── {country-code}/
    ├── manifest.json          # Required: Plugin metadata
    ├── src/
    │   ├── {Country}Plugin.ts # Required: Main plugin class
    │   ├── tax/               # Tax-related implementations
    │   ├── invoice/           # Invoice format implementations
    │   ├── payment/           # Payment format implementations
    │   ├── payroll/           # Payroll calculation implementations
    │   ├── accounting/        # Accounting standards implementations
    │   └── compliance/        # Compliance check implementations
    ├── data/                  # Static data files
    │   ├── tax-rates.json
    │   ├── chart-of-accounts.json
    │   └── holidays.json
    └── locales/               # Translation files
        └── {lang}.json
```

#### Step 2: Implement Required Interfaces

| Interface | Required | Description |
|-----------|----------|-------------|
| `ITaxEngine` | ✅ Yes | Tax calculations |
| `IInvoiceFormat` | ✅ Yes | Invoice requirements |
| `IPaymentFormat` | ✅ Yes | Payment file formats |
| `IChartOfAccountsTemplate` | ✅ Yes | Standard CoA |
| `INumberFormat` | ✅ Yes | Number formatting |
| `IFiscalCalendar` | ✅ Yes | Fiscal year rules |
| `IExchangeRateProvider` | ✅ Yes | Official rate source |
| `ITaxReporting` | Recommended | Tax filings |
| `IEInvoice` | If applicable | E-invoicing |
| `IPayrollCalculation` | Recommended | Payroll |
| `IDepreciationMethod` | Recommended | Asset depreciation |
| `IComplianceCheck` | Recommended | Compliance rules |
| `IAuditFileFormat` | If applicable | Audit files |
| `IFinancialStatementFormat` | Recommended | Statutory reports |

#### Step 3: Register Plugin

```typescript
// src/PolandPlugin.ts
export class PolandPlugin implements ICountryPlugin {
  readonly countryCode = 'PL';
  readonly countryCurrency = 'PLN';
  readonly countryName = 'Poland';
  
  // Register all interface implementations
  register(container: Container): void {
    container.bind(ITaxEngine).to(PolandTaxEngine);
    container.bind(IInvoiceFormat).to(PolandInvoiceFormat);
    container.bind(IEInvoice).to(KSeFIntegration);
    container.bind(IPaymentFormat).to(ElixirFormat);
    container.bind(IPaymentFormat).to(SEPAPolandFormat);
    container.bind(IBankStatementFormat).to(MT940Format);
    container.bind(IChartOfAccountsTemplate).to(PolishCoA);
    container.bind(IPayrollCalculation).to(PolandPayroll);
    container.bind(ITaxReporting).to(JPKReporting);
    container.bind(IExchangeRateProvider).to(NBPRateProvider);
    container.bind(IComplianceCheck).to(PolandCompliance);
    container.bind(IDepreciationMethod).to(PolandDepreciation);
    container.bind(IFiscalCalendar).to(PolandCalendar);
    container.bind(INumberFormat).to(PolandNumberFormat);
  }
}
```

### Plugin Configuration Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^finance-plugin-[a-z]{2,3}$"
    },
    "countryCode": {
      "type": "string",
      "pattern": "^[A-Z]{2}$",
      "description": "ISO 3166-1 alpha-2 country code"
    },
    "countryCurrency": {
      "type": "string",
      "pattern": "^[A-Z]{3}$",
      "description": "ISO 4217 currency code"
    },
    "implements": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 6
    },
    "configuration": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "type": { "enum": ["string", "boolean", "number", "array"] },
          "default": {},
          "description": { "type": "string" }
        }
      }
    }
  },
  "required": ["id", "countryCode", "countryCurrency", "implements"]
}
```

### Testing Requirements

| Test Type | Requirement |
|-----------|-------------|
| Unit Tests | 80%+ coverage on all interface implementations |
| Integration Tests | Test against Core Engine |
| Compliance Tests | Validate against official country requirements |
| Sample Data | Provide test data for all scenarios |

---

## Implementation Priority

### Phase 1: Core Engine Foundation (Months 1-3)

**Focus:** Build Layer 1 (Core Engine) and Layer 2 (Interfaces)

#### Layer 1 - Core Components
| Component | Description | Month |
|-----------|-------------|-------|
| General Ledger | CoA, journal entries, periods, audit trail | 1 |
| Accounts Payable | Vendor management, invoicing, basic payments | 1-2 |
| Accounts Receivable | Customer management, invoicing | 2 |
| Bank Management | Bank accounts, basic reconciliation | 2-3 |
| Multi-Currency | Currency setup, conversion, basic FX | 3 |

#### Layer 2 - Interface Definitions
| Interface | Description | Month |
|-----------|-------------|-------|
| `ITaxEngine` | Tax calculation contract | 1 |
| `IInvoiceFormat` | Invoice requirements contract | 1 |
| `IPaymentFormat` | Payment file format contract | 2 |
| `IBankStatementFormat` | Statement import contract | 2 |
| `IChartOfAccountsTemplate` | CoA template contract | 1 |
| `INumberFormat` | Number formatting contract | 1 |
| `IFiscalCalendar` | Fiscal calendar contract | 1 |
| `IExchangeRateProvider` | Rate provider contract | 2 |

### Phase 2: First Country Plugin - Poland (Months 4-6)

**Focus:** Build Layer 3 plugin for Poland as reference implementation

#### Poland Plugin Components
| Component | Interface | Month |
|-----------|-----------|-------|
| Polish Tax Engine | `ITaxEngine` | 4 |
| VAT rates (23%, 8%, 5%, 0%) | `ITaxEngine` | 4 |
| Polish Invoice Format | `IInvoiceFormat` | 4 |
| JPK_V7 Reporting | `ITaxReporting` | 4-5 |
| KSeF Integration | `IEInvoice` | 5 |
| Elixir Payment Format | `IPaymentFormat` | 5 |
| SEPA Poland | `IPaymentFormat` | 5 |
| MT940/CAMT Import | `IBankStatementFormat` | 5 |
| Polish CoA (Ustawa) | `IChartOfAccountsTemplate` | 4 |
| NBP Rate Provider | `IExchangeRateProvider` | 5 |
| Polish Number Format | `INumberFormat` | 4 |
| White List Compliance | `IComplianceCheck` | 6 |
| Split Payment (MPP) | `IComplianceCheck` | 6 |

### Phase 3: Advanced Core + US Plugin (Months 7-9)

**Focus:** Extend Core Engine and add second country plugin

#### Core Engine Extensions
| Component | Description | Month |
|-----------|-------------|-------|
| Fixed Assets | Asset register, depreciation | 7 |
| Cost Centers | Basic cost allocation | 7 |
| Budgeting | Budget creation and tracking | 8 |
| Financial Statements | Core reporting engine | 8 |
| Advanced Bank Reconciliation | Auto-matching, rules | 9 |

#### Layer 2 - Additional Interfaces
| Interface | Description | Month |
|-----------|-------------|-------|
| `IDepreciationMethod` | Depreciation rules contract | 7 |
| `IPayrollCalculation` | Payroll calculation contract | 8 |
| `IPayrollReporting` | Payroll reporting contract | 8 |
| `IFinancialStatementFormat` | Statutory reports contract | 8 |
| `IAuditFileFormat` | Audit file contract | 9 |

#### USA Plugin (Proof of Multi-Country)
| Component | Interface | Month |
|-----------|-----------|-------|
| US Tax Engine | `ITaxEngine` | 7 |
| Sales Tax by State | `ITaxEngine` | 7-8 |
| US Invoice Format | `IInvoiceFormat` | 7 |
| ACH Payment Format | `IPaymentFormat` | 8 |
| BAI2 Statement Import | `IBankStatementFormat` | 8 |
| US GAAP CoA | `IChartOfAccountsTemplate` | 7 |
| Federal Reserve Rates | `IExchangeRateProvider` | 8 |
| US Number Format | `INumberFormat` | 7 |
| 1099 Reporting | `ITaxReporting` | 9 |
| MACRS Depreciation | `IDepreciationMethod` | 9 |

### Phase 4: Enterprise Features + Payroll (Months 10-12)

**Focus:** Multi-entity, consolidation, full payroll

#### Core Engine - Enterprise
| Component | Description | Month |
|-----------|-------------|-------|
| Multi-Entity | Entity management | 10 |
| Intercompany | Automatic mirroring, reconciliation | 10-11 |
| Consolidation | Elimination, translation | 11 |
| Advanced Reporting | Dashboards, analytics | 11-12 |
| Forecasting | Rolling forecasts, scenarios | 12 |

#### Payroll Integration (Both Countries)
| Component | Country | Month |
|-----------|---------|-------|
| ZUS Calculation | Poland | 10 |
| PIT Calculation | Poland | 10 |
| PIT-11 Generation | Poland | 11 |
| FICA Calculation | USA | 10 |
| Federal Withholding | USA | 10 |
| State Withholding | USA | 11 |
| W-2 Generation | USA | 11 |

### Dependency Graph

```
Month 1-3: Core Foundation
┌─────────────────────────────────────────────────────────────┐
│  GL ──────► AP ──────► AR ──────► Bank ──────► Multi-Curr  │
│   │                                                         │
│   └──► Interfaces (ITaxEngine, IInvoiceFormat, etc.)       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
Month 4-6: Poland Plugin
┌─────────────────────────────────────────────────────────────┐
│  Polish Tax ──► JPK ──► KSeF ──► Elixir ──► Compliance     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
Month 7-9: Advanced Core + USA Plugin
┌─────────────────────────────────────────────────────────────┐
│  Core: Fixed Assets ──► Cost Centers ──► Budgeting         │
│  USA:  US Tax ──► Sales Tax ──► ACH ──► 1099               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
Month 10-12: Enterprise + Payroll
┌─────────────────────────────────────────────────────────────┐
│  Multi-Entity ──► Intercompany ──► Consolidation           │
│  PL Payroll: ZUS ──► PIT ──► PIT-11                        │
│  US Payroll: FICA ──► Fed/State ──► W-2                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Correctness Properties & Invariants

> **📋 Adjusted by Gregory spec:** This section added based on Gregory's formal correctness properties, adapted for FP property-based testing.

The following invariants MUST hold at all times. These are implemented as property-based tests and database constraints.

### Fundamental Accounting Invariants

#### INV-1: Debit/Credit Balance Invariant
```
∀ journal_entry: SUM(debit_amounts) = SUM(credit_amounts)
```

**Implementation:**
```typescript
// Property-based test
const prop_balanced_entry = fc.property(
  arbitraryJournalEntry,
  (entry) => {
    const totalDebits = sumDebits(entry.lines)
    const totalCredits = sumCredits(entry.lines)
    return totalDebits.equals(totalCredits)
  }
)

// Pure validation function
const isBalanced: (entry: JournalEntry) => boolean = (entry) =>
  pipe(
    entry.lines,
    A.reduce(
      { debits: Decimal.ZERO, credits: Decimal.ZERO },
      (acc, line) => ({
        debits: acc.debits.add(line.debit.amount),
        credits: acc.credits.add(line.credit.amount),
      })
    ),
    ({ debits, credits }) => debits.equals(credits)
  )
```

**Database Constraint:**
```sql
ALTER TABLE journal_entries ADD CONSTRAINT chk_balanced 
CHECK (
  (SELECT SUM(debit_amount) FROM journal_lines WHERE entry_id = id) =
  (SELECT SUM(credit_amount) FROM journal_lines WHERE entry_id = id)
);
```

---

#### INV-2: Account Balance Consistency
```
∀ account: balance = SUM(debits) - SUM(credits) for normal debit accounts
∀ account: balance = SUM(credits) - SUM(debits) for normal credit accounts
```

**Implementation:**
```typescript
type NormalBalance = 'debit' | 'credit'

const normalBalanceByClass: Record<AccountClass, NormalBalance> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
}

const calculateAccountBalance = (
  account: Account,
  entries: JournalLine[]
): Money => {
  const debits = sumBy(entries, l => l.debit.amount)
  const credits = sumBy(entries, l => l.credit.amount)
  
  return normalBalanceByClass[account.class] === 'debit'
    ? Money.of(debits.sub(credits), account.currency)
    : Money.of(credits.sub(debits), account.currency)
}
```

---

#### INV-3: Trial Balance Invariant
```
∀ period: SUM(all_debit_balances) = SUM(all_credit_balances)
```

**Implementation:**
```typescript
const prop_trial_balance = fc.property(
  arbitraryPeriod,
  arbitraryAccounts,
  arbitraryJournalEntries,
  (period, accounts, entries) => {
    const trialBalance = generateTrialBalance(accounts, entries, period)
    return trialBalance.totalDebits.equals(trialBalance.totalCredits)
  }
)
```

---

#### INV-4: Period Closure Integrity
```
∀ entry: IF entry.period.status = 'HARD_CLOSED' THEN entry.status ≠ 'DRAFT'
∀ entry: IF entry.posted_at IS NOT NULL THEN entry.period.status ∈ ['OPEN', 'SOFT_CLOSED']
```

**Implementation:**
```typescript
type PeriodStatus = 'open' | 'soft_closed' | 'hard_closed'

const canPostToperiod = (period: FiscalPeriod): boolean =>
  period.status === 'open' || period.status === 'soft_closed'

const validatePostingPeriod: (entry: JournalEntry, period: FiscalPeriod) 
  => Validation<ValidationError[], JournalEntry> = (entry, period) =>
    canPostToPeriod(period)
      ? E.right(entry)
      : E.left([{ 
          code: 'PERIOD_CLOSED', 
          message: `Cannot post to ${period.status} period`, 
          field: O.some('postingDate') 
        }])
```

---

#### INV-5: Invoice Payment Consistency
```
∀ invoice: amount_paid ≤ total_amount
∀ invoice: IF amount_paid = total_amount THEN status = 'PAID'
∀ invoice: IF 0 < amount_paid < total_amount THEN status = 'PARTIALLY_PAID'
```

**Implementation:**
```typescript
const deriveInvoiceStatus = (invoice: Invoice): InvoiceStatus => {
  if (invoice.amountPaid.isZero()) return 'unpaid'
  if (invoice.amountPaid.gte(invoice.totalAmount)) return 'paid'
  return 'partially_paid'
}

// Property: status is always consistent with amounts
const prop_invoice_status_consistency = fc.property(
  arbitraryInvoice,
  (invoice) => invoice.status === deriveInvoiceStatus(invoice)
)
```

---

#### INV-6: Bank Reconciliation Integrity
```
∀ bank_transaction: IF status = 'RECONCILED' THEN matched_entry_id IS NOT NULL
∀ reconciliation: book_balance + uncleared_items = bank_balance
```

**Implementation:**
```typescript
const validateReconciliation = (
  bookBalance: Money,
  bankBalance: Money,
  unclearedItems: BankTransaction[]
): Validation<ReconciliationError[], ReconciliationResult> => {
  const unclearedTotal = sumUnclearedItems(unclearedItems)
  const expectedBankBalance = Money.add(bookBalance, unclearedTotal)
  
  return expectedBankBalance.equals(bankBalance)
    ? E.right({ status: 'balanced', difference: Money.zero(bookBalance.currency) })
    : E.left([{ 
        code: 'RECONCILIATION_MISMATCH',
        expected: expectedBankBalance,
        actual: bankBalance,
        difference: Money.subtract(bankBalance, expectedBankBalance)
      }])
}
```

---

#### INV-7: Multi-Currency Conversion Integrity
```
∀ entry: IF currency ≠ base_currency THEN base_amount = foreign_amount × exchange_rate
∀ fx_gain_loss: realized_gain_loss = payment_base_amount - original_base_amount
```

**Implementation:**
```typescript
const validateCurrencyConversion = (
  foreignAmount: Money,
  baseAmount: Money,
  exchangeRate: ExchangeRate,
  tolerance: Decimal = new Decimal('0.01')
): boolean => {
  const expectedBase = foreignAmount.amount.mul(exchangeRate.rate)
  return baseAmount.amount.sub(expectedBase).abs().lte(tolerance)
}
```

---

### Immutability Invariants

#### INV-8: Posted Entry Immutability
```
∀ entry: IF status = 'POSTED' THEN entry fields are immutable
```

**Implementation:**
```typescript
// Posted entries cannot be modified - only reversed
type PostedEntry = Readonly<{
  readonly id: EntryId
  readonly lines: ReadonlyArray<JournalLine>
  readonly postedAt: Instant
  readonly postedBy: UserId
  // ... all fields readonly
}>

// To correct: create reversing entry + new correcting entry
const correctEntry = (
  original: PostedEntry,
  correction: JournalEntryInput
): Task<Result<[ReversalEntry, CorrectionEntry], Error>>
```

---

### Property-Based Test Suite

```typescript
describe('Accounting Invariants', () => {
  // INV-1: All entries must balance
  it('every journal entry balances', () => {
    fc.assert(prop_balanced_entry, { numRuns: 1000 })
  })
  
  // INV-3: Trial balance always balances
  it('trial balance totals equal', () => {
    fc.assert(prop_trial_balance, { numRuns: 100 })
  })
  
  // INV-5: Invoice status matches payment state
  it('invoice status consistent with payments', () => {
    fc.assert(prop_invoice_status_consistency, { numRuns: 500 })
  })
  
  // INV-7: Currency conversions are accurate
  it('currency conversion within tolerance', () => {
    fc.assert(
      fc.property(
        arbitraryForeignAmount,
        arbitraryExchangeRate,
        (amount, rate) => {
          const converted = convert(amount, rate)
          return validateCurrencyConversion(amount, converted, rate)
        }
      )
    )
  })
})
```

---

## Technical Considerations

### Functional Programming Stack

#### Recommended Libraries (TypeScript)

| Library | Purpose | Usage |
|---------|---------|-------|
| **fp-ts** | FP primitives | Option, Either, Task, Reader, pipe |
| **io-ts** | Runtime type validation | Decode external data, validate inputs |
| **decimal.js** | Precise decimal arithmetic | All money calculations |
| **date-fns** | Immutable date operations | Date manipulation |
| **effect** | Effect system | Async operations with typed errors |
| **zod** | Schema validation | API input/output validation |

#### Core FP Patterns Used

| Pattern | Description | Where Used |
|---------|-------------|------------|
| **Pipe/Flow** | Function composition | All transformations |
| **Option<T>** | Null safety | Optional values |
| **Either<E, T>** | Error handling | Validation, operations that can fail |
| **Task<T>** | Async operations | API calls, DB operations |
| **Reader<R, T>** | Dependency injection | Configuration, repositories |
| **State<S, T>** | State transformations | Transaction processing |
| **Validation<E[], T>** | Accumulating errors | Form validation, bulk operations |

### Three-Layer Architecture Implementation

#### Layer 1: Core Engine (Pure Functions)

```typescript
// All business logic as pure functions
// No side effects, no mutations

// Example: Journal Entry validation (pure)
const validateJournalEntry = (entry: JournalEntry): Validation<ValidationError[], JournalEntry> =>
  pipe(
    entry,
    validateNotEmpty,
    E.chain(validateBalanced),
    E.chain(validatePeriodOpen),
    E.chain(validateAccounts),
  )

// Example: Balance calculation (pure)
const calculateBalance = (accountId: AccountId, period: Period) =>
  (entries: JournalEntry[]): Money =>
    pipe(
      entries,
      A.filter(e => e.period === period),
      A.flatMap(e => e.lines),
      A.filter(l => l.accountId === accountId),
      A.reduce(Money.zero('PLN'), (acc, line) => 
        Money.add(acc, Money.subtract(line.debit, line.credit))
      )
    )
```

#### Layer 2: Type Contracts (Types Only)

```typescript
// No implementation, just type definitions
// Plugins must provide functions matching these signatures

type TaxCalculation = (context: TaxContext) => TaxResult[]
type PaymentFormatter = (payments: Payment[]) => Result<PaymentFile, FormatError>
type RateProvider = (date: LocalDate) => Task<ExchangeRate[]>
```

#### Layer 3: Plugin System (Function Factories)

```typescript
// Plugins export factory functions that return modules (records of functions)
// No classes, no inheritance

type CountryPlugin = Readonly<{
  tax: TaxModule
  payroll: PayrollModule
  // ... other modules
}>

// Plugin registration (functional)
const registerPlugin = (
  registry: PluginRegistry,
  plugin: CountryPlugin
): PluginRegistry =>
  Map.set(registry, plugin.countryCode, plugin)

// Plugin resolution (functional)
const getPlugin = (
  registry: PluginRegistry,
  countryCode: CountryCode
): Option<CountryPlugin> =>
  Map.get(registry, countryCode)
```

### Effect Boundary Pattern

```typescript
// ============================================
// Pure Core (no side effects)
// ============================================
const processInvoicePure = (
  invoice: Invoice,
  taxCalc: TaxCalculation
): Result<ProcessedInvoice, ProcessingError> =>
  pipe(
    invoice,
    validateInvoice,
    E.map(applyTax(taxCalc)),
    E.map(calculateTotals),
  )

// ============================================
// Effect Boundary (side effects isolated here)
// ============================================
const processInvoice = (invoiceId: InvoiceId): Task<Result<ProcessedInvoice, Error>> =>
  pipe(
    // Effect: fetch from database
    fetchInvoice(invoiceId),
    T.map(invoice =>
      pipe(
        // Effect: get plugin for country
        getPluginForCountry(invoice.countryCode),
        O.map(plugin =>
          // Pure: process invoice
          processInvoicePure(invoice, plugin.tax.calculateTax)
        ),
        O.getOrElse(() => E.left(new Error('Plugin not found')))
      )
    ),
    // Effect: save to database
    T.chain(result =>
      pipe(
        result,
        E.fold(
          error => T.of(E.left(error)),
          processed => pipe(
            saveInvoice(processed),
            T.map(() => E.right(processed))
          )
        )
      )
    )
  )
```

### Data Model (Immutable)

```typescript
// All types are readonly (immutable)
type Invoice = Readonly<{
  id: InvoiceId
  invoiceNumber: string
  invoiceDate: LocalDate
  lines: ReadonlyArray<InvoiceLine>
  status: InvoiceStatus
  countryCode: CountryCode
  countryData: Readonly<Record<string, unknown>>
}>

// Updates create new objects
const updateInvoiceStatus = (
  invoice: Invoice, 
  newStatus: InvoiceStatus
): Invoice => ({
  ...invoice,
  status: newStatus,
})

// No mutation, pure transformation
const addLine = (
  invoice: Invoice, 
  line: InvoiceLine
): Invoice => ({
  ...invoice,
  lines: [...invoice.lines, line],
})
```

### Database Layer (Effect Isolation)

```typescript
// Repository as Reader monad (dependency injection via function params)
type InvoiceRepository = Readonly<{
  findById: (id: InvoiceId) => Task<Option<Invoice>>
  save: (invoice: Invoice) => Task<Invoice>
  findByPeriod: (period: Period) => Task<Invoice[]>
}>

// Repository implementation returns Tasks (deferred side effects)
const createInvoiceRepository = (db: Database): InvoiceRepository => ({
  findById: (id) => () =>
    db.query('SELECT * FROM invoices WHERE id = $1', [id])
      .then(rows => rows.length > 0 ? O.some(rowToInvoice(rows[0])) : O.none),
  
  save: (invoice) => () =>
    db.query(
      'INSERT INTO invoices (...) VALUES (...) ON CONFLICT DO UPDATE ...',
      invoiceToParams(invoice)
    ).then(() => invoice),
  
  findByPeriod: (period) => () =>
    db.query(
      'SELECT * FROM invoices WHERE invoice_date BETWEEN $1 AND $2',
      [period.start, period.end]
    ).then(rows => rows.map(rowToInvoice)),
})
```

### Plugin Data Storage (JSON Column)

```sql
-- Core table with plugin extension point
CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    country_code CHAR(2) NOT NULL,
    
    -- Plugin-specific data as immutable JSON
    country_data JSONB DEFAULT '{}' NOT NULL,
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1  -- Optimistic locking
);

-- Example country_data for Poland:
-- { "ksef_number": "123", "jpk_included": true, "split_payment": false }

-- Example country_data for USA:
-- { "sales_tax_state": "CA", "nexus_state": "CA" }
```

### Testing Strategy (Property-Based)

```typescript
// Pure functions are easy to test
// Use property-based testing for comprehensive coverage

import * as fc from 'fast-check'

describe('Money', () => {
  it('add is commutative', () => {
    fc.assert(
      fc.property(
        fc.integer(), fc.integer(),
        (a, b) => {
          const m1 = Money.of(a, 'PLN')
          const m2 = Money.of(b, 'PLN')
          expect(Money.add(m1, m2)).toEqual(Money.add(m2, m1))
        }
      )
    )
  })

  it('add is associative', () => {
    fc.assert(
      fc.property(
        fc.integer(), fc.integer(), fc.integer(),
        (a, b, c) => {
          const m1 = Money.of(a, 'PLN')
          const m2 = Money.of(b, 'PLN')
          const m3 = Money.of(c, 'PLN')
          expect(Money.add(Money.add(m1, m2), m3))
            .toEqual(Money.add(m1, Money.add(m2, m3)))
        }
      )
    )
  })
})

describe('calculateTax (Poland)', () => {
  it('VAT amount = net * rate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000000 }),
        (netAmount) => {
          const context = createTaxContext(netAmount, 'VAT23')
          const result = calculateTax(context)
          
          expect(result[0].taxAmount.amount.toNumber())
            .toBeCloseTo(netAmount * 0.23, 2)
        }
      )
    )
  })
})
```

### Performance Requirements

| Metric | Target |
|--------|--------|
| Transaction entry | < 500ms response |
| Report generation (standard) | < 30 seconds |
| Report generation (complex) | < 2 minutes |
| Bank reconciliation | 1000+ transactions/minute |
| Plugin function call | < 10ms per call |
| Multi-currency conversion | < 5ms per transaction |

### Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| RBAC | Function-level access control via Reader monad |
| Immutability | All data types readonly, no mutations |
| Audit logging | Event sourcing pattern for all changes |
| Input validation | io-ts/zod at system boundaries |
| Plugin sandboxing | Plugins receive only allowed dependencies |

---

## Open Questions & Technical Risks

> **📋 Adjusted by Gregory spec:** This section expanded with detailed technical risks from Gregory's specification.

### Critical Technical Risks

#### 1. Concurrency / Race Conditions ⚠️

**Question:** What happens if two users try to post entries affecting the same account simultaneously?

| Consideration | Options | Recommendation |
|---------------|---------|----------------|
| **Locking Strategy** | Pessimistic (SELECT FOR UPDATE) vs Optimistic (version numbers) | Optimistic locking with version columns |
| **Transaction Isolation** | READ COMMITTED vs SERIALIZABLE | SERIALIZABLE for posting operations |
| **Balance Calculation** | Real-time vs Cached | Period-end snapshots + current period calculation |
| **Reconciliation Conflicts** | Concurrent matching attempts | Row-level locking on bank transactions |

**Proposed FP Approach:**
```typescript
// Optimistic locking via version in state
type AccountState = Readonly<{
  accountId: AccountId
  balance: Money
  version: number  // Optimistic lock
}>

// State transition returns new version
const updateBalance: (state: AccountState, delta: Money) 
  => Result<AccountState, ConcurrencyError>
```

**Decision Needed:** Confirm isolation level and locking strategy.

---

#### 2. Performance / Balance Caching Strategy ⚠️

**Question:** For large ledger volumes (1M+ transactions/year), should we implement incremental balance caches?

| Approach | Pros | Cons |
|----------|------|------|
| **Always calculate** | Simple, always accurate | Slow at scale |
| **Materialized balance** | Fast reads | Complex invalidation |
| **Period-end snapshots** | Safe (immutable once closed) | Recalc needed for open periods |
| **Running balance column** | Very fast reads | Write complexity |

**Proposed Approach:**
```typescript
// Balance calculation using period snapshots (pure function)
const calculateBalance = (
  accountId: AccountId,
  asOfDate: LocalDate,
  periodSnapshots: PeriodSnapshot[],
  currentPeriodEntries: JournalEntry[]
): Money =>
  pipe(
    // Find most recent closed period snapshot
    findLatestSnapshot(periodSnapshots, asOfDate),
    O.map(snapshot => 
      // Add current period entries to snapshot balance
      pipe(
        currentPeriodEntries,
        A.filter(e => e.accountId === accountId),
        A.reduce(snapshot.balance, addEntryToBalance)
      )
    ),
    O.getOrElse(() => calculateFromScratch(accountId, currentPeriodEntries))
  )
```

**Decision Needed:** Confirm caching strategy and acceptable query latency (<500ms for balance queries).

---

#### 3. Error Handling & Rollback Strategy

**Question:** What are the standard error categories and rollback behaviors?

| Error Category | Behavior | FP Type | Example |
|----------------|----------|---------|---------|
| **Validation Error** | Reject immediately, no state change | `Left<ValidationError[]>` | Unbalanced journal entry |
| **Business Rule Error** | Reject, no state change | `Left<BusinessRuleError>` | Posting to closed period |
| **Concurrency Error** | Reject, suggest retry | `Left<ConcurrencyError>` | Optimistic lock failure |
| **Infrastructure Error** | Rollback, log, alert | `TaskEither` failure | Database connection failure |

**Standardized Error Types:**
```typescript
type FinanceError =
  | { tag: 'ValidationError'; errors: ValidationError[]; field?: string }
  | { tag: 'BusinessRuleError'; code: BusinessErrorCode; message: string }
  | { tag: 'ConcurrencyError'; entity: string; expectedVersion: number; actualVersion: number }
  | { tag: 'InfrastructureError'; cause: Error; retryable: boolean }

type BusinessErrorCode =
  | 'PERIOD_CLOSED'
  | 'ACCOUNT_INACTIVE'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_REFERENCE'
  | 'CURRENCY_MISMATCH'
  | 'ENTRY_ALREADY_POSTED'
  | 'ENTRY_ALREADY_RECONCILED'
```

**Decision Needed:** Confirm error handling strategy and whether to implement automatic retry for transient errors.

---

### Architecture Questions

| Question | Options | Impact |
|----------|---------|--------|
| Primary language? | TypeScript vs PHP/Symfony | Development speed, team skills |
| Plugin isolation level? | Process vs. in-memory | Security vs. performance |
| Multi-tenancy model? | Shared DB vs. separate DB per tenant | Scalability, isolation |

### Functional Questions

| Question | Context | Decision Needed |
|----------|---------|-----------------|
| IFRS support? | International reporting standards | In addition to local GAAP |
| Multi-entity timeline? | When needed? | Phase 4 or earlier |
| Which countries first? | Poland + USA proposed | Confirm priority |
| Payroll scope? | Full payroll or just journal integration? | Complexity decision |
| **Accounting method?** | Cash-based vs Accrual accounting | Support both? Default? |

### Technical Questions

| Question | Context | Decision Needed |
|----------|---------|-----------------|
| User volume? | Concurrent finance users | Infrastructure sizing |
| Transaction volume? | Monthly transaction counts | Database design |
| Historical migration? | Data from existing systems | Migration strategy |
| Hosting model? | Cloud, on-premise, hybrid | Infrastructure choice |
| **Balance caching?** | Period snapshots vs real-time calculation | Performance vs complexity |

### Compliance Questions

| Question | Context | Decision Needed |
|----------|---------|-----------------|
| KSeF timeline? | Mandatory B2B from 2026 | Priority for Poland plugin |
| Which US states? | Sales tax nexus | USA plugin scope |
| Audit requirements? | Which certifications needed | SOC 2, ISO 27001? |
| **SOX compliance?** | Sarbanes-Oxley audit trail requirements | Required for US public companies |
| **GAAP/IFRS scope?** | Specific standard support | Foundation vs full compliance |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-22 | - | Initial draft based on research |
| 2.0 | 2025-01-22 | - | Refactored for three-layer architecture |
| 2.1 | 2025-01-23 | - | Converted to functional programming paradigm |
| 2.2 | 2025-01-27 | Gregory (reviewed) | Integrated Gregory's spec: concurrency risks, correctness properties, journal entry types, period states, compound taxes, AR write-offs, currency rounding, SOX compliance |
| 2.3 | 2025-01-28 | - | Added missing sections from original scope: User Stories, NFRs, Use Cases, Success Criteria, Database Schema, API Design |

### Gregory Spec Integration Summary

The following items from Gregory's specification were incorporated (marked with "📋 Adjusted by Gregory spec"):

**Added:**
- Open Questions & Technical Risks section (concurrency, balance caching, error handling)
- Correctness Properties & Invariants section (INV-1 through INV-8)
- Journal entry types: Standard, Adjusting, Closing, Reversing
- Period states: Open, Soft-Closed, Hard-Closed
- Compound tax support and tax-inclusive/exclusive pricing
- Tax jurisdiction support for multi-state/province
- AR write-off handling with journal entries
- Currency rounding rules and rounding modes
- Cash vs Accrual accounting method support
- SOX/GAAP/IFRS compliance framework

**Not incorporated (already covered or doesn't fit FP approach):**
- OOP class-based design (kept FP approach)
- Mutable data models (kept immutable types)
- DDD aggregate boundaries (using function composition instead)
- Basic Chart of Accounts (already present)
- Basic AP/AR lifecycle (already present)
- Basic bank reconciliation (already present)

---

## User Stories

> **📋 From original scope:** Added complete user stories section.

| # | As a... | I want to... | So that... |
|---|---------|--------------|------------|
| 1 | Accountant | define and maintain chart of accounts | I can structure financial data according to business needs |
| 2 | Accountant | post journal entries manually | I can record adjustments and corrections |
| 3 | AP Clerk | enter vendor invoices | I can track amounts owed to suppliers |
| 4 | AP Clerk | match invoices to purchase orders | I can verify invoice accuracy before payment |
| 5 | AR Clerk | generate customer invoices from sales orders | billing is automated and accurate |
| 6 | AR Clerk | record customer payments | I can track outstanding receivables |
| 7 | Treasury Manager | reconcile bank statements | I can identify discrepancies and errors |
| 8 | Treasury Manager | process batch payments | I can pay multiple vendors efficiently |
| 9 | Controller | execute period-end close | I can finalize monthly financials |
| 10 | Controller | generate financial statements | I can report to management and stakeholders |
| 11 | CFO | view real-time financial dashboard | I can make informed business decisions |
| 12 | Auditor | access complete audit trail | I can verify transaction history |
| 13 | Tax Manager | configure tax codes | I can ensure proper tax calculation |
| 14 | Tax Manager | generate tax reports | I can file tax returns accurately |
| 15 | Finance Manager | manage multiple currencies | I can support international operations |
| 16 | Finance Manager | set budget limits | I can control spending |
| 17 | System Admin | configure approval workflows | I can enforce segregation of duties |
| 18 | Business User | view account balances | I can monitor departmental spending |

---

## Non-Functional Requirements

> **📋 From original scope:** Added complete NFR section.

| ID | Requirement | Target | Implementation |
|----|-------------|--------|----------------|
| NFR-1 | All financial postings must be atomic | Full transaction rollback on error | Database transactions with SERIALIZABLE isolation |
| NFR-2 | Audit trail must be immutable | No deletion of posted transactions | Append-only audit tables, soft deletes |
| NFR-3 | Support large chart of accounts | 10,000+ account entries | Indexed queries, lazy loading |
| NFR-4 | Handle high transaction volume | 1 million+ transactions/year | Table partitioning by fiscal year |
| NFR-5 | Period close performance | Complete in < 5 minutes | Parallel processing, pre-computed balances |
| NFR-6 | Report generation performance | < 10 seconds for standard reports | Materialized views, query optimization |
| NFR-7 | Concurrent users | 100+ simultaneous users | Connection pooling, optimistic locking |
| NFR-8 | System availability | 99.9% uptime during business hours | Health checks, failover, monitoring |
| NFR-9 | Data backup | Every 4 hours with PITR | PostgreSQL WAL archiving |
| NFR-10 | Database | PostgreSQL 14+ with proper indexing | Composite indexes on transaction tables |
| NFR-11 | Data retention | 7 years for SOX compliance | Archive strategy, cold storage |
| NFR-12 | Multi-tenancy | Complete data isolation | Row-level security, tenant_id on all tables |
| NFR-13 | Deployments | Zero downtime for patches | Blue-green deployments |
| NFR-14 | Currency precision | 4 decimal places | DECIMAL(19,4) for all amounts |
| NFR-15 | Balance lookup response | < 200ms | Redis cache, period snapshots |

---

## Database Schema (MVP)

> **📋 From original scope:** Added database schema with FP considerations.

### Core Tables

```sql
-- ============================================
-- GENERAL LEDGER
-- ============================================

CREATE TABLE gl_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    account_class VARCHAR(20) NOT NULL CHECK (account_class IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    account_type VARCHAR(50),
    parent_id UUID REFERENCES gl_account(id),
    currency_code CHAR(3) NOT NULL,
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
    is_active BOOLEAN DEFAULT true,
    is_reconciliation_required BOOLEAN DEFAULT false,
    country_code CHAR(2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1,  -- Optimistic locking
    UNIQUE (tenant_id, code)
);

CREATE TABLE gl_journal_entry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entry_number VARCHAR(50) NOT NULL,
    entry_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    period_id UUID NOT NULL REFERENCES gl_period(id),
    entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('standard', 'adjusting', 'closing', 'reversing')),
    description TEXT NOT NULL,
    reference VARCHAR(100),
    currency_code CHAR(3) NOT NULL,
    exchange_rate DECIMAL(19,6) DEFAULT 1,
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'pending_approval', 'posted', 'reversed')),
    reverses_entry_id UUID REFERENCES gl_journal_entry(id),
    reversed_by_entry_id UUID REFERENCES gl_journal_entry(id),
    scheduled_reversal_date DATE,
    posted_at TIMESTAMPTZ,
    posted_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID NOT NULL,
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, entry_number)
);

CREATE TABLE gl_journal_line (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID NOT NULL REFERENCES gl_journal_entry(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    account_id UUID NOT NULL REFERENCES gl_account(id),
    description TEXT,
    debit_amount DECIMAL(19,4) DEFAULT 0,
    credit_amount DECIMAL(19,4) DEFAULT 0,
    base_debit_amount DECIMAL(19,4) DEFAULT 0,  -- In base currency
    base_credit_amount DECIMAL(19,4) DEFAULT 0,
    cost_center_id UUID,
    project_id UUID,
    tax_code VARCHAR(20),
    CONSTRAINT chk_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    )
);

CREATE TABLE gl_period (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    fiscal_year INTEGER NOT NULL,
    period_number INTEGER NOT NULL,
    period_name VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'soft_closed', 'hard_closed')),
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    -- Period-end balance snapshot for performance
    balance_snapshot JSONB,
    UNIQUE (tenant_id, fiscal_year, period_number)
);

-- ============================================
-- ACCOUNTS PAYABLE
-- ============================================

CREATE TABLE ap_vendor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    tax_id VARCHAR(50),
    tax_id_type VARCHAR(20),  -- NIP, EIN, VAT, etc.
    country_code CHAR(2) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    payment_terms_code VARCHAR(20),
    payment_method VARCHAR(20) DEFAULT 'transfer',
    bank_account_number VARCHAR(50),
    bank_routing_number VARCHAR(20),
    iban VARCHAR(34),
    swift_bic VARCHAR(11),
    credit_limit DECIMAL(19,4),
    is_active BOOLEAN DEFAULT true,
    country_data JSONB DEFAULT '{}',  -- Plugin-specific data
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, code)
);

CREATE TABLE ap_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    invoice_number VARCHAR(50) NOT NULL,
    vendor_id UUID NOT NULL REFERENCES ap_vendor(id),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    period_id UUID NOT NULL REFERENCES gl_period(id),
    currency_code CHAR(3) NOT NULL,
    exchange_rate DECIMAL(19,6) DEFAULT 1,
    net_amount DECIMAL(19,4) NOT NULL,
    tax_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
    gross_amount DECIMAL(19,4) NOT NULL,
    amount_paid DECIMAL(19,4) DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'pending_approval', 'approved', 'posted', 'partially_paid', 'paid', 'cancelled')),
    po_id UUID,  -- Link to purchase order
    goods_receipt_id UUID,  -- Link to goods receipt
    matching_status VARCHAR(20) CHECK (matching_status IN ('unmatched', 'matched', 'exception')),
    journal_entry_id UUID REFERENCES gl_journal_entry(id),
    country_code CHAR(2),
    country_data JSONB DEFAULT '{}',  -- KSeF number, split payment flag, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, vendor_id, invoice_number)
);

CREATE TABLE ap_invoice_line (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES ap_invoice(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(19,4) DEFAULT 1,
    unit_price DECIMAL(19,4) NOT NULL,
    net_amount DECIMAL(19,4) NOT NULL,
    tax_code VARCHAR(20),
    tax_amount DECIMAL(19,4) DEFAULT 0,
    account_id UUID NOT NULL REFERENCES gl_account(id),
    cost_center_id UUID,
    po_line_id UUID  -- Link to PO line for matching
);

CREATE TABLE ap_payment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payment_number VARCHAR(50) NOT NULL,
    payment_date DATE NOT NULL,
    vendor_id UUID NOT NULL REFERENCES ap_vendor(id),
    bank_account_id UUID NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    reference VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'approved', 'processed', 'confirmed', 'failed', 'cancelled')),
    journal_entry_id UUID REFERENCES gl_journal_entry(id),
    payment_file_id UUID,  -- Link to generated payment file
    bank_reference VARCHAR(100),  -- Bank confirmation reference
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, payment_number)
);

-- ============================================
-- ACCOUNTS RECEIVABLE  
-- ============================================

CREATE TABLE ar_customer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    tax_id VARCHAR(50),
    tax_id_type VARCHAR(20),
    country_code CHAR(2) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    payment_terms_code VARCHAR(20),
    credit_limit DECIMAL(19,4),
    credit_status VARCHAR(20) DEFAULT 'good' CHECK (credit_status IN ('good', 'warning', 'hold', 'blocked')),
    dunning_level INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    country_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, code)
);

CREATE TABLE ar_invoice (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    invoice_number VARCHAR(50) NOT NULL,
    customer_id UUID NOT NULL REFERENCES ar_customer(id),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    period_id UUID NOT NULL REFERENCES gl_period(id),
    currency_code CHAR(3) NOT NULL,
    exchange_rate DECIMAL(19,6) DEFAULT 1,
    net_amount DECIMAL(19,4) NOT NULL,
    tax_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
    gross_amount DECIMAL(19,4) NOT NULL,
    amount_paid DECIMAL(19,4) DEFAULT 0,
    write_off_amount DECIMAL(19,4) DEFAULT 0,
    write_off_reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'written_off', 'cancelled')),
    sales_order_id UUID,  -- Link to sales order
    journal_entry_id UUID REFERENCES gl_journal_entry(id),
    country_code CHAR(2),
    country_data JSONB DEFAULT '{}',  -- KSeF number, e-invoice status, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, invoice_number)
);

-- ============================================
-- BANK / CASH MANAGEMENT
-- ============================================

CREATE TABLE bank_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    iban VARCHAR(34),
    swift_bic VARCHAR(11),
    bank_name VARCHAR(200),
    currency_code CHAR(3) NOT NULL,
    gl_account_id UUID NOT NULL REFERENCES gl_account(id),
    account_type VARCHAR(20) CHECK (account_type IN ('checking', 'savings', 'credit_card')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1,
    UNIQUE (tenant_id, account_number)
);

CREATE TABLE bank_statement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID NOT NULL REFERENCES bank_account(id),
    statement_date DATE NOT NULL,
    opening_balance DECIMAL(19,4) NOT NULL,
    closing_balance DECIMAL(19,4) NOT NULL,
    import_format VARCHAR(20),  -- MT940, CAMT053, BAI2, CSV, OFX
    raw_content TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID
);

CREATE TABLE bank_statement_line (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id UUID NOT NULL REFERENCES bank_statement(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    value_date DATE NOT NULL,
    amount DECIMAL(19,4) NOT NULL,
    reference VARCHAR(100),
    description TEXT,
    transaction_code VARCHAR(20),
    counterparty_name VARCHAR(200),
    counterparty_account VARCHAR(50),
    status VARCHAR(20) DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'reconciled', 'excluded')),
    matched_entry_id UUID REFERENCES gl_journal_entry(id),
    matched_at TIMESTAMPTZ,
    matched_by UUID
);

-- ============================================
-- AUDIT TRAIL (Immutable)
-- ============================================

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'post', 'void', 'approve')),
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    user_id UUID NOT NULL,
    user_ip INET,
    session_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE audit_log_2025_01 PARTITION OF audit_log
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

### Indexing Strategy

```sql
-- GL Performance Indexes
CREATE INDEX idx_gl_journal_entry_period ON gl_journal_entry(tenant_id, period_id, status);
CREATE INDEX idx_gl_journal_entry_posting_date ON gl_journal_entry(tenant_id, posting_date);
CREATE INDEX idx_gl_journal_line_account ON gl_journal_line(account_id, entry_id);

-- Balance Calculation Index (most critical)
CREATE INDEX idx_balance_calculation ON gl_journal_line(account_id) 
    INCLUDE (debit_amount, credit_amount, base_debit_amount, base_credit_amount)
    WHERE entry_id IN (SELECT id FROM gl_journal_entry WHERE status = 'posted');

-- AP Performance Indexes
CREATE INDEX idx_ap_invoice_vendor ON ap_invoice(tenant_id, vendor_id, status);
CREATE INDEX idx_ap_invoice_due_date ON ap_invoice(tenant_id, due_date) WHERE status IN ('approved', 'posted', 'partially_paid');

-- AR Performance Indexes
CREATE INDEX idx_ar_invoice_customer ON ar_invoice(tenant_id, customer_id, status);
CREATE INDEX idx_ar_invoice_due_date ON ar_invoice(tenant_id, due_date) WHERE status IN ('sent', 'partially_paid', 'overdue');

-- Bank Reconciliation Index
CREATE INDEX idx_bank_statement_line_match ON bank_statement_line(status, amount, transaction_date);

-- Audit Log Indexes
CREATE INDEX idx_audit_log_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at);
```

---

## API Design

> **📋 From original scope:** Added API design details.

### RESTful Endpoints (MVP)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Chart of Accounts** | | |
| GET | `/api/v1/gl/accounts` | List accounts (with filters) |
| POST | `/api/v1/gl/accounts` | Create account |
| GET | `/api/v1/gl/accounts/{id}` | Get account details |
| PUT | `/api/v1/gl/accounts/{id}` | Update account |
| DELETE | `/api/v1/gl/accounts/{id}` | Deactivate account |
| GET | `/api/v1/gl/accounts/{id}/balance` | Get account balance |
| **Journal Entries** | | |
| GET | `/api/v1/gl/entries` | List entries (with filters) |
| POST | `/api/v1/gl/entries` | Create entry (draft) |
| POST | `/api/v1/gl/entries/{id}/post` | Post entry |
| POST | `/api/v1/gl/entries/{id}/reverse` | Reverse entry |
| **Periods** | | |
| GET | `/api/v1/gl/periods` | List fiscal periods |
| POST | `/api/v1/gl/periods/{id}/close` | Close period |
| POST | `/api/v1/gl/periods/{id}/reopen` | Reopen period (with auth) |
| **AP** | | |
| POST | `/api/v1/ap/invoices` | Create vendor invoice |
| POST | `/api/v1/ap/invoices/{id}/approve` | Approve invoice |
| POST | `/api/v1/ap/payments` | Create payment |
| POST | `/api/v1/ap/payments/batch` | Create batch payment |
| **AR** | | |
| POST | `/api/v1/ar/invoices` | Create customer invoice |
| POST | `/api/v1/ar/payments` | Record customer payment |
| POST | `/api/v1/ar/invoices/{id}/write-off` | Write off invoice |
| **Bank** | | |
| POST | `/api/v1/bank/statements/import` | Import bank statement |
| POST | `/api/v1/bank/reconciliation/match` | Match transactions |
| POST | `/api/v1/bank/reconciliation/complete` | Complete reconciliation |
| **Reports** | | |
| GET | `/api/v1/reports/trial-balance` | Generate trial balance |
| GET | `/api/v1/reports/balance-sheet` | Generate balance sheet |
| GET | `/api/v1/reports/income-statement` | Generate P&L |
| GET | `/api/v1/reports/aging` | Generate aging report |

### Webhook Events

```typescript
type WebhookEvent =
  | { event: 'invoice.created'; payload: Invoice }
  | { event: 'invoice.approved'; payload: Invoice }
  | { event: 'invoice.posted'; payload: { invoice: Invoice; journalEntry: JournalEntry } }
  | { event: 'payment.created'; payload: Payment }
  | { event: 'payment.processed'; payload: Payment }
  | { event: 'payment.confirmed'; payload: Payment }
  | { event: 'period.closing'; payload: FiscalPeriod }
  | { event: 'period.closed'; payload: FiscalPeriod }
  | { event: 'budget.warning'; payload: { budget: Budget; utilization: Decimal } }
  | { event: 'budget.exceeded'; payload: { budget: Budget; overage: Money } }
  | { event: 'reconciliation.completed'; payload: Reconciliation }
```

### Rate Limiting

| Tier | Limit | Burst |
|------|-------|-------|
| Standard | 1,000 requests/hour | 100 requests/minute |
| Premium | 10,000 requests/hour | 500 requests/minute |
| Batch Import | 100 requests/hour | 10 requests/minute |

---

## Use Case Examples

> **📋 From original scope:** Added detailed use case scenarios.

### Use Case 1: Month-End Close Process

```typescript
// Functional implementation of month-end close workflow
type CloseStep = 
  | { step: 'trial_balance_check'; status: 'pending' | 'passed' | 'failed' }
  | { step: 'recurring_entries'; status: 'pending' | 'completed'; entriesPosted: number }
  | { step: 'bank_reconciliation'; status: 'pending' | 'completed'; accountsReconciled: number }
  | { step: 'adjusting_entries'; status: 'pending' | 'completed' }
  | { step: 'report_generation'; status: 'pending' | 'completed' }
  | { step: 'period_lock'; status: 'pending' | 'completed' }

type MonthEndCloseState = Readonly<{
  periodId: PeriodId
  steps: CloseStep[]
  startedAt: Instant
  completedAt: Option<Instant>
  completedBy: Option<UserId>
}>

const executeMonthEndClose: (period: FiscalPeriod) => Task<Result<MonthEndCloseState, CloseError>>
```

**Steps:**
1. Run preliminary trial balance check (verify debits = credits)
2. Post recurring journal entries (depreciation, accruals)
3. Execute bank reconciliations for all accounts
4. Post adjustment entries
5. Generate financial statements (BS, P&L, Cash Flow)
6. Review and approve reports
7. Lock period from further posting
8. Archive reports

**Duration Target:** 2-4 hours (< 3 calendar days)

---

### Use Case 2: Vendor Invoice Processing (Three-Way Match)

```typescript
type MatchResult =
  | { status: 'matched'; variance: Money }
  | { status: 'price_variance'; variance: Money; toleranceExceeded: boolean }
  | { status: 'quantity_variance'; expected: number; received: number }
  | { status: 'unmatched'; reason: string }

const threeWayMatch: (
  invoice: APInvoice,
  purchaseOrder: PurchaseOrder,
  goodsReceipt: GoodsReceipt,
  tolerances: MatchTolerances
) => MatchResult
```

**Steps:**
1. AP clerk enters invoice or OCR scans
2. System matches to purchase order by PO number
3. System validates: price variance < configured tolerance (e.g., 5%)
4. System checks: quantity received >= quantity invoiced
5. If match OK: Auto-approve (or route to standard approval)
6. If variance exceeds tolerance: Route to manager approval
7. Post to GL: DR Expense/Inventory, CR Accounts Payable
8. Update payment due date based on terms

**Tolerances:**
- Price variance: 5% or $50 (whichever is greater)
- Quantity variance: 0% (exact match required)

---

### Use Case 3: Customer Payment Application

```typescript
type PaymentAllocation = Readonly<{
  invoiceId: InvoiceId
  amountApplied: Money
  discountTaken: Money
  remainingBalance: Money
}>

const allocatePayment: (
  payment: CustomerPayment,
  openInvoices: ARInvoice[],
  strategy: 'oldest_first' | 'largest_first' | 'manual'
) => PaymentAllocation[]
```

**Steps:**
1. AR clerk enters payment (check, wire, ACH)
2. System suggests invoices to apply (oldest first for customer)
3. Clerk reviews and confirms allocation
4. System posts: DR Bank, CR Accounts Receivable
5. System updates customer aging
6. System marks invoices as paid/partially paid
7. If overpayment: Create unapplied credit balance
8. Send notification to sales rep when large customer pays

---

### Use Case 4: Multi-Currency Sales Invoice

```typescript
const createMultiCurrencyInvoice: (
  salesOrder: SalesOrder,
  transactionCurrency: CurrencyCode,
  rateProvider: ExchangeRateModule
) => Task<Result<ARInvoice, InvoiceError>>

const settleMultiCurrencyPayment: (
  invoice: ARInvoice,
  payment: CustomerPayment,
  settlementRate: ExchangeRate
) => { payment: AppliedPayment; fxGainLoss: FXGainLoss }
```

**Steps:**
1. System retrieves EUR/USD exchange rate for order date
2. Generate invoice in EUR (customer currency)
3. Calculate USD equivalent (EUR amount × rate)
4. Post AR: DR Accounts Receivable (USD), CR Revenue (USD)
5. Store both EUR and USD amounts
6. On payment in EUR:
    - Calculate payment USD equivalent at payment date rate
    - Calculate realized G/L = (payment rate - invoice rate) × EUR amount
    - Post: DR Cash (USD), DR/CR Realized G/L, CR AR (USD)

---

### Use Case 5: Bank Reconciliation

```typescript
type ReconciliationStatus = Readonly<{
  bankAccount: BankAccountId
  statementDate: LocalDate
  bookBalance: Money
  bankBalance: Money
  matchedCount: number
  unmatchedCount: number
  depositsInTransit: Money
  outstandingChecks: Money
  adjustments: Money
  difference: Money
  isBalanced: boolean
}>

const autoMatchTransactions: (
  statementLines: BankStatementLine[],
  glEntries: JournalEntry[],
  rules: MatchingRule[]
) => { matched: MatchedPair[]; unmatched: BankStatementLine[] }
```

**Steps:**
1. Import bank statement (CSV, MT940, CAMT.053, BAI2, OFX)
2. System auto-matches transactions using rules:
    - Exact amount + close date match (±3 days)
    - Check number match
    - Reference number match
3. Clerk reviews unmatched items:
    - Outstanding checks (issued but not cleared)
    - Deposits in transit (recorded but not on statement)
    - Bank charges (not yet recorded)
4. Clerk creates adjustment entries for bank charges
5. System marks all items as reconciled
6. Generate reconciliation report showing:
    - Book balance + Deposits in transit - Outstanding checks ± Adjustments = Bank balance
7. Auto-approve if variance < $1.00

---

### Use Case 6: Budget Control

```typescript
type BudgetCheckResult =
  | { status: 'approved'; utilization: Decimal }
  | { status: 'warning'; utilization: Decimal; message: string }
  | { status: 'blocked'; utilization: Decimal; requiresOverride: true }

const checkBudget: (
  accountId: AccountId,
  costCenterId: CostCenterId,
  period: FiscalPeriod,
  requestedAmount: Money
) => BudgetCheckResult

const createCommitment: (
  requisition: PurchaseRequisition,
  budgetCheck: BudgetCheckResult
) => Result<Commitment, BudgetError>
```

**Steps:**
1. System identifies GL account from purchase requisition
2. Look up budget for account/period/cost center
3. Calculate: YTD actual + pending commitments + requisition amount
4. Compare to budget:
    - If < 90%: Auto-approve
    - If 90-100%: Warn user, allow proceed
    - If > 100%: Block or require override approval
5. If approved: Create commitment record
6. On invoice posting: Convert commitment to actual
7. Dashboard shows budget utilization in real-time

---

## Success Criteria

> **📋 From original scope:** Added success criteria for MVP validation.

| # | Criterion | Metric | Target |
|---|-----------|--------|--------|
| 1 | **Functional Completeness** | Complete full month-end close | AP, AR, GL, bank rec, and reports all functional |
| 2 | **Performance** | Trial balance generation | < 5 seconds for 50,000 transactions |
| 3 | **Data Integrity** | Out-of-balance entries | 0% (100% validation) |
| 4 | **Compliance** | External audit | Clean opinion, no material weaknesses |
| 5 | **User Adoption** | Finance team usage | 90% using daily within 3 months |
| 6 | **Reporting** | Statutory reports | Balance Sheet, P&L, Cash Flow with drill-down |
| 7 | **Integration** | AP invoice automation | 95%+ created automatically from purchasing |

---

## Out of Scope (Future Iterations)

> **📋 From original scope:** Confirmed deferred features.

| Feature | Reason Deferred | Potential Phase |
|---------|-----------------|-----------------|
| Fixed asset management | Complexity (depreciation, disposal, impairment) | Phase 2 |
| Intercompany elimination | Requires multi-entity first | Phase 4 |
| Advanced budgeting | Rolling forecasts, scenario planning | Phase 3 |
| Project accounting | Cost allocation complexity | Phase 3 |
| Lease accounting (IFRS 16, ASC 842) | Specialized compliance | Phase 4 |
| Revenue recognition (ASC 606) | Complex automation | Phase 3 |
| Financial consolidation | Multi-entity groups | Phase 4 |
| Advanced collections | Promises to pay, payment plans | Phase 2 |
| Treasury management | Investments, hedging | Phase 4 |
| Credit card expense management | Requires integrations | Phase 2 |
| EDI integration | EDIFACT, X12 | Phase 3 |
| Predictive analytics | ML for cash flow forecasting | Phase 4 |
| AI anomaly detection | Requires ML infrastructure | Phase 4 |
| Mobile expense approval | Native app development | Phase 2 |

---
