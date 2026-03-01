# KARIANA Unreal Engine Instructor Platform — Implementation Plan

## Vision

Transform OpenMercato into a **KARIANA Instructor Marketplace** where Unreal Engine professionals can:

1. **Showcase credentials** from credential.unrealengine.com (Credly-based badges)
2. **Record and share KARIANA skills** — captured MCP tool usage patterns that become deterministic/non-deterministic prompt workflows
3. **Serve clients** via scheduled sessions (booking) AND async support threads
4. **Launch remote Claude Code instances** with KARIANA pre-configured for deep client support

---

## Phase 1: `instructors` Module — Profiles & Credentials (MVP)

### Purpose
Instructor profiles with verified Unreal Engine credentials displayed publicly.

### Files to create

```
src/modules/instructors/
├── index.ts                          # Module metadata
├── acl.ts                            # RBAC features
├── ce.ts                             # Custom entity declarations
├── di.ts                             # DI registrar
├── search.ts                         # Search config with formatResult
├── data/
│   ├── entities.ts                   # MikroORM entities
│   └── validators.ts                 # Zod schemas
├── api/
│   ├── get/instructors/route.ts      # GET /api/instructors (list)
│   ├── get/instructors/[id]/route.ts # GET /api/instructors/:id
│   ├── post/instructors/route.ts     # POST /api/instructors (create)
│   ├── put/instructors/[id]/route.ts # PUT /api/instructors/:id (update)
│   ├── delete/instructors/[id]/route.ts
│   ├── post/credentials/route.ts     # POST /api/credentials (add credential)
│   ├── get/credentials/route.ts      # GET /api/credentials (list by instructor)
│   ├── delete/credentials/[id]/route.ts
│   └── post/credentials/[id]/verify/route.ts  # Trigger scrape/verification
├── backend/
│   ├── instructors/
│   │   ├── page.tsx                  # Admin list page (DataTable)
│   │   ├── page.meta.ts
│   │   ├── [id]/
│   │   │   ├── page.tsx             # Admin detail/edit (CrudForm)
│   │   │   └── page.meta.ts
│   │   └── create/
│   │       ├── page.tsx             # Admin create form
│   │       └── page.meta.ts
│   └── credentials/
│       ├── page.tsx                  # Credential management page
│       └── page.meta.ts
├── frontend/
│   ├── instructors/
│   │   ├── page.tsx                 # Public instructor directory
│   │   └── [id]/
│   │       └── page.tsx             # Public instructor profile with badges
│   └── credentials/
│       └── verify/page.tsx          # Public credential verification page
├── lib/
│   └── credential-scraper.ts        # Fetch metadata from credential.unrealengine.com
└── migrations/                      # Auto-generated
```

### Entities

