# Module System Compatibility Router

Use the concern guides below. This path remains only so older prompts and links do not load a stale module tutorial.

| When you need | Load |
|---|---|
| Module ownership, layout, discovery, registration, or installed source | `.ai/guides/architecture.md` |
| Entities, CRUD/API, commands, scoping, ACL, setup, events, workers, search, cache, or migrations | `.ai/guides/contracts.md` |
| Forms, tables, pages, navigation, portal, translations, or design-system behavior | `.ai/guides/backend-ui.md` |
| Enrichers, interceptors, guards, widgets, extensions, menus, replacements, or overrides | `.ai/guides/extensions.md` |
| Provider packages, data sync, webhooks, import/export, shipping, payment, or email | `.ai/guides/integrations.md` |
| AI agents/tools/orchestrators or workflows | `.ai/guides/ai-workflows.md` |
| Diagnosis and regression verification | `.ai/guides/testing-debugging.md` |

For a complete new module, invoke `om-module-scaffold`; it loads the relevant branches. For a concrete installed-module fact, read its generated `.ai/guides/modules/<id>.md` first. Invoke `om-framework-context` only when generated facts cannot answer the implementation question.
