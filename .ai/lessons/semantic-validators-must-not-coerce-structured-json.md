---
title: "Semantic validators must not coerce structured JSON"
modules: ["checkout"]
areas: ["module-data", "testing"]
topics: ["validation-errors", "api-contracts", "untrusted-input"]
---

# Semantic validators must not coerce structured JSON

**Context**: Separating checkout's request envelope from collected-value validation made raw JSON reachable by a semantic validator even after typed parsing failed. An email object with `toString: null` caused `String(value)` to throw, replacing combined `422` field errors with `500` (#9159).

**Rule**: Semantic validators that inspect unknown values must handle structured JSON without invoking its conversion hooks. Reject unsupported structured values for required nonsemantic fields too; a sentinel must not make an empty array satisfy a required text field. Collect independent field errors even when typed validation fails; do not call business mutations until all validation succeeds. Filter undeclared data before value validation and preserve the endpoint's existing error status and shape.

**Evidence**: Checkout route regressions combine a structured email or phone with another malformed field, reject arrays/objects for a required custom text field, and assert `422` with no transaction or gateway writes. TC-CHKT-036 exercises the structured-email case through the isolated API as well as ordinary malformed values.