**`InstructorProfile`** (table: `instructor_profiles`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| organization_id | uuid | Multi-tenant |
| tenant_id | uuid | Multi-tenant |
| user_id | uuid | FK to auth users (stored as ID, no relationship) |
| display_name | text | |
| slug | text, unique per tenant | URL-friendly profile identifier |
| bio | text, nullable | Markdown bio |
| headline | text, nullable | "Senior UE5 Technical Artist" |
| avatar_url | text, nullable | |
| specializations | jsonb | `["Blueprints", "Niagara", "PCG", "MetaHumans"]` |
| experience_years | int, nullable | |
| hourly_rate | decimal, nullable | For booking |
| currency | text, default 'USD' | |
| is_available | boolean, default true | |
| is_verified | boolean, default false | Admin-verified |
| is_active | boolean, default true | |
| website_url | text, nullable | |
| github_url | text, nullable | |
| linkedin_url | text, nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | Soft delete |

**`InstructorCredential`** (table: `instructor_credentials`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| instructor_id | uuid | FK to instructor_profiles |
| credential_url | text | Full URL (e.g., credential.unrealengine.com/...) |
| credential_type | text | 'unreal_engine', 'credly', 'other' |
| title | text, nullable | Scraped: "Unreal Engine 5 Certified Developer" |
| issuer | text, nullable | Scraped: "Epic Games" |
| badge_image_url | text, nullable | Scraped badge image |
| issued_at | timestamptz, nullable | Scraped issue date |
| expires_at | timestamptz, nullable | Scraped expiry |
| verification_status | text | 'pending', 'verified', 'failed', 'expired' |
| verified_at | timestamptz, nullable | |
| metadata | jsonb, nullable | Raw scraped data |
| sort_order | int, default 0 | Display ordering |
| is_active | boolean, default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | |

### ACL Features
```typescript
export const features = [
  { id: 'instructors.view', title: 'View instructors', module: 'instructors' },
  { id: 'instructors.manage', title: 'Manage instructors', module: 'instructors' },
  { id: 'instructors.credentials.view', title: 'View credentials', module: 'instructors' },
  { id: 'instructors.credentials.manage', title: 'Manage credentials', module: 'instructors' },
]
```

### Credential Scraper (`lib/credential-scraper.ts`)
- Accept a `credential.unrealengine.com` or Credly URL
- Fetch the page HTML
- Parse Open Graph meta tags and structured data for: title, issuer, badge image, issue date
- Return structured `CredentialMetadata` object
- Graceful fallback: if scraping fails, store URL only with `verification_status: 'pending'`

### i18n Keys (add to `src/i18n/en.json`)
```json
{
  "instructors.title": "Instructors",
  "instructors.directory": "Instructor Directory",
  "instructors.profile": "Instructor Profile",
  "instructors.credentials": "Credentials & Certifications",
  "instructors.addCredential": "Add Credential",
  "instructors.verifyCredential": "Verify Credential",
  "instructors.specializations": "Specializations",
  "instructors.available": "Available for Hire",
  "instructors.verified": "Verified Instructor"
}
```

---

## Phase 2: `skills` Module — KARIANA Recorded Workflows

### Purpose
Instructors use KARIANA's record feature to capture MCP tool usage patterns. These recordings become reusable "skills" that Claude can replay as deterministic or non-deterministic prompt sequences.

### Files to create

```
src/modules/skills/
├── index.ts
├── acl.ts
├── ce.ts
├── di.ts
├── search.ts
├── data/
│   ├── entities.ts
│   └── validators.ts
├── api/
│   ├── get/skills/route.ts           # List skills (filterable)
│   ├── get/skills/[id]/route.ts      # Skill detail
│   ├── post/skills/route.ts          # Create/import a skill
│   ├── put/skills/[id]/route.ts      # Update skill metadata
│   ├── delete/skills/[id]/route.ts
│   ├── get/skill-steps/route.ts      # List steps for a skill
│   └── post/skills/[id]/fork/route.ts # Fork a skill
├── backend/
│   ├── skills/
│   │   ├── page.tsx                   # Skills list (DataTable)
│   │   ├── page.meta.ts
│   │   ├── [id]/
│   │   │   ├── page.tsx              # Skill detail with step viewer
│   │   │   └── page.meta.ts
│   │   └── create/
│   │       ├── page.tsx
│   │       └── page.meta.ts
│   └── skill-categories/
│       ├── page.tsx                   # Manage categories
│       └── page.meta.ts
├── frontend/
│   ├── skills/
│   │   ├── page.tsx                  # Public skill marketplace/browse
│   │   └── [id]/
│   │       └── page.tsx             # Public skill detail
│   └── my-skills/
│       └── page.tsx                  # Instructor's own skills dashboard
└── lib/
    ├── skill-parser.ts               # Parse KARIANA recording into skill steps
    └── prompt-builder.ts             # Build deterministic/non-deterministic prompts from steps
```

### Entities

**`Skill`** (table: `skills`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| instructor_id | uuid | FK to instructor_profiles |
| title | text | "Procedural City Generation with PCG" |
| slug | text | |
| description | text, nullable | |
| category | text | 'blueprints', 'niagara', 'pcg', 'materials', 'animation', 'metahumans', 'general' |
| tags | jsonb | `["procedural", "city", "PCG"]` |
| difficulty | text | 'beginner', 'intermediate', 'advanced', 'expert' |
| prompt_mode | text | 'deterministic', 'non_deterministic', 'hybrid' |
| prompt_template | text, nullable | The compiled prompt template |
| estimated_duration_minutes | int, nullable | |
| usage_count | int, default 0 | How many times this skill has been used |
| fork_count | int, default 0 | |
| forked_from_id | uuid, nullable | FK to skills (fork lineage) |
| is_public | boolean, default true | |
| is_active | boolean, default true | |
| version | int, default 1 | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | |

**`SkillStep`** (table: `skill_steps`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| skill_id | uuid | FK to skills |
| step_order | int | Sequence number |
| mcp_tool_name | text | KARIANA MCP tool used (e.g., "create_blueprint") |
| tool_parameters | jsonb | Parameters passed to the MCP tool |
| description | text, nullable | Human-readable explanation |
| prompt_fragment | text, nullable | The prompt text for this step |
| is_optional | boolean, default false | Non-deterministic steps can be skipped |
| condition | jsonb, nullable | Conditions for non-deterministic execution |
| expected_output | text, nullable | What to expect after this step |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### ACL Features
```typescript
export const features = [
  { id: 'skills.view', title: 'View skills', module: 'skills' },
  { id: 'skills.manage', title: 'Manage skills', module: 'skills' },
  { id: 'skills.create', title: 'Create skills', module: 'skills' },
  { id: 'skills.fork', title: 'Fork skills', module: 'skills' },
]
```

### Key Libraries

**`skill-parser.ts`**: Parses KARIANA recording output (the MCP tool call sequence) into structured `SkillStep` entries. Handles tool name normalization, parameter extraction, and step ordering.

**`prompt-builder.ts`**: Takes a `Skill` with its `SkillStep`s and generates:
- **Deterministic prompt**: A rigid step-by-step instruction set that Claude follows exactly
- **Non-deterministic prompt**: A flexible prompt with goals and available tools, letting Claude adapt
- **Hybrid**: Fixed steps with optional adaptive branches

---

## Phase 3: `engagements` Module — Booking + Async Support

### Purpose
Clients connect with instructors via scheduled sessions (leveraging OpenMercato's booking module) AND async support threads.

### Files to create

```
src/modules/engagements/
├── index.ts
├── acl.ts
├── ce.ts
├── di.ts
├── search.ts
├── data/
│   ├── entities.ts
│   ├── extensions.ts                 # Links to instructors + booking modules via IDs
│   └── validators.ts
├── api/
│   ├── get/engagements/route.ts
│   ├── get/engagements/[id]/route.ts
│   ├── post/engagements/route.ts     # Client creates engagement request
│   ├── put/engagements/[id]/route.ts
│   ├── post/engagements/[id]/accept/route.ts   # Instructor accepts
│   ├── post/engagements/[id]/close/route.ts    # Close engagement
│   ├── get/threads/route.ts          # Async support threads
│   ├── get/threads/[id]/route.ts
│   ├── post/threads/route.ts
│   ├── post/threads/[id]/messages/route.ts  # Post message to thread
│   └── get/threads/[id]/messages/route.ts
├── backend/
│   ├── engagements/
│   │   ├── page.tsx                  # Engagements list
│   │   ├── page.meta.ts
│   │   └── [id]/
│   │       ├── page.tsx             # Engagement detail with thread
│   │       └── page.meta.ts
│   └── threads/
│       ├── page.tsx
│       └── page.meta.ts
├── frontend/
│   ├── engagements/
│   │   ├── page.tsx                 # Client's engagements dashboard
│   │   └── [id]/
│   │       └── page.tsx            # Client engagement detail
│   └── book/
│       └── [instructorId]/
│           └── page.tsx             # Book a session with instructor
├── subscribers/
│   ├── on-engagement-created.ts     # Notify instructor
│   └── on-thread-message.ts         # Notify recipient
└── lib/
    └── engagement-status.ts         # Status machine helpers
```

### Entities

**`Engagement`** (table: `engagements`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| instructor_id | uuid | FK to instructor_profiles |
| client_user_id | uuid | FK to auth users |
| type | text | 'session', 'async_support', 'project' |
| status | text | 'pending', 'accepted', 'in_progress', 'completed', 'cancelled' |
| title | text | |
| description | text, nullable | |
| skill_id | uuid, nullable | FK to skills (if related to a skill) |
| booking_id | uuid, nullable | FK to booking system (for scheduled sessions) |
| scheduled_at | timestamptz, nullable | |
| started_at | timestamptz, nullable | |
| completed_at | timestamptz, nullable | |
| duration_minutes | int, nullable | |
| rating | int, nullable | 1-5 client rating |
| feedback | text, nullable | |
| session_url | text, nullable | Claude Code session link |
| is_active | boolean, default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | |

**`EngagementThread`** (table: `engagement_threads`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| engagement_id | uuid | FK to engagements |
| subject | text | |
| status | text | 'open', 'resolved', 'closed' |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**`EngagementMessage`** (table: `engagement_messages`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| thread_id | uuid | FK to engagement_threads |
| sender_user_id | uuid | |
| body | text | Markdown content |
| attachments | jsonb, nullable | File references |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### ACL Features
```typescript
export const features = [
  { id: 'engagements.view', title: 'View engagements', module: 'engagements' },
  { id: 'engagements.manage', title: 'Manage engagements', module: 'engagements' },
  { id: 'engagements.create', title: 'Create engagements', module: 'engagements' },
  { id: 'engagements.threads.view', title: 'View support threads', module: 'engagements' },
  { id: 'engagements.threads.manage', title: 'Manage support threads', module: 'engagements' },
]
```

---

## Phase 4: `sessions` Module — Claude Code Deep Integration

### Purpose
Launch, manage, and track remote Claude Code instances pre-configured with KARIANA for instructor-client collaboration.

### Files to create

```
src/modules/sessions/
├── index.ts
├── acl.ts
├── ce.ts
├── di.ts
├── data/
│   ├── entities.ts
│   └── validators.ts
├── api/
│   ├── post/sessions/launch/route.ts     # Launch a Claude Code instance
│   ├── get/sessions/route.ts             # List sessions
│   ├── get/sessions/[id]/route.ts        # Session detail + status
│   ├── post/sessions/[id]/stop/route.ts  # Stop instance
│   ├── get/sessions/[id]/logs/route.ts   # Session activity log
│   └── post/sessions/[id]/share/route.ts # Generate share link
├── backend/
│   ├── sessions/
│   │   ├── page.tsx                       # Session management dashboard
│   │   ├── page.meta.ts
│   │   └── [id]/
│   │       ├── page.tsx                  # Live session view
│   │       └── page.meta.ts
├── frontend/
│   ├── sessions/
│   │   ├── page.tsx                      # Client session list
│   │   └── [id]/
│   │       └── page.tsx                 # Client session viewer
├── workers/
│   ├── session-launcher.ts              # Background job: provision instance
│   └── session-cleanup.ts              # Background job: cleanup expired sessions
├── subscribers/
│   └── on-session-started.ts            # Notify participants
└── lib/
    ├── session-provisioner.ts           # Claude Code instance provisioning logic
    ├── kariana-config.ts                # Pre-configure KARIANA MCP tools
    └── session-status.ts                # Status tracking helpers
```

### Entities

**`CodeSession`** (table: `code_sessions`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| engagement_id | uuid, nullable | FK to engagements |
| instructor_id | uuid | FK to instructor_profiles |
| client_user_id | uuid | |
| status | text | 'provisioning', 'ready', 'active', 'completed', 'failed', 'expired' |
| session_url | text, nullable | Claude Code session URL |
| share_token | text, nullable | Unique token for share links |
| kariana_config | jsonb | KARIANA MCP configuration loaded into instance |
| skill_ids | jsonb, nullable | Skills pre-loaded in this session |
| started_at | timestamptz, nullable | |
| ended_at | timestamptz, nullable | |
| duration_seconds | int, nullable | Computed on close |
| activity_summary | jsonb, nullable | Tools used, steps taken |
| is_active | boolean, default true | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz, nullable | |

**`SessionLog`** (table: `session_logs`)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| organization_id | uuid | |
| tenant_id | uuid | |
| session_id | uuid | FK to code_sessions |
| event_type | text | 'tool_call', 'message', 'error', 'milestone' |
| tool_name | text, nullable | MCP tool if event_type = 'tool_call' |
| payload | jsonb | Event data |
| created_at | timestamptz | |

### ACL Features
```typescript
export const features = [
  { id: 'sessions.view', title: 'View sessions', module: 'sessions' },
  { id: 'sessions.manage', title: 'Manage sessions', module: 'sessions' },
  { id: 'sessions.launch', title: 'Launch sessions', module: 'sessions' },
]
```

### Session Provisioner (`lib/session-provisioner.ts`)
- Spin up a Claude Code instance (via API/SDK — implementation depends on hosting strategy)
- Pre-load KARIANA MCP server configuration
- Optionally pre-load skill prompt templates
- Return session URL and access credentials
- Handle cleanup on session end

### KARIANA Config (`lib/kariana-config.ts`)
- Build MCP server configuration for KARIANA
- Include instructor's custom tool preferences
- Load skill-specific tool subsets
- Generate `.claude/settings.json` with proper MCP wiring

---

## Implementation Order & Dependencies

```
Phase 1: instructors (MVP)
  ├── No dependencies, standalone module
  ├── Estimated: ~30 files
  └── Deliverable: Instructor directory with credential badges

Phase 2: skills
  ├── Depends on: instructors (instructor_id FK)
  ├── Estimated: ~25 files
  └── Deliverable: Skill recording/browsing marketplace

Phase 3: engagements
  ├── Depends on: instructors, skills (FKs by ID)
  ├── Links to: booking module (by booking_id)
  ├── Estimated: ~30 files
  └── Deliverable: Client-instructor interaction system

Phase 4: sessions
  ├── Depends on: instructors, engagements (FKs by ID)
  ├── Estimated: ~20 files
  └── Deliverable: Remote Claude Code collaboration
```

## Cross-Cutting Concerns

- **All modules**: Follow isomorphism rules (no cross-module ORM relationships, FK IDs only)
- **All entities**: Include `organization_id`, `tenant_id`, `deleted_at` for multi-tenancy + soft delete
- **All APIs**: Use CRUD factory pattern, zod validation, `findWithDecryption` helpers
- **All pages**: Use `CrudForm` for forms, `DataTable` for lists
- **Search**: Each module gets a `search.ts` with `formatResult` for Cmd+K
- **i18n**: All user-facing strings in locale files
- **Migrations**: Generated via `npm run db:generate` after entity changes

## Next Step

**Start with Phase 1** — create the `instructors` module with profiles and credential scraping. This gives you a working MVP: an instructor directory where UE5 professionals can sign up and showcase their credentials from credential.unrealengine.com.
