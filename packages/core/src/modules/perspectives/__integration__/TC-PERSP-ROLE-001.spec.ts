import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RolePerspectiveDto = { id?: string; roleId?: string; name?: string; isDefault?: boolean; settings?: Record<string, unknown> };
type SaveResponse = { perspective?: { id?: string }; rolePerspectives?: RolePerspectiveDto[] };
type StateResponse = { roles?: Array<{ id?: string; name?: string }>; canApplyToRoles?: boolean };

/**
 * TC-PERSP-ROLE-001 (#2491): POST applyToRoles saves a role perspective for every targeted role.
 *
 * Verification is via the POST response, which is the authoritative record of what the save
 * wrote: it returns one role perspective per applied role, each carrying the shared name and
 * settings. The GET index only surfaces role perspectives for roles the CALLER is a member of
 * (the handler loads role state with the caller's own assignedRoleIds), so an admin who is not
 * a member of the freshly-created target roles cannot read their perspectives through GET by
 * design — member-scoped GET reflection of a role perspective is covered by TC-PERSP-ROLE-002.
 * Here GET is used only to confirm the roles are exposed as assignment targets.
 */
test.describe('TC-PERSP-ROLE-001: applyToRoles saves a role perspective per role', () => {
  test('saves the same configuration to every applied role and lists the roles as targets', async ({ request }) => {
    test.slow();
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-role-001-${stamp}`;
    const perspectiveName = `Shared View ${stamp}`;
    const settings = { pageSize: 33, columnOrder: ['col-x', 'col-y'], searchValue: `needle-${stamp}` };

    let viewerRoleId: string | null = null;
    let editorRoleId: string | null = null;
    let personalId: string | null = null;

    try {
      const viewer = await createRoleFixture(request, token, { name: `TC-PERSP-ROLE-001 Viewer ${stamp}` });
      const editor = await createRoleFixture(request, token, { name: `TC-PERSP-ROLE-001 Editor ${stamp}` });
      viewerRoleId = viewer;
      editorRoleId = editor;

      const saveRes = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name: perspectiveName, settings, applyToRoles: [viewer, editor], setRoleDefault: true },
      });
      expect(saveRes.status(), 'save with applyToRoles').toBe(200);
      const body = await readJsonSafe<SaveResponse>(saveRes);

      personalId = body?.perspective?.id ?? null;
      expect(typeof personalId === 'string' && UUID_RE.test(personalId), 'personal perspective id is a UUID').toBe(true);

      const rolePerspectives = body?.rolePerspectives ?? [];
      expect(rolePerspectives, 'one role perspective per applied role').toHaveLength(2);
      const byRole = new Map(rolePerspectives.map((rp): [string | undefined, RolePerspectiveDto] => [rp.roleId, rp]));
      for (const roleId of [viewer, editor]) {
        const rolePerspective = byRole.get(roleId);
        expect(rolePerspective, `role perspective saved for role ${roleId}`).toBeTruthy();
        expect(rolePerspective!.name).toBe(perspectiveName);
        expect(rolePerspective!.isDefault, 'setRoleDefault=true marks the role perspective default').toBe(true);
        expect(rolePerspective!.settings).toMatchObject(settings);
      }

      // A role_defaults-capable admin sees both roles as assignment targets.
      const stateRes = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
      expect(stateRes.status()).toBe(200);
      const state = await readJsonSafe<StateResponse>(stateRes);
      expect(state?.canApplyToRoles, 'admin can apply to roles').toBe(true);
      const roleIds = (state?.roles ?? []).map((role) => role.id);
      expect(roleIds).toContain(viewer);
      expect(roleIds).toContain(editor);
    } finally {
      if (personalId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${personalId}`, { token }).catch(() => {});
      }
      // Clear role perspectives before removing the roles (admin holds perspectives.role_defaults).
      if (viewerRoleId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${viewerRoleId}`, { token }).catch(() => {});
      }
      if (editorRoleId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/roles/${editorRoleId}`, { token }).catch(() => {});
      }
      await deleteRoleIfExists(request, token, viewerRoleId);
      await deleteRoleIfExists(request, token, editorRoleId);
    }
  });
});
