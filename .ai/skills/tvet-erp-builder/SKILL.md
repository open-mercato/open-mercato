---
name: tvet-erp-builder
description: Design and implement comprehensive TVET (Technical and Vocational Education & Training) ERP systems for Kenya's educational framework with OpenLedger AI-powered accounting. Covers 15 integrated modules including student management, CBET curriculum alignment, AI-driven finance, HR, admissions, discipline, LMS, and multi-campus operations.
---

# TVET ERP Builder (with OpenLedger AI Accounting)

Build complete, production-grade Technical and Vocational Education & Training (TVET) ERP systems aligned with Kenya's educational standards, KNQF levels, CBET competency frameworks, and TVETa/CDACC accreditation requirements. Features **AI-powered accounting via OpenLedger** for intelligent ledger management, auto-categorization, reconciliation, and financial reporting.

## When to Use This Skill

- Building a new TVET institution management system with intelligent accounting
- Designing ERP modules for Kenyan vocational colleges or training centers
- Implementing CBET (Competency-Based Education and Training) curriculum alignment
- Creating student lifecycle workflows (admissions → enrollment → competency assessment → graduation)
- Setting up multi-tenant, multi-campus educational platforms with unified AI accounting
- Designing institutional finance systems with **LLM-driven auto-categorization and reconciliation**
- Implementing industrial attachment tracking and logbook management
- Building LMS (Learning Management System) components (assignments, quizzes, discussions)
- Creating stakeholder portals (student, staff, guardian, parent-teacher booking)
- **Enabling conversational AI for financial querying and report generation**

## Core Domains Covered (15 Modules)

### 1. **Core Users & Reference Data**
- User roles: admin, registrar, HOD, trainer, trainee, finance, QA, librarian, HR, admissions
- Multi-tenant organization structure
- County and sub-county location hierarchy
- Departments with HOD assignment

### 2. **Academics & Student Management**
- Trainee profiles with admission numbers, UPI (NEMIS identifiers), KCSE history
- Class groups with trainer assignment
- Trainee enrollment and status tracking
- Guardian and emergency contact management
- Previous education records

### 3. **CBET Curriculum Alignment** ⭐ *Critical for Kenya TVET*
- **Qualification Levels**: KNQF levels 1–6 (Artisan to Higher Diploma)
- **Sectors & Occupations**: Framework-aligned job categories
- **Occupational Standards**: TVETA-approved competency definitions
- **Competency Units**: Basic, common, and core units with credit values
- **Unit Elements & Performance Criteria**: Granular competency breakdown
- **Range Statements & Knowledge/Assessment Evidence**: Complete competency context
- **Program Curriculum Mapping**: Unit delivery order and semester placement
- **Trade Test Registration**: CDACC, NITA, KNEC exam body integration
- **Competency-Based Assessments**: Direct, indirect, supplementary evidence types

### 4. **Enhanced Student Fees & Base Finance** ⭐ *With OpenLedger AI*
- Fee categories (tuition, registration, exam, trade test, library, lab, attachment, etc.)
- Program-level fee structure with mandatory/optional flags
- Student fee accounts with automatic balance calculation
- Fee installment plans and due-date tracking
- Receipt payment allocation (cash, M-Pesa, bank transfer, HELB direct, bursary)
- **M-Pesa integration with AI auto-categorization via OpenLedger**
- **HELB loan tracking with intelligent reconciliation**
- Bursary sponsorship from government, county, CDF, NGOs
- Fee waivers (scholarship, staff dependant, disability, special)
- **LLM-powered invoice recognition and categorization**

### 5. **Industrial Attachment & Logbook**
- Industry partner database with sector classification
- Attachment placements with supervisor assignment
- Week-by-week logbook entries (work done, skills acquired, challenges)
- Supervisor sign-off and institution assessor comments
- Industrial assessment scoring (attendance, punctuality, teamwork, communication)
- Attachment visit tracking by institution staff

