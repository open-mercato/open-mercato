# Jest mocks for generated assets

- `entities.ids.generated.js` — minimal stable constants for tests that import `#generated/entities.ids.generated`.
- If new generated modules are needed in tests, prefer adding lightweight mocks here and point `moduleNameMapper` to them.

