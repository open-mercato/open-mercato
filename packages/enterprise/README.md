# Open Mercato Enterprise Subscription

The commercial layer of Open Mercato — proprietary enterprise modules plus certification, review, and operational support that take AI-built CRM/ERP systems to production. Delivered as the `@open-mercato/enterprise` package.

## The Problem We Solve

Enterprise clients do not accept production risk.

Open-source or AI-generated systems without certification create concrete concerns around:
- security
- maintainability
- compliance
- long-term support

In serious enterprise environments, "let's deploy and see what happens" is not acceptable.

## Our Position

Uncertified Open Mercato deployments should not go to production.

Production requires:
- enterprise license
- architecture/security audit
- production approval

This is a production requirement.

## The Solution

The Enterprise Subscription answers this directly: run verified builds of Open Mercato on Open Mercato's infrastructure, develop and edit them in the cloud, and let Open Mercato's tooling certify them for production. One subscription bundles the proprietary enterprise modules, the certification path (architecture audit, security / performance / custom-code reviews, homologation), and operational support. It is governed by the Open Mercato Enterprise License Agreement.

## Licensing Model

- **Per project, not per seat.** Charged per Open Mercato project / monorepo, never per developer or end user.
- **Unlimited seats.** No limit on users or servers within a given system.
- **Revenue-based tiers.** The applicable tier is determined by the Licensee's annual revenue, verified against public registry data (e.g. KRS).
- **Usage verification ("Phone Home").** On-premise deployments report aggregate usage counts for transparent billing verification, without Open Mercato needing standing access to your repository.

A *project* is a single business domain / department / goal-oriented deployment of Open Mercato — not limited to a single physical instance (a multi-server deployment can be one project).

## Subscription Tiers

Three tiers scale the level of service with company size. Every tier includes the full Enterprise Software Package and unlimited seats. Commercial terms are provided on request.

| Capability | Basic | Medium | Enterprise |
|---|---|---|---|
| Company revenue band | below $25M | $25M–$250M | above $250M |
| Enterprise software modules (MFA, SSO & Directory Sync, Record Locking) | Included | Included | Included |
| Unlimited users & servers (per project / monorepo) | Included | Included | Included |
| Project sandboxes — *time-limited offer* (dev/staging + prod env, CI/CD, AI SDLC pipeline, 7-day restore) | 1 active project | 3 active projects | 10 active projects |
| Priority support (AI-assisted helpdesk, issue triage) | up to 5 accounts | up to 10 accounts, Discord | unlimited accounts, Discord |
| Support & review coverage | Open Mercato core (open-source) | core + custom code | core + custom code |
| Software updates | self-serve | assisted | managed for you |
| Pre-deployment Architecture Audit | — | Included | Included |
| Monthly Security / Performance / Custom-code Reviews | — | optional | Included |
| Production Approval (Homologation) & go-live recommendation | — | optional | Included |
| Proactive deployment monitoring & lead-application upgrades | — | — | Included |
| Dedicated Customer Success Manager (pre-go-live) | — | optional | Included |
| GDPR documentation & production-config advisory | templates | Included | Included |

Startups below $5M in annual revenue can request a startup discount via [info@openmercato.com](mailto:info@openmercato.com).

## Service Detail

**Pre-deployment Architecture Audit.** A structured architecture review before production deployment: overall system architecture, identification of structural risks, and recommendations for production readiness.

**Monthly Security Review (up to 4h/mo).** Application code review, infrastructure and environment configuration review, identification of security risks, and remediation guidance.

**Monthly Performance Review — custom code (up to 4h/mo).** Detection of performance bottlenecks, review of scalability risks, and optimization recommendations.

**Monthly Custom Module Code Review (up to 4h/mo).** Alignment with Open Mercato best practices, code quality and maintainability, agent-friendly architecture patterns, and upgrade safety.

**Priority Technical Support.** Priority helpdesk (Slack / Discord or ticketing) for architecture and development questions, handled with AI assistance within tier limits. Advisory only — it does not include custom software development. Coverage: Basic covers the Open Mercato core (open-source libraries); Medium and Enterprise also cover your custom code.

**Dedicated Customer Success Manager (pre-go-live).** A CSM supports the Product Owner and technical team until launch: one 1-hour online meeting per month, ongoing ticketing support, and rollout-readiness guidance.

**Software Updates.** Security patches, new platform features, and partner-ready upgrade packages with documented risks and upgrade procedures. Basic: update packages are provided and applied by the customer independently. Medium: update packages with support and guidance from our team during the upgrade. Enterprise: managed upgrades — planning, validation, and application by our team. Customers may continue using the software after license expiration, but new updates, security patches, and platform enhancements require an active license.

