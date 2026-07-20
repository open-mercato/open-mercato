import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { resolveAppRoot } from './appRoot';

/**
 * Database fixtures for the org-scope fail-open hardening tests.
 *
 * These helpers talk to Postgres directly via `pg` rather than bootstrapping the
 * app DI container, because:
 *  - the directory create command denies non-super-admin actors (the only
 *    loginable accounts here), so orgs cannot be created over the API; and
 *  - granting `customers.*` through the ACL API requires a super-admin actor.
 * Raw SQL keeps the test self-contained and avoids depending on built package
 * `dist/` output for an in-process MikroORM bootstrap.
 */

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const candidatePaths = [
    path.resolve(resolveAppRoot(), '.env'),
    path.resolve(process.cwd(), 'apps/mercato/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match?.[1]) return match[1].trim();
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveDatabaseUrl(): string {
  const url = readEnvValue('DATABASE_URL');
  if (!url) throw new Error('[internal] DATABASE_URL is not configured for integration DB fixtures');
  return url;
}

export async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Nulls a user's home organization (`organization_id`) directly in the database.
 *
 * Required to construct the "floating restricted user" precondition: the JWT
 * `auth.orgId` is minted from `users.organization_id` at login, so this MUST run
 * BEFORE the user logs in.
 */
export async function clearUserHomeOrganization(userId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('update users set organization_id = null where id = $1', [userId]);
  });
}

/**
 * Upserts a per-user ACL row, setting the effective feature list and the
 * organization-visibility list.
 *
 * `organizations` maps to `OrganizationScope.allowedIds` (write path) and
 * `filterIds` (read path):
 *   - `[orgA]` => restricted to orgA (write fail-open precondition, #2239)
 *   - `[]`     => restricted to zero orgs (read fail-open precondition, #2245)
 *   - `null`   => unrestricted
 */
export async function setUserAclInDb(input: {
  userId: string;
  tenantId: string;
  features: string[];
  organizations: string[] | null;
}): Promise<void> {
  await withClient(async (client) => {
    const existing = await client.query<{ id: string }>(
      'select id from user_acls where user_id = $1 and tenant_id = $2 limit 1',
      [input.userId, input.tenantId],
    );
    const featuresJson = JSON.stringify(input.features);
    const organizationsJson = input.organizations === null ? null : JSON.stringify(input.organizations);
    if (existing.rows.length > 0) {
      await client.query(
        'update user_acls set features_json = $2::jsonb, organizations_json = $3::jsonb, is_super_admin = false, updated_at = now() where id = $1',
        [existing.rows[0].id, featuresJson, organizationsJson],
      );
      return;
    }
    await client.query(
      `insert into user_acls (id, user_id, tenant_id, features_json, organizations_json, is_super_admin, created_at)
       values (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, false, now())`,
      [input.userId, input.tenantId, featuresJson, organizationsJson],
    );
  });
}

/** Removes any per-user ACL rows for the user (best-effort test cleanup). */
export async function deleteUserAclInDb(userId: string): Promise<void> {
  if (!userId) return;
  await withClient(async (client) => {
    await client.query('delete from user_acls where user_id = $1', [userId]);
  });
}

/**
 * Creates an organization directly in the database within the given tenant.
 *
 * The directory create command routes through `enforceTenantSelection`, which
 * denies the (non-super-admin) accounts loginable on this instance. Landing the
 * org in a known tenant lets the floating user (created under it) share the
 * tenant — required because cross-tenant access returns 404 before the
 * org-scope guard ever runs.
 */
export async function createOrganizationInDb(input: { name: string; tenantId: string }): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into organizations
         (id, tenant_id, name, is_active, ancestor_ids, child_ids, descendant_ids, depth, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, now(), now())
       returning id`,
      [input.tenantId, input.name],
    );
    return result.rows[0].id;
  });
}

/** Hard-deletes an organization row (best-effort test cleanup). */
export async function deleteOrganizationInDb(organizationId: string | null): Promise<void> {
  if (!organizationId) return;
  await withClient(async (client) => {
    await client.query('delete from organizations where id = $1', [organizationId]);
  });
}

/**
 * Hard-deletes integration credential rows for an organization (best-effort test
 * cleanup). Integration credentials are stored per (integration_id,
 * organization_id, tenant_id, user_id) with no FK to organizations, so a
 * throwaway org's credential rows must be removed explicitly when the org row is
 * torn down.
 */
export async function deleteIntegrationCredentialsInDb(organizationId: string | null): Promise<void> {
  if (!organizationId) return;
  await withClient(async (client) => {
    await client.query('delete from integration_credentials where organization_id = $1', [organizationId]);
  });
}
