---
title: "Cross-module query precedent is not permission to copy storage coupling"
modules: ["customers"]
areas: ["module-data","debugging"]
topics: ["access-control","module-boundaries","testing"]
---

# Cross-module query precedent is not permission to copy storage coupling

**Context**: Dashboard and customer analytics independently queried the currencies module's table to resolve base currency, so disabling or changing that optional module broke consumers outside its ownership boundary.

**Rule**: Put peer-module table access behind a DI service owned by the source module. Optional consumers should resolve a narrow local interface fail-soft, distinguish missing and ambiguous data, and include disabled-module coverage. Treat an existing cross-module raw SQL query as coupling to retire, not a pattern to repeat.

**Applies to**: optional module integrations, analytics enrichments, and any consumer that reads another module's tables or persistence details.
