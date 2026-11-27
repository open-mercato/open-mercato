# Open Mercato Enterprise Roadmap

New features roll out incrementally through Enterprise module updates. The estimated release quarters below may change. Paying customers can request changes to feature priorities.

## Open Mercato Enterprise Security Bundle

| Feature | Estimated release | Tracking |
| --- | --- | --- |
| **Security provider integrations** for Cloudflare Zero Trust and Access. | Q1 2027 | [#9341](https://github.com/open-mercato/open-mercato/issues/9341), [#1518](https://github.com/open-mercato/open-mercato/issues/1518), [#10536](https://github.com/open-mercato/open-mercato/pull/10536) |
| **Cloud key management (KMS)** with provider adapters including AWS KMS and Google Cloud KMS. | Q2–Q3 2027 or on demand | [#9344](https://github.com/open-mercato/open-mercato/issues/9344), [#235](https://github.com/open-mercato/open-mercato/issues/235) |
| **Document- and record-level permissions** with owner-only visibility, field-level access, and data masking for AI agents. | Q2 2027 | [#9345](https://github.com/open-mercato/open-mercato/issues/9345), [#5183](https://github.com/open-mercato/open-mercato/issues/5183), [#6294](https://github.com/open-mercato/open-mercato/issues/6294) |
| **Stronger tenant isolation** with PostgreSQL row-level security (RLS). | Q1 2027 | [#244](https://github.com/open-mercato/open-mercato/issues/244) |
| **MFA hardening** with SMS one-time codes and multi-factor authentication for the customer portal. | Q3 2027 or on demand | [#7346](https://github.com/open-mercato/open-mercato/issues/7346), [#7345](https://github.com/open-mercato/open-mercato/issues/7345) |
| **OAuth 2.1 for the MCP endpoint** so hosted AI clients such as Claude.ai and ChatGPT can connect under each user’s own identity. | Q2 2027 | [#6218](https://github.com/open-mercato/open-mercato/issues/6218) |

## Open Mercato Enterprise Maintenance and Deployment Toolkit

| Feature | Estimated release | Tracking |
| --- | --- | --- |
| **Safe encryption key rotation** with encrypted backup, restore, and verification. | Q4 2026 | [#8910](https://github.com/open-mercato/open-mercato/pull/8910), [#9333](https://github.com/open-mercato/open-mercato/pull/9333), [#9334](https://github.com/open-mercato/open-mercato/pull/9334), [#994](https://github.com/open-mercato/open-mercato/issues/994) |
| **Data Exit Kit and Enterprise Database Backup and Restore** to export and recover database data with encrypted or unencrypted backups. | No date set | [#9333](https://github.com/open-mercato/open-mercato/pull/9333) |
| **Atomic maintenance mode** to pause writes during sensitive operations such as encryption key rotation. | Done | [#10539](https://github.com/open-mercato/open-mercato/pull/10539) |
| **Usage telemetry and monitoring** for on-premises license and billing verification, with a New Relic–style monitoring dashboard. | Q1 2027 for usage reporting. Q3 2027 for the dashboard. | [#2502](https://github.com/open-mercato/open-mercato/issues/2502) |
| **Operational observability** with telemetry, proactive error monitoring, and health endpoints. | No date set | [#9347](https://github.com/open-mercato/open-mercato/issues/9347), [#583](https://github.com/open-mercato/open-mercato/issues/583), [#8925](https://github.com/open-mercato/open-mercato/issues/8925) |
| **Reference deployments for AWS, Google Cloud, and Azure** with Terraform, Helm, and Bicep, database point-in-time recovery, and environment-specific seed profiles. | No date set | [#9346](https://github.com/open-mercato/open-mercato/issues/9346), [#4030](https://github.com/open-mercato/open-mercato/issues/4030), [#6954](https://github.com/open-mercato/open-mercato/issues/6954) |
| **White-label multi-tenant SaaS** with custom domains per organization and branding per tenant. | No date set | [#4271](https://github.com/open-mercato/open-mercato/issues/4271), [#7317](https://github.com/open-mercato/open-mercato/issues/7317) |

## Open Mercato Enterprise Scalability Toolkit

| Feature | Estimated release | Tracking |
| --- | --- | --- |
| **Queue providers** for AWS, Google Cloud, Azure, and RabbitMQ. | No date set | [#9343](https://github.com/open-mercato/open-mercato/issues/9343), [#10510](https://github.com/open-mercato/open-mercato/pull/10510) |
| **Cache providers** including Azure, Amazon ElastiCache, Google Cloud Memorystore, Valkey, Infinispan, and KeyDB. | No date set | [#10529](https://github.com/open-mercato/open-mercato/pull/10529), [#10527](https://github.com/open-mercato/open-mercato/pull/10527), [#10513](https://github.com/open-mercato/open-mercato/pull/10513) |

## Open Mercato Enterprise Compliance Bundle

| Feature | Estimated release | Tracking |
| --- | --- | --- |
| **SOC 2 readiness** with a control map, evidence exports, IP addresses in sign-in logs, permission-change auditing, and audit log retention. | Q2 2027 | [#9342](https://github.com/open-mercato/open-mercato/issues/9342), [#8106](https://github.com/open-mercato/open-mercato/issues/8106), [#8720](https://github.com/open-mercato/open-mercato/issues/8720), [#2980](https://github.com/open-mercato/open-mercato/issues/2980), [#6337](https://github.com/open-mercato/open-mercato/issues/6337) |
| **GDPR readiness** with right-to-erasure workflows, consent versioning, and consent capture in forms. | Q2 2027 | [#8593](https://github.com/open-mercato/open-mercato/issues/8593), [#5423](https://github.com/open-mercato/open-mercato/issues/5423), [#7068](https://github.com/open-mercato/open-mercato/issues/7068) |

## To Be Planned

- **Microsoft Entra ID access-token authentication for the Open Mercato API**, with delegated user and app-only access. The [specification](../../.ai/specs/enterprise/2026-06-23-entra-token-api-authentication.md) is ready.
- **IP allowlisting and authentication incident monitoring.** Cloudflare Access covers these capabilities for deployments that use it.
- **Immutable audit logs** backed by cryptographic hash chains.
- **Dedicated audit logs for AI actions** in Agent Orchestrator and AI Assistant, with human interventions highlighted.
- **Automated recovery objective testing** for recovery time (RTO) and recovery point (RPO), built on Enterprise Backup.
- **Approval controls for actions on individual records and documents.**
- **Data warehouse exports** to BigQuery and Snowflake.
