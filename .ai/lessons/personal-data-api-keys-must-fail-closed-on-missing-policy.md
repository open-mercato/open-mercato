---
title: "Personal API-key data must fail closed when policy is unavailable"
modules: ["auth", "dashboards"]
areas: ["module-data", "debugging"]
topics: ["access-control", "api-keys", "failure-states"]
---

# Personal API-key data must fail closed when policy is unavailable

For #7261, resolving an API key to its bound user's personal layout made an existing interactive recovery fallback security-sensitive. When the widget registry was empty, the route returned every saved item and its settings even though the key's allowed widget list was empty. Healthy-registry permission tests did not exercise that fallback.

When separating an actor from a user-data subject, audit failure and recovery branches as well as the normal permission path. A user's recovery snapshot can contain configuration that a restricted key must not receive. Filter API-key responses even when the policy registry is unavailable, preserve the stored layout, and keep interactive recovery behavior separate.

Evidence: `packages/core/src/modules/dashboards/api/layout/__tests__/route.api-key.test.ts`, test `withholds saved widget settings from a restricted key when the widget registry is unavailable`, failed with saved private widget settings before the correction and passes with an empty transient response afterward.
