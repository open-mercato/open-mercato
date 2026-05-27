import { test } from "@playwright/test";

test.describe("TC-ATTACH-XSS-001: Partial-null org — same-tenant cross-org access to private attachment", () => {
  test("should return 404 when a user in tenant T1 / org B reads an attachment seeded in tenant T1 with organization_id = NULL", async () => {
    // Requires seeding an attachment with organization_id = NULL via the standard API, which is not
    // supported in the current integration environment - there is no fixture or API parameter
    // that produces a tenant-scoped but org-null attachment row.
    // The isSameScope() partial-null path is covered at the unit level in:
    //   - packages/core/src/modules/auth/lib/__tests__/ (PR #2107)
    // and the query-layer defence-in-depth for this case is covered in:
    //   packages/core/src/modules/attachments/api/__tests__/file.route.test.ts (PR #2124)
    test.skip(
      true,
      "Requires a fixture that seeds an attachment with organization_id = NULL; not available in the standard integration environment",
    );
  });
});
