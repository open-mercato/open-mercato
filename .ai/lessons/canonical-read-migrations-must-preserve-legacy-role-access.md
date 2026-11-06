---
title: "Canonical read migrations must preserve legacy role access"
modules: ["customers"]
areas: ["backend-ui","debugging","testing"]
topics: ["access-control","backward-compatibility","testing"]
---

# Canonical read migrations must preserve legacy role access

**Context**: Issue #7501 moved the person Tasks section's read from the legacy todo adapter to the existing merged customer-task endpoint so native tasks remain visible after global-list navigation.

**Problem**: The legacy endpoint accepts `customers.view`, while the merged endpoint requires `customers.interactions.view`. Default roles have broad grants, but an existing custom role can retain only the legacy permission. Replacing the request without checking both guards would remove that role's existing task visibility.

**Rule**: When replacing a first-party read endpoint, compare the old and new server permission guards as well as their response shapes. Preserve supported legacy access through a server-authorized compatibility path. In this case, fall back to the legacy read only on a 403; authentication and server failures must remain errors instead of silently returning a smaller task set.

**Verification**: Cover the merged read, the permission-denied fallback with identical entity and pagination parameters, and a server failure that must not fall back. Inspect the endpoint guards and test a custom grant set rather than relying only on default administrator roles.

**Applies to**: Legacy-to-canonical loaders, renamed permission families, and compatibility readers used by existing custom roles.
