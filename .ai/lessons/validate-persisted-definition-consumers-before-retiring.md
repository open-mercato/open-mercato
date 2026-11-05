---
title: "Validate persisted-definition consumers before retiring legacy workflow rows"
modules: ["checkout","webhooks"]
areas: ["integration","architecture","debugging"]
topics: ["generated-files","database-migrations","webhooks"]
---

# Validate persisted-definition consumers before retiring legacy workflow rows

**Context**: A legacy seeded checkout definition shadowed a newer code-defined workflow and carried obsolete webhook activities. Soft-deleting the row looked like the smallest way to restore code-registry fallback.

**Problem**: Workflow start lookup supports code definitions, but transition, task, signal, and timer execution still resolve running instances through the persisted `definition_id`. Removing the legacy row would replace the webhook failure with missing-definition or no-transition failures after start.

**Rule**: Before deleting or soft-deleting a persisted workflow that has a code-defined counterpart, trace every runtime consumer of `WorkflowInstance.definitionId`. Until all consumers support code-registry fallback or an instance snapshot, repair the persisted definition payload in place and preserve its identity and historical references.

**Applies to**: workflow data migrations, code-defined workflow adoption, `workflow-executor`, transition/task/signal/timer handlers, and demo workflow upgrades.