### 6. **Graduation Rubrics & Certification**
- Graduation requirements per program (all core units competent, min credit hours, fees cleared, etc.)
- Grading rubrics with competency thresholds
- Graduation clearance workflow (pending → cleared/denied)
- Clearance checks per requirement type with verification evidence
- Graduation ceremonies with award classification
- Certificate generation (CDACC, NITA, KNEC, institutional)

### 7. **Extended Institutional Finance with OpenLedger AI** ⭐
- **Chart of accounts** (asset, liability, income, expense, equity)
- **Cost centers** (department, program, administrative)
- **Expense requests** and approval workflow with AI categorization
- **Supplier management** with KRA PIN and bank details
- **Salary structures** and payroll runs with auto-journal posting
- **AI-Powered Journal Entries**: OpenLedger agents propose journal entries for all transactions
- **Unified Ledger**: Real-time aggregation from banks, payment platforms, HR, inventory
- **Financial year** tracking and period closure with blockchain audit trail
- **Conversational Financial Querying**: Ask "What was our Q3 tuition revenue?" and get instant answers via LLM
- **Custom Report Building**: AI generates tax, cash flow, and institutional reports on demand

### 8. **HR & Staff Management**
- Staff profiles with employment type (permanent, contract, part-time, intern)
- Staff qualifications and employment history
- Leave types and balance tracking per financial year
- Leave application workflow with approval
- Performance appraisals with criterion-based scoring
- Disciplinary case tracking and resolution
- Staff training and attendance records

### 9. **Admissions & Enrollment Funnel**
- Inquiry tracking from initial contact through application
- Application form submission with document attachment
- Application document verification workflow
- Application review scoring against program-specific rubrics
- Offer letter generation (conditional, unconditional, waitlist)
- Placement diagnostics for CBET unit recommendation
- Orientation session tracking and attendance
- Enrollment conversion and status tracking

### 10. **Student Discipline & Conduct**
- Incident type classification with severity levels
- Incident reporting with investigation status
- Disciplinary actions (warning, detention, suspension, expulsion, counseling)
- Automatic escalation and documentation

### 11. **LMS Basics** *(Learning Management System)*
- Course materials (documents, videos, links, SCORM packages)
- Assignments with due dates, max scores, and rubric support
- Student submissions with grading and plagiarism scoring
- Quizzes with multiple-choice, true/false, short-answer, essay questions
- Quiz attempts with time limits and passing thresholds
- Discussion forums per unit with threaded replies
- Content release rules (prerequisites, competency gating)

### 12. **Communication & Stakeholder Portals**
- Announcements with role/department/program targeting
- Internal messaging system
- Event management and RSVP tracking
- Parent-teacher conference slot booking
- Portal access controls per stakeholder role

### 13. **Audit & Granular Security**
- User permissions with granular feature-based access
- **Blockchain-auditable audit log** via OpenLedger (table-level tracking)
- Data access control by organization/tenant

### 14. **Multi-Campus & Resource Booking**
- Campus records with main campus designation
- Room inventory (classroom, lab, workshop, office, library)
- Resource booking with date/time and purpose

### 15. **Budgeting & Procurement**
- Department budgets by financial year (recurrent, development)
- Purchase orders with supplier and approval workflow
- Grants tracking with donor and restriction status

---

## OpenLedger AI Integration Overview

### What is OpenLedger?

OpenLedger is an **AI-powered general ledger platform** that combines:
- **Large Language Models (LLMs)** for intelligent automation
- **Blockchain-based audit trails** for transparency and compliance
- **Real-time ledger runtime** with agent-driven journal entries
- **Unified multi-source aggregation** (banks, payments, HR, inventory)
- **Conversational AI** for financial querying and report generation
- **Proof of Attribution** tracking every financial decision on-chain

### Integration Points

#### 1. Transaction Ingestion & Auto-Categorization
```typescript
const categorized = await openledger.llm.categorizeTransaction({
  rawDescription: 'MPESA from JANE DOE REF 12345',
  amount: 50000,
  metadata: { traineeId: 'trainee-12345' },
  verticalContext: 'tvet-education',
});
// Output: { category: 'Income:Tuition', confidence: 0.95 }
```

