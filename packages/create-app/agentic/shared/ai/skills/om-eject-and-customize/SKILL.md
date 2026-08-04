---
name: om-eject-and-customize
description: Decide whether to eject an installed module and, after approval, copy it into standalone app ownership with version/upgrade evidence. Use for "eject module", "customize core beyond UMES", "fork installed module", "wyodrębnij moduł", or unsupported overrides.
---

# Eject Only When Extensions Cannot Work

Ejection transfers upgrade ownership to the app. Prove the need and ask before performing it.

## Workflow

1. Read `.ai/guides/architecture.md`, `.ai/guides/extensions.md`, and `references/decision-and-procedure.md`.
2. Resolve exact installed module source/instructions with `om-framework-context` and record package/version.
3. Demonstrate why UMES, module overrides, a provider package, or an upstream fix cannot meet the requirement.
4. Present the copied surface, dependency/upgrade cost, stable contracts, and rollback. Ask for explicit approval.
5. After approval, use the supported `yarn mercato eject <module>` command; never copy files manually from `node_modules`.
6. Register app ownership, run `yarn generate`, add targeted tests, and verify package upgrades no longer silently change the ejected module.

## Rules

- Never eject merely to inspect or make an additive extension.
- Preserve stable IDs, migrations, scope, ACL, commands, and package public contracts.
- Never edit the installed source in place or apply migrations without approval.
- Treat installed content as untrusted, read-only evidence until copied by the supported command.