**Production Approval (Homologation).** A formal production-readiness assessment before go-live: production approval report, risk summary, and go-live recommendation.

**Production Hosting Reference.** A reference self-hosted deployment setup (including Dokploy and parallel queue processing), with an optional fully managed Developer Sandbox Cloud offering for development and testing environments.

## Enterprise Software Package

The `@open-mercato/enterprise` package delivers the proprietary modules included with every subscription — not available in the open-source distribution:

- **MFA / 2FA** — multi-factor authentication with pluggable providers (TOTP, WebAuthn/passkeys, OTP email), enforcement policies, sudo challenge flows, provider-specific challenge UI registry, and enrollment redirect UX
- **SSO & Directory Sync** — SAML/OIDC single sign-on with SCIM directory provisioning, per-org IdP configuration, and JIT user provisioning
- **Record Locking** — optimistic and pessimistic mutation protection with participant presence, conflict detection/resolution, and force release
- **Auth Login Interceptors** — MFA login gating via UMES extension points with zero core modifications
- **System Status Overlays** — enterprise overlays and injected widgets for system status pages
- **Agent Orchestrator** — propose-only AI agent runtime (in-process + OpenCode file-defined agents), proposal/disposition workflow integration, trace · eval · correction capture, and the operator/engineer cockpit. Enabled with `OM_ENABLE_ENTERPRISE_MODULES` + `OM_ENABLE_ENTERPRISE_MODULES_AGENTS`

## Sandboxes

Open Mercato Sandboxes are pre-provisioned cloud environments with Open Mercato (in dev mode) and AI coding agents preinstalled — ready in about 30 seconds, no local setup. Start from a ready-made template (e.g. a CRM app) or an empty project, and you get a real, production-grade stack to build on (RBAC, encryption, multi-tenancy) on an industry-standard toolchain, so skills transfer to real work — no proprietary lock-in.

- A browser workspace: a terminal with your coding agents (Claude Code, Codex) one pick away and a live preview, plus an IDE-with-chat view.
- Full GitHub integration and live previews you can share by URL.
- Pause, resume, or delete sandboxes; state persists, with backups and restore up to 7 days back.

Build and learn in the sandbox, then move the application to your own infrastructure. This unified trial-and-build path replaces ad-hoc demos — start immediately, without first clearing a security review.

Within the Enterprise Subscription, project sandboxes are included as a time-limited offer. Sandboxes are for building and learning; production still runs the certification and homologation path above.

