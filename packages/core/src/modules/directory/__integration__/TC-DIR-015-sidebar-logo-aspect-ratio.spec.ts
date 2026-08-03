import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const BRANDING_API = '/api/directory/organization-branding';
const ORGANIZATIONS_API = '/api/directory/organizations';
const WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAeAAAAB4CAIAAACl9LZYAAABv0lEQVR4nO3UQQ3AIAAAMYQgAE2TM00IXMKb/+7RpBo65rNTFgDH+H1kQQNcCRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUYIGiBI0QJSgAaIEDRAlaIAoQQNECRogStAAUWO+O2UBcAgaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBogSNECUoAGiBA0QJWiAKEEDRAkaIErQAFGCBoj6ALkNDPDERRVMAAAAAElFTkSuQmCC',
  'base64',
);

type BrandingBody = {
  logoUrl?: string | null;
  logoPreserveAspectRatio?: boolean;
};

type UploadBody = {
  item?: {
    id?: string;
  };
};

function attachmentIdFromFileUrl(logoUrl: string | null | undefined): string | null {
  const match = logoUrl?.match(/^\/api\/attachments\/file\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/**
 * TC-DIR-015: Sidebar logo upload format and aspect-ratio rendering
 * Covers:
 * - UI upload format restriction on /backend/directory/branding
 * - uploaded branding logos storing /api/attachments/file/... original URLs
 * - expanded backend sidebar rendering preserved-aspect-ratio logos with object-contain
 */
test.describe('TC-DIR-015: Sidebar logo aspect-ratio rendering', () => {
  test('stores uploaded wide logos as file URLs and renders them uncropped when aspect preservation is enabled', async ({
    page,
    request,
  }) => {
    let token: string | null = null;
    let organizationId: string | null = null;
    let attachmentId: string | null = null;
    const stamp = Date.now();
    const organizationName = `QA TC-DIR-015 ${stamp}`;

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      expect(tenantId, 'Superadmin token should include a tenant context').toBeTruthy();

      const createResponse = await apiRequest(request, 'POST', ORGANIZATIONS_API, {
        token,
        data: { name: organizationName, tenantId },
      });
      expect(createResponse.status(), 'POST /api/directory/organizations should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string }>(createResponse);
      organizationId = expectId(createBody?.id, 'Organization creation response should include id');

      await page.addInitScript(() => {
        window.localStorage.setItem('om:sidebarCollapsed', '0');
      });
      await login(page, 'superadmin');
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId, url: BASE_URL, sameSite: 'Lax' },
        { name: 'om_selected_org', value: organizationId, url: BASE_URL, sameSite: 'Lax' },
        { name: 'om_sidebar_collapsed', value: '0', url: BASE_URL, sameSite: 'Lax' },
      ]);

      await page.goto('/backend/directory/branding', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Organization branding' })).toBeVisible();

      const fileInput = page.locator('#organization-logo-file');
      await expect(fileInput).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
      const uploadHint = page.getByText('PNG, JPG, or WebP works best. Uploaded files are stored as organization attachments.');
      await expect(uploadHint).toBeVisible();
      await expect(uploadHint).not.toContainText('SVG');

      const preserveAspectSwitch = page.getByRole('switch', { name: 'Keep the aspect ratio' });
      await expect(preserveAspectSwitch).toHaveAttribute('aria-checked', 'false');

      await fileInput.setInputFiles({
        name: `qa-wide-logo-${stamp}.png`,
        mimeType: 'image/png',
        buffer: WIDE_PNG,
      });
      await preserveAspectSwitch.click();
      await expect(preserveAspectSwitch).toHaveAttribute('aria-checked', 'true');

      const uploadResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/attachments') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Save branding' }).click();
      const uploadResponse = await uploadResponsePromise;
      expect(uploadResponse.status(), 'POST /api/attachments should return 200').toBe(200);
      const uploadBody = (await uploadResponse.json().catch(() => null)) as UploadBody | null;
      attachmentId = uploadBody?.item?.id ?? null;
      await expect(page.getByText('Organization branding updated').first()).toBeVisible();

      const readResponse = await apiRequestWithSelectedOrg(request, 'GET', BRANDING_API, {
        token,
        selectedOrgId: organizationId,
      });
      expect(readResponse.status(), 'GET /api/directory/organization-branding should return 200').toBe(200);
      const branding = await readJsonSafe<BrandingBody>(readResponse);
      expect(branding?.logoUrl, 'Uploaded logo should be stored as the original attachment file URL').toMatch(
        /^\/api\/attachments\/file\/[^/?#]+$/,
      );
      expect(branding?.logoUrl, 'Uploaded logo should not store the square image thumbnail URL').not.toContain(
        '/api/attachments/image/',
      );
      expect(branding?.logoPreserveAspectRatio).toBe(true);
      const storedAttachmentId = attachmentIdFromFileUrl(branding?.logoUrl);
      expect(storedAttachmentId, 'Stored file URL should include the uploaded attachment id').toBeTruthy();
      if (storedAttachmentId) attachmentId = storedAttachmentId;

      await page.goto('/backend', { waitUntil: 'domcontentloaded' });
      const expandedDashboardLink = page
        .locator('a[aria-label="Go to dashboard"]')
        .filter({ hasText: organizationName })
        .first();
      if (!(await expandedDashboardLink.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await expect(expandedDashboardLink).toBeVisible();
      }
      const sidebarLogo = expandedDashboardLink.locator('img[src*="/api/attachments/file/"]').first();
      await expect(sidebarLogo).toBeVisible();
      await expect(sidebarLogo).toHaveClass(/object-contain/);
      await expect(sidebarLogo).not.toHaveClass(/rounded-full/);

      const metrics = await sidebarLogo.evaluate((img) => {
        const element = img as HTMLImageElement;
        const box = element.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
        };
      });
      expect(metrics.naturalWidth, 'The uploaded test logo should be wider than tall').toBeGreaterThan(
        metrics.naturalHeight,
      );
      expect(metrics.width, 'The expanded sidebar logo box should be wider than tall').toBeGreaterThan(metrics.height);
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId);
      await deleteGeneralEntityIfExists(request, token, ORGANIZATIONS_API, organizationId);
    }
  });
});
