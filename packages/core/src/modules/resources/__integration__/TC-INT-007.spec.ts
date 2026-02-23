import { expect, test } from "@playwright/test";
import { login } from "@open-mercato/core/modules/core/__integration__/helpers/auth";
import { getAuthToken } from "@open-mercato/core/modules/core/__integration__/helpers/api";
import {
  createResourceFixture,
  deleteResourceIfExists,
} from "./helpers/resourcesFixtures";

export const integrationMeta = {
  dependsOnModules: ["resources", "audit_logs"],
};

const versionHistoryTitleRegex = /Version History/i;
const resourceSubtitleRegex = /Resource profile and activity/i;
const updateResourceActionRegex =
  /Update resource|resources\.resources\.update/i;

/**
 * TC-INT-007: Resource Detail Header Pattern
 */
test.describe("TC-INT-007: Resource Detail Header Pattern", () => {
  test("should render detail header with title, subtitle and back navigation", async ({
    page,
    request,
  }) => {
    let token: string | null = null;
    let resourceId: string | null = null;
    const stamp = Date.now();
    const resourceName = `QA TC-INT-007 Resource ${stamp}`;

    try {
      token = await getAuthToken(request, "admin");
      resourceId = await createResourceFixture(request, token, resourceName);

      await login(page, "admin");
      await page.goto(
        `/backend/resources/resources/${encodeURIComponent(resourceId)}`,
      );

      await expect(
        page.getByRole("heading", { name: resourceName }),
      ).toBeVisible();
      await expect(page.getByText(resourceSubtitleRegex)).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Back to resources/i }),
      ).toBeVisible();
      const historyButton = page
        .getByRole("button", { name: versionHistoryTitleRegex })
        .first();
      await expect(historyButton).toBeVisible();
    } finally {
      await deleteResourceIfExists(request, token, resourceId);
    }
  });

  test("should show resource update in version history after editing details", async ({
    page,
    request,
  }) => {
    let token: string | null = null;
    let resourceId: string | null = null;
    const stamp = Date.now();
    const resourceName = `QA TC-INT-007 Resource ${stamp}`;
    const updatedResourceName = `${resourceName} Updated`;

    try {
      token = await getAuthToken(request, "admin");
      resourceId = await createResourceFixture(request, token, resourceName);

      await login(page, "admin");
      await page.goto(
        `/backend/resources/resources/${encodeURIComponent(resourceId)}`,
      );
      await expect(
        page.getByRole("heading", { name: resourceName }),
      ).toBeVisible();

      const nameInput = page
        .getByRole("textbox", { name: /Name|Nazwa|Nombre/i })
        .first();
      await expect(nameInput).toBeVisible();
      await nameInput.fill(updatedResourceName);
      await page
        .getByRole("button", { name: /^Save$/i })
        .first()
        .click();

      await expect(page).toHaveURL(/\/backend\/resources\/resources$/i);
      await page.goto(
        `/backend/resources/resources/${encodeURIComponent(resourceId)}`,
      );

      const historyButton = page
        .getByRole("button", { name: versionHistoryTitleRegex })
        .first();
      await expect(historyButton).toBeVisible();
      await historyButton.click();

      const historyDialog = page.getByRole("dialog", {
        name: versionHistoryTitleRegex,
      });
      await expect(historyDialog).toBeVisible();
      await expect(
        historyDialog.getByText(updateResourceActionRegex).first(),
      ).toBeVisible();
    } finally {
      await deleteResourceIfExists(request, token, resourceId);
    }
  });
});