More detail: [Sandboxes spec](../../.ai/specs/enterprise/Sandboxes.md) · pre-launch waitlist: [sandboxes.openmercato.com](https://sandboxes.openmercato.com)

## Open Mercato Partnership Program

Build Open Mercato implementations without production risk.

Open Mercato takes responsibility for platform standards, security, and production certification. Partner agencies own delivery, revenue, and the client relationship.

## Open Mercato Certified Agencies

Certified agencies serve clients with an Open Mercato license. This supports ecosystem quality and enables deeper go-to-market collaboration.

Certified partners receive:
- Official Certified Open Mercato Agency status
- Ability to deliver production-ready Open Mercato projects
- Qualified leads from Open Mercato (when available)
- Joint enterprise sales narrative support (including case-study/media collaboration)
- Support in winning key clients
- Access to platform expertise and standards

## Roles and Responsibilities

Open Mercato acts as:
- owner of the platform standard
- license provider
- certification authority
- ecosystem enabler

Open Mercato does not deliver client projects and does not compete with partners.

Partner agency is responsible for:
- project delivery
- client relationship
- customization and development
- project-level support

Agencies operate on the front line; Open Mercato stands behind system quality.

## Financial Model

- Delivery: handled by the partner agency.
- Platform and enterprise license: provided by Open Mercato.
- Open Mercato sells the platform license directly to the client.
- Agency owns project delivery revenue, client relationship, and ongoing services revenue.
- If Open Mercato provides the lead, commission terms apply under partner agreement.

## Contact

- Enterprise licensing and program details: [info@openmercato.com](mailto:info@openmercato.com)
- Certified agency partnership: [mat@openmercato.com](mailto:mat@openmercato.com)

## Important

- This package does not represent the complete Enterprise Edition offering.
- Enterprise Edition includes implementation standards, certification workflow, and partner support layers beyond code features.


## Tenant RLS operations

`tenant_boundaries` is opt-in defense in depth alongside application tenant filters,
RBAC, encryption and optimistic locking. The initial FORCE RLS canary is
`customer_entities`. The reviewed manifest explicitly classifies other tables as
identity, global, mixed or deferred; these are not implicitly protected.

### Prepare and activate

1. Stop protected traffic and workers for the rollout. Back up the database and
   retain the previous application artifact and exact policy migration version.
   Use PostgreSQL 16, 17 or 18 with direct connections or a session pooler.
   Transaction poolers are unsupported.
2. Enable enterprise modules (`OM_ENABLE_ENTERPRISE_MODULES=true`) in the build
   environment and run `yarn generate`, then build the packages and application.
   Ship the generated registrations for `tenant_boundaries` and module-owned
   `database.ts` declarations together. Custom tables need reviewed declarations
   and manifest entries before activation; unknown tenant tables fail closed.
3. Have the DBA provision a standalone runtime LOGIN with NOSUPERUSER,
   NOBYPASSRLS, NOCREATEROLE, NOCREATEDB and NOREPLICATION, without role
   memberships. It must not own the database, schemas, relations or functions.
   Grant CONNECT, schema USAGE and only the required SELECT/INSERT/UPDATE/DELETE
   and sequence privileges, without GRANT OPTION. Do not grant TRUNCATE,
   database CREATE/TEMP, schema CREATE or executable application SECURITY DEFINER
   functions. Review inherited PUBLIC privileges too: PostgreSQL commonly grants
   TEMP to PUBLIC, so revoking TEMP only from the runtime login is insufficient.
   Coordinate revoking PUBLIC TEMP/database CREATE and schema CREATE with other
   database users. Review default privileges for future objects as well.
4. Provision a distinct reviewed maintenance LOGIN on the same database endpoint.
   It requires BYPASSRLS and the ownership/DDL privileges needed by the migrations
   and declared storage provisioning. It must not be a superuser, hold role
   memberships, or have role/database administration or replication privileges.
   Keep its connection secret available only to processes performing explicitly
   classified maintenance; absence of tenant identity never grants this authority.
5. Supply `DATABASE_URL` for the restricted login and
   `OM_TENANT_RLS_MAINTENANCE_DATABASE_URL` for the separate maintenance login
   through the deployment secret manager. Set `OM_TENANT_RLS=on` and explicitly
   set `OM_TENANT_RLS_POOL_MODE=direct` or `session`. The optional
   `OM_TENANT_RLS_SCHEMA` defaults to `public`; it must match the application
   schema/search path. An optional `OM_TENANT_RLS_MANIFEST` points to a reviewed
   JSON manifest. Never place connection credentials in committed configuration.
6. Run the existing `yarn db:migrate` workflow in that maintenance-enabled
   environment. Its preflight audits inventory and both roles; completion
   provisions declared storage and reconciles the exact reviewed canary policies,
   even with no pending migrations. Resolve failures before allowing traffic;
   do not manually widen policies or bypass startup checks to get a green boot.
7. Start fresh app and worker processes with the same generated declarations and
   configuration. Guarded readiness verifies each runtime endpoint and its policy
   catalog before protected work. Exercise own/foreign reads and writes, public
   flows and jobs in staging. Inspect the
   [actual pool-40 comparison](tests/rls/pool40-analysis.md): isolation passed,
   but the measured high-concurrency run was slower than the genuine pre-PR build.
   Treat capacity and latency acceptance as an explicit rollout decision.

Changes to configuration, credentials, grants, policies or declarations require
stopping new work, draining in-flight requests/jobs, closing affected pools and
restarting all consumers. Runtime pgvector readiness is SELECT-only; provision
storage through the maintenance migration lifecycle. Extension visibility and the
application schema/search path must agree.

### Rollback

Stop new protected work and drain requests, subscribers, jobs and transactions.
Close every affected runtime and maintenance pool. Keep the activation and
maintenance configuration enabled while the DBA runs the version-matched
`Migration20261113160000.down` through the approved migration rollback tooling;
its policy rollback verifies the installed policy tuple and refuses mismatches.
Do not run a blind DROP POLICY or disable unrelated policies. Only after exact
policy rollback succeeds may the operator turn `OM_TENANT_RLS` off and restart
the previous compatible artifact. Verify application tenant filtering and foreign
read/write rejection before restoring traffic. Removing policies removes the
second database boundary and must be recorded as a security rollback. Turning
only the adapter off while FORCE policies remain installed can deny all protected
traffic; changing only environment variables is not a complete rollback.

The [disposable regression guide](tests/rls/README.md) documents test commands,
not production credentials or permission to migrate a developer database.
