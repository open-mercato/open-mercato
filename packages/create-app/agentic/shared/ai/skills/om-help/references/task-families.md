# Task Families

Load this reference only when the root router does not make the task family obvious.

| Signal in the request | Primary local skill | Add when needed |
|---|---|---|
| New app domain/module, complete CRUD, one-shot system | `om-module-scaffold` | data, UI, extension, integration, AI/workflow branches |
| Entity, schema, relation, encryption, migration, lost update | `om-data-model-design` | module scaffold for API/command/surfaces |
| Page, form, table, detail, portal, navigation, translation | `om-backend-ui-design` | system extension when the host is installed |
| Field/column/action/menu on installed behavior, enricher/interceptor/guard | `om-system-extension` | data/UI branches for persistence or rendering |
| Email, payment, carrier, storage, commerce sync, webhook, import/export | `om-integration-builder` | module/UI for provider configuration |
| Typed product AI, tools, approval, orchestrator/subagent, artifact | `om-create-ai-agent` | workflow when the process must be durable |
| Business workflow, task, activity, trigger, compensation | `om-build-workflow` | integration/AI for activity dependencies |
| Bug/regression/security/performance symptom | `om-troubleshooter` | the domain skill after root cause classification |
| Exact installed contract/source/module instructions | `om-framework-context` | use only after generated facts |
| Unsupported installed customization | `om-eject-and-customize` | only after extension/override rejection |
| Remove unused built-ins | `om-trim-unused-modules` | architecture/dependency facts |
| New recurring agent failure/use case | `om-evolve-harness` | target owner skill/guide after failing case |

Always add the shared spec/review/integration/PR automation skill named by the requested delivery. Local skills own standalone domain knowledge; shared skills own generic delivery orchestration.
