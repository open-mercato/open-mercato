import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-CUSTOMERS-SEED-001: `mercato customers seed-examples` stays idempotent when tenant
 * data encryption is active.
 *
 * Reproduces the defect fixed in `modules/customers/cli.ts`: the idempotency guard filtered
 * `customer_deal.title` with a plaintext `$in`, but that column is encryption-mapped
 * (`modules/customers/encryption.ts`). Decryption happens on load, not on filter, so the
 * predicate reached Postgres as written, compared against ciphertext, matched nothing, and
 * raised nothing — the guard fell through and every re-run duplicated the whole example batch.
 *
 * Why this needs an integration test rather than a unit test: the bug *is* the encryption
 * boundary. A unit test has to mock the decryption helper, which is precisely the component
 * that was broken, so it can only prove the guard calls a helper — never that the guard works
 * against a real encrypted column. This exercises the real CLI, a real database, and a real
 * derived-key KMS.
 *
 * Verified-against-source contract (`modules/customers/cli.ts`, `seed-examples` command):
 * - seeding an untouched organization logs `Customer example data seeded for organization <id>`
 * - a re-run whose guard fires logs `Customer example data already present; skipping`
 * so the second run's stdout is a direct oracle for the guard, with no row counting needed.
 *
 * Two preconditions have to hold or this test passes vacuously, so both are asserted rather than
 * assumed:
 *
 * 1. **A real KMS.** Without one the runtime falls back to a noop provider that stores plaintext.
 *    `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` selects the derived-key KMS
 *    (`shared/lib/encryption/kms.ts`, `createKmsService`) so mapped columns are genuinely encrypted.
 * 2. **An active encryption map row.** `TenantDataEncryptionService` resolves which fields to
 *    encrypt from the `encryption_maps` table, scoped by `(entity_id, tenant_id, organization_id)`
 *    (`shared/lib/encryption/tenantDataEncryptionService.ts:223`). A freshly created organization has
 *    no such row, so `mercato entities seed-encryption` must run first — an earlier draft of this
 *    test omitted it and passed even against the unfixed guard, proving nothing.
 *
 * Both runs share one environment, keeping the test independent of the surrounding harness config.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..');
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const appDir = path.join(repoRoot, 'apps', 'mercato');

const ENCRYPTION_ENV = {
  TENANT_DATA_ENCRYPTION: 'yes',
  // Selects the derived-key KMS instead of the noop provider, so mapped columns are really
  // encrypted. Test-only value; it never leaves this process.
  TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'tc-customers-seed-001-derived-key',
  ALLOW_DERIVED_KMS_FALLBACK: 'true',
};

function runMercato(args: string[]): string {
  return execFileSync(process.execPath, [cliBin, ...args], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, ...ENCRYPTION_ENV, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
  });
}

function runSeedExamples(tenantId: string, organizationId: string): string {
  return runMercato(['customers', 'seed-examples', '--tenant', tenantId, '--org', organizationId]);
}

/**
 * Activates the module encryption maps for this tenant/organization and proves they are active.
 * Without this the deal title is stored as plaintext and the defect cannot manifest.
 */
function activateEncryptionMaps(tenantId: string, organizationId: string): void {
  const output = runMercato(['entities', 'seed-encryption', '--tenant', tenantId, '--org', organizationId]);
  expect(
    output,
    'TENANT_DATA_ENCRYPTION must be active for this test to mean anything — the CLI reported it disabled',
  ).not.toContain('TENANT_DATA_ENCRYPTION is disabled');
  expect(output, 'encryption maps should be seeded for the target scope').toContain('Encryption maps seeded');
  expect(
    output,
    'the customer_deal map must be among the seeded maps, since its title column is the one under test',
  ).toContain('customers:customer_deal');
}

test.describe('customers seed-examples idempotency under encryption', () => {
  test('declines to re-seed an organization that already has the example data', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(token);
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy();

    const organizationId = await createOrganizationFixture(request, token, {
      name: `TC-CUSTOMERS-SEED-001 ${Date.now()}`,
      tenantId,
    });

    try {
      activateEncryptionMaps(tenantId, organizationId);

      const firstRun = runSeedExamples(tenantId, organizationId);
      expect(
        firstRun,
        'first run against an untouched organization should seed the example data',
      ).toContain('Customer example data seeded for organization');

      const secondRun = runSeedExamples(tenantId, organizationId);
      expect(
        secondRun,
        'second run must detect the existing example deals through the encrypted title column and skip; '
          + 'seeding again is the duplication defect this test guards',
      ).toContain('Customer example data already present; skipping');
      expect(
        secondRun,
        'second run must not report seeding a second batch',
      ).not.toContain('Customer example data seeded for organization');
    } finally {
      await deleteOrganizationIfExists(request, token, organizationId);
    }
  });

  test('reports the example data as present when the same organization is seeded repeatedly', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenScope(token);

    const organizationId = await createOrganizationFixture(request, token, {
      name: `TC-CUSTOMERS-SEED-001-repeat ${Date.now()}`,
      tenantId,
    });

    try {
      activateEncryptionMaps(tenantId, organizationId);
      runSeedExamples(tenantId, organizationId);

      // Two further runs: a guard that only worked by accident on the first repeat would show up here.
      for (const attempt of [2, 3]) {
        const output = runSeedExamples(tenantId, organizationId);
        expect(output, `run ${attempt} should still skip`).toContain('already present; skipping');
      }
    } finally {
      await deleteOrganizationIfExists(request, token, organizationId);
    }
  });
});