#### 2. Intelligent Reconciliation
```typescript
const reconciliation = await openledger.ledger.reconcile({
  accountId: 'bank-account-123',
  period: 'monthly',
  autoApply: true,
});
```

#### 3. Journal Entry Automation
```typescript
const journalEntry = await openledger.ledger.proposeJournalEntry({
  trigger: 'supplier_invoice',
  documentId: 'invoice-vendor-001',
  organizationId: 'org-456',
  description: 'Laboratory equipment invoice from Supplier XYZ',
});
```

#### 4. Conversational Financial Querying
```typescript
const response = await openledger.llm.query({
  question: "What was our tuition revenue for Q3 2024 broken down by program?",
  organizationId: 'org-456',
  period: 'Q3-2024',
  format: 'table',
});
```

#### 5. Custom Report Generation
```typescript
const report = await openledger.llm.generateReport({
  type: 'cash_flow',
  period: '2024-07-01 to 2024-09-30',
  organizationId: 'org-456',
  format: 'pdf',
});
```

#### 6. Proof of Attribution
```typescript
const auditTrail = await openledger.ledger.auditTrail({
  transactionId: 'txn-12345',
  period: 'since-creation',
});
```

---

## Architecture Principles

### Tenant Isolation (Critical)
- Every record includes `organization_id`.
- OpenLedger instance per organization.
- Queries MUST filter by `organization_id`.

### CBET Alignment
- Curriculum mirrors KNQF/TVETA standards.
- Assessment tracks evidence types (direct/indirect/supplementary).

### Workflow State Machines
- **Admissions**: draft → submitted → under_review → shortlisted → offered → accepted/waitlisted → enrolled.
- **Fees**: unpaid → partial → paid → waived.
- **OpenLedger**: raw → categorized → reconciled → posted.

---

## Implementation Workflow (12 Phases)

1. **Phase 1: Core Setup + OpenLedger Integration**
   - Schema creation, roles, multi-tenant setup, OpenLedger configuration.
2. **Phase 2: Student Lifecycle Foundation**
   - Registration, profiles, intakes, enrollment, attendance.
3. **Phase 3: CBET Curriculum**
   - Occupational standards, program mapping, timetables, assessments.
4. **Phase 4: Admissions & Enrollment Funnel**
   - Inquiry tracking, application workflow, reviews, offer letters.
5. **Phase 5: Finance Integration + OpenLedger Automation**
   - Fee structure, M-Pesa integration, AI categorization, HELB reconciliation.
6. **Phase 6: Assessment & Competency Tracking**
   - Grading rubrics, performance criteria scoring, trade tests.
7. **Phase 7: Industrial Attachment**
   - Industry partners, placements, weekly logbooks, supervisor assessments.
8. **Phase 8: Graduation & Certification**
   - Requirement tracking, clearance workflow, certificate generation.
9. **Phase 9: HR & Payroll with OpenLedger**
   - Staff records, leave tracking, payroll runs → OpenLedger journal entries.
10. **Phase 10: LMS & Communication**
    - Course materials, assignments, quizzes, forums, announcements.
11. **Phase 11: Reporting & Audit with OpenLedger Intelligence**
    - Conversational dashboard, compliance reports, financial statements.
12. **Phase 12: Multi-Campus & Resource Management**
    - Campus hierarchy, room inventory, resource booking, ledger aggregation.

---

## Best Practices

- **CBET Compliance**: Always map units to occupational standards.
- **Financial Controls**: Set AI approval thresholds (e.g., auto-post < 50k, manual review > 50k).
- **Tenant Isolation**: Never omit `organization_id` in queries.
- **Audit Trails**: Treat receipts as immutable after confirmation.

---

## Testing Checklist

- [ ] **Tenant isolation**: Verify no cross-tenant data leaks.
- [ ] **Admission workflow**: Full journey from inquiry to enrollment.
- [ ] **OpenLedger integration**: Categorization accuracy and reconciliation.
- [ ] **CBET alignment**: Competency units map to occupational standards.
- [ ] **Audit trails**: All mutations logged in OpenLedger.
- [ ] **Role permissions**: Access restricted to assigned roles.
