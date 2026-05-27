import { test } from "@playwright/test";

test.describe("TC-ATTACH-XSS-002: Cross-tenant access to private attachment via file route", () => {
  test("should return 404 when an authenticated user from another tenant reads a private attachment", async () => {
    // Cross-tenant scenarios require isolated tenants in the integration environment.
    // The equivalent behaviour is verified at the unit level in:
    //   - packages/core/src/modules/attachments/api/__tests__/file.route.test.ts
    test.skip(
      true,
      "Requires multi-tenant integration environment; covered by file.route.test.ts unit tests",
    );
  });
});
