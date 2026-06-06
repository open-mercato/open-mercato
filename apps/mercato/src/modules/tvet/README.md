# TVET ERP Module

This module provides a comprehensive Technical and Vocational Education & Training (TVET) management system tailored for the Kenyan educational framework.

## Core Domains

### 1. Academics
- **Trainees:** Management of trainee profiles including Admission Numbers, UPI (NEMIS), and KCSE history.
- **Courses:** Program management with Qualification Levels and duration.
- **Class Groups:** Organization of trainees into deliverable cohorts with trainer assignments.
- **Enrollments:** Lifecycle tracking from admission to completion.

### 2. CBET Curriculum Alignment
Aligned with the Competency-Based Education and Training (CBET) framework and KNQF levels (1-6).
- **Qualification Levels:** Standardized KNQF levels.
- **Sectors:** Occupational sectors (e.g., Agriculture, ICT).
- **Occupational Standards:** Industry-validated competency definitions.
- **Competency Units:** Basic, Common, and Core units with credit values.
- **Unit Elements & Performance Criteria:** Granular breakdown of competencies.

## Technical Architecture

- **Entities:** MikroORM entities with multi-tenant isolation (`organization_id`, `tenant_id`).
- **Services:** Decoupled business logic in `TraineeService`, `CourseService`, `CurriculumService`, and `AcademicService`.
- **API:** RESTful endpoints generated via `makeCrudRoute` with Query Engine indexing.
- **DI:** Registered in Awilix container for per-request isolation.
- **Migrations:** Tenant-safe manual migrations for all core tables.

## Getting Started

1. Enable the module in `src/modules.ts`.
2. Run `yarn generate` to update registries.
3. Apply migrations using `yarn db:migrate`.
4. Assign `tvet.*` features to roles in the admin panel.
