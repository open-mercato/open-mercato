import { test } from "@playwright/test";

test.describe("TC-ATTACH-XSS-005: Cross-tenant access to private attachment via image route", () => {
  test("should return 404 when an authenticated user from another tenant reads a private attachment via the image route", async () => {
    // Cross-tenant scenarios require isolated tenants in the integration environment.
    // The equivalent behaviour is verified at the unit level in:
    //   - packages/core/src/modules/attachments/api/__tests__/image.route.test.ts
    test.skip(
      true,
      "Requires multi-tenant integration environment; covered by image.route.test.ts unit tests",
    );
  });
});
