import { randomInt } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';

type CreateTrackedUserInput = {
  emailPrefix: string;
  organizationId?: string;
  roles?: string[];
};

type CreateTrackedRoleInput = {
  namePrefix: string;
  features?: string[];
};

export type UserDestinationFixture = {
  superadminToken: string;
  actorToken: string;
  tenantId: string;
  parentOrganizationId: string;
  childOrganizationId: string;
  siblingOrganizationId: string;
  createUser: (input: CreateTrackedUserInput) => Promise<string>;
  createRole: (input: CreateTrackedRoleInput) => Promise<string>;
  cleanup: () => Promise<void>;
};

export async function createUserDestinationFixture(
  request: APIRequestContext,
  scenario: string,
): Promise<UserDestinationFixture> {
  const superadminToken = await getAuthToken(request, 'superadmin');
  const adminToken = await getAuthToken(request, 'admin');
  const tenantId = expectId(getTokenScope(adminToken).tenantId, 'Admin token should include tenant id');
  const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
  const userIds: string[] = [];
  const roleIds: string[] = [];
  let parentOrganizationId: string | null = null;
  let childOrganizationId: string | null = null;
  let siblingOrganizationId: string | null = null;

  const cleanup = async (): Promise<void> => {
    for (const userId of [...userIds].reverse()) {
      await deleteUserIfExists(request, superadminToken, userId);
    }
    for (const roleId of [...roleIds].reverse()) {
      await deleteRoleIfExists(request, superadminToken, roleId);
    }
    await deleteOrganizationIfExists(request, superadminToken, childOrganizationId);
    await deleteOrganizationIfExists(request, superadminToken, siblingOrganizationId);
    await deleteOrganizationIfExists(request, superadminToken, parentOrganizationId);
  };

  try {
    parentOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `QA ${scenario} Parent ${stamp}`,
      tenantId,
    });
    childOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `QA ${scenario} Child ${stamp}`,
      tenantId,
      parentId: parentOrganizationId,
    });
    siblingOrganizationId = await createOrganizationFixture(request, superadminToken, {
      name: `QA ${scenario} Sibling ${stamp}`,
      tenantId,
    });

    const actorEmail = `qa-${scenario.toLowerCase()}-actor-${stamp}@example.com`;
    const actorPassword = 'StrongSecret123!';
    const actorUserId = await createUserFixture(request, superadminToken, {
      email: actorEmail,
      password: actorPassword,
      organizationId: parentOrganizationId,
      roles: [],
    });
    userIds.push(actorUserId);
    await setUserAclVisibility(request, superadminToken, {
      userId: actorUserId,
      features: ['auth.users.edit'],
      organizations: [parentOrganizationId],
    });
    const actorToken = await getAuthToken(request, actorEmail, actorPassword);

    const createUser = async (input: CreateTrackedUserInput): Promise<string> => {
      const userId = await createUserFixture(request, superadminToken, {
        email: `qa-${scenario.toLowerCase()}-${input.emailPrefix}-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId: input.organizationId ?? parentOrganizationId as string,
        roles: input.roles ?? [],
      });
      userIds.push(userId);
      return userId;
    };

    const createRole = async (input: CreateTrackedRoleInput): Promise<string> => {
      const roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-${scenario.toLowerCase()}-${input.namePrefix}-${stamp}`,
        tenantId,
      });
      roleIds.push(roleId);
      if (input.features) {
        await setRoleAclFeatures(request, superadminToken, {
          roleId,
          features: input.features,
          organizations: null,
        });
      }
      return roleId;
    };

    return {
      superadminToken,
      actorToken,
      tenantId,
      parentOrganizationId,
      childOrganizationId,
      siblingOrganizationId,
      createUser,
      createRole,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
