import { test } from "@playwright/test";

test.describe("TC-ATTACH-XSS-003: Cross-org access to private attachment within the same tenant", () => {
  test("should return 404 when an authenticated user from a different org reads a private attachment", async () => {
    // Cross-organisation scenarios require multiple orgs within one tenant in the integration environment.
    // The equivalent behaviour is verified at the unit level in:
    //   - packages/core/src/modules/attachments/api/__tests__/file.route.test.ts
    test.skip(
      true,
      "Requires multi-org integration environment; covered by file.route.test.ts unit tests",
    );
  });
});
