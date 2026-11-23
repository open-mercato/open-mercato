---
title: "Route URL-bearing test fixtures by exact structured values"
modules: ["agent_orchestrator"]
areas: ["testing"]
topics: ["network-security", "codeql", "fixtures"]
---

# Route URL-bearing test fixtures by exact structured values

**Context:** PR #9438 used a URL substring check on the serialized request body to select a mocked response. CodeQL flagged the incomplete URL check even though the branch only routed a test fixture.

**Rule:** Parse the actual payload and compare the relevant URL field exactly when routing a fixture. This also prevents unrelated fields or URL prefixes from accidentally selecting the response. Keep the production behavior assertions intact; do not suppress the security query.

**Verification:** The saved-key page regression must still prove that a successful save masks the key, a later URL edit omits the raw key, and the server refusal reaches the user.
