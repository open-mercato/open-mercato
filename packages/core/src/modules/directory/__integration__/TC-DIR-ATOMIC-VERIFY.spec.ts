import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-ATOMIC-VERIFY: verifies the atomic-write refactor of the directory
 * organizations module (PR #2360 / issue #2339) is 100% backward-compatible and
 * data-safe against a real database.
 *
 * Endpoints covered:
 *   - POST   /api/directory/organizations                                  (create)
 *   - GET    /api/directory/organizations?view=manage&tenantId=&ids=       (read manage view)
 *   - GET    /api/directory/organizations?ids=&tenantId=                   (read options view)
 *   - PUT    /api/directory/organizations                                  (update + reparent)
 *   - DELETE /api/directory/organizations?id=                              (delete + child reparent)
 *   - POST   /api/audit_logs/audit-logs/actions/undo                       (undo — see note)
 *
 * Asserts:
 *   1. Field fidelity (set -> read) for every field the create validator accepts
 *      (name, slug, isActive, parentId, childIds) via both the manage and options
 *      views; PUT update of name/slug re-reads consistently.
 *   2. Hierarchy stays atomically consistent across a reparent: moving child B
 *      from parent A to a new parent C updates B.parentId, A.childIds and
 *      C.childIds together — no half-applied reparent.
 *   3. Delete reparents children to the deleted node's parent (root) atomically
 *      and the deleted node disappears from the manage view.
 *
 * NOTE on org undo (issue #2398 — now reachable):
 *   directory.organizations create/delete return an `x-om-operation` undo token.
 *   Org action logs are tenant-level (organization_id = NULL) because orgs are not
 *   nested under another org. Previously the public undo route
 *   (/api/audit_logs/audit-logs/actions/undo) re-scoped its latest-undoable lookup
 *   to the caller's resolved organization, so a super-admin (the only role allowed
 *   to manage organizations) resolving to a concrete home org never matched the
 *   null-org row and got HTTP 400 "Undo token not available". The route now scopes
 *   the lookup to the target row's own organization, so a super-admin can undo a
 *   recent org create/update/delete/reparent. The undo subcase below exercises the
 *   create-undo round-trip end to end.
 */

type ManageOrg = {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
  isActive: boolean;
  ancestorIds?: string[];
  childIds?: string[];
};

type OptionsOrg = {
  id: string;
  name: string;
  parentId: string | null;
  tenantId: string | null;
  isActive: boolean;
};

async function createOrg(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', '/api/directory/organizations', { token, data });
  expect(res.status(), 'create organization returns 201').toBe(201);
  const body = await readJsonSafe<{ id?: string }>(res);
  expect(typeof body?.id, 'create returns an id').toBe('string');
  return body!.id as string;
}

function readUndoToken(res: APIResponse): string {
  const enc = (res.headers()['x-om-operation'] ?? '').slice(5);
  expect(enc, 'x-om-operation header carries an omop: payload').not.toBe('');
  const payload = JSON.parse(decodeURIComponent(enc)) as { undoToken?: string };
  expect(typeof payload.undoToken, 'undoToken present in operation payload').toBe('string');
  return payload.undoToken as string;
}

async function undoAction(request: APIRequestContext, token: string, undoToken: string): Promise<void> {
  const res = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
    token,
    data: { undoToken },
  });
  expect(res.status(), 'undo returns 200').toBe(200);
  const body = await readJsonSafe<{ ok?: boolean }>(res);
  expect(body?.ok, 'undo body is { ok: true }').toBe(true);
}

async function loadManageById(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  orgId: string,
): Promise<ManageOrg | undefined> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(orgId)}`,
    { token },
  );
  expect(res.status(), 'GET manage view returns 200').toBe(200);
  const body = await readJsonSafe<{ items?: ManageOrg[] }>(res);
  return body?.items?.find((item) => item.id === orgId);
}

async function loadOptionsById(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  orgId: string,
): Promise<OptionsOrg | undefined> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(orgId)}`,
    { token },
  );
  expect(res.status(), 'GET options view returns 200').toBe(200);
  const body = await readJsonSafe<{ items?: OptionsOrg[] }>(res);
  return body?.items?.find((item) => item.id === orgId);
}

async function deleteOrgIfExists(
  request: APIRequestContext,
  token: string | null,
  orgId: string | null,
): Promise<void> {
  if (!token || !orgId) return;
  await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${encodeURIComponent(orgId)}`, {
    token,
  }).catch(() => undefined);
}

test.describe('TC-DIR-ATOMIC-VERIFY: directory organizations atomic refactor (PR #2360)', () => {
  test('field fidelity: create fields round-trip and update persists consistently', async ({ request }) => {
    let token: string | null = null;
    let orgId: string | null = null;
    const stamp = Date.now();

    try {
      // Organizations can only be created by super-admin with an explicit tenant.
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      expect(tenantId, 'superadmin token carries a tenant id').toBeTruthy();

      const slug = `tc-dir-atomic-${stamp}`;
      const createPayload = {
        tenantId,
        name: `TC-DIR Atomic ${stamp}`,
        slug,
        isActive: true,
      };
      orgId = await createOrg(request, token, createPayload);

      // Set -> read fidelity (manage view exposes slug + hierarchy arrays).
      const manage = await loadManageById(request, token, tenantId, orgId);
      expect(manage, 'created organization readable in manage view').toBeTruthy();
      expect(manage!.name).toBe(createPayload.name);
      expect(manage!.slug).toBe(slug);
      expect(manage!.isActive).toBe(true);
      expect(manage!.parentId).toBeNull();
      expect(manage!.childIds ?? []).toEqual([]);
      expect(manage!.ancestorIds ?? []).toEqual([]);

      // The options view (default) projects a smaller field set; assert its parity.
      const options = await loadOptionsById(request, token, tenantId, orgId);
      expect(options, 'created organization readable in options view').toBeTruthy();
      expect(options!.name).toBe(createPayload.name);
      expect(options!.parentId).toBeNull();
      expect(options!.tenantId).toBe(tenantId);
      expect(options!.isActive).toBe(true);

      // PUT update of name + slug and re-read.
      const updatedName = `TC-DIR Atomic Renamed ${stamp}`;
      const updatedSlug = `tc-dir-atomic-renamed-${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: orgId, tenantId, name: updatedName, slug: updatedSlug },
      });
      expect(updateRes.status(), 'update returns 200').toBe(200);

      const afterUpdate = await loadManageById(request, token, tenantId, orgId);
      expect(afterUpdate?.name, 'name persisted').toBe(updatedName);
      expect(afterUpdate?.slug, 'slug persisted').toBe(updatedSlug);
      // Untouched fields preserved.
      expect(afterUpdate?.isActive, 'isActive preserved').toBe(true);
      expect(afterUpdate?.parentId, 'parentId preserved').toBeNull();
    } finally {
      await deleteOrgIfExists(request, token, orgId);
    }
  });

  test('reparent is atomic: moving B from A to C updates parentId and both childIds together', async ({ request }) => {
    let token: string | null = null;
    let aId: string | null = null;
    let bId: string | null = null;
    let cId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      aId = await createOrg(request, token, { tenantId, name: `TC-DIR A ${stamp}`, slug: `tc-dir-a-${stamp}`, isActive: true });
      cId = await createOrg(request, token, { tenantId, name: `TC-DIR C ${stamp}`, slug: `tc-dir-c-${stamp}`, isActive: true });
      bId = await createOrg(request, token, {
        tenantId,
        name: `TC-DIR B ${stamp}`,
        slug: `tc-dir-b-${stamp}`,
        isActive: true,
        parentId: aId,
      });

      // Before reparent: B under A.
      const bBefore = await loadManageById(request, token, tenantId, bId);
      expect(bBefore?.parentId, 'B.parentId should be A').toBe(aId);
      expect(bBefore?.ancestorIds ?? [], 'B.ancestorIds should include A').toContain(aId);
      const aBefore = await loadManageById(request, token, tenantId, aId);
      expect(aBefore?.childIds ?? [], 'A.childIds should include B').toContain(bId);
      const cBefore = await loadManageById(request, token, tenantId, cId);
      expect(cBefore?.childIds ?? [], 'C.childIds should be empty before reparent').not.toContain(bId);

      // Atomic reparent: move B from A to C.
      const reparentRes = await apiRequest(request, 'PUT', '/api/directory/organizations', {
        token,
        data: { id: bId, tenantId, parentId: cId },
      });
      expect(reparentRes.status(), 'reparent returns 200').toBe(200);

      // After reparent: B under C, A emptied, C gained B — all consistent.
      const bAfter = await loadManageById(request, token, tenantId, bId);
      expect(bAfter?.parentId, 'B.parentId should now be C').toBe(cId);
      expect(bAfter?.ancestorIds ?? [], 'B.ancestorIds should include C').toContain(cId);
      expect(bAfter?.ancestorIds ?? [], 'B.ancestorIds should no longer include A').not.toContain(aId);

      const aAfter = await loadManageById(request, token, tenantId, aId);
      expect(aAfter?.childIds ?? [], 'A.childIds should no longer include B').not.toContain(bId);

      const cAfter = await loadManageById(request, token, tenantId, cId);
      expect(cAfter?.childIds ?? [], 'C.childIds should now include B').toContain(bId);
    } finally {
      // Delete children before parents to avoid reparent churn.
      await deleteOrgIfExists(request, token, bId);
      await deleteOrgIfExists(request, token, aId);
      await deleteOrgIfExists(request, token, cId);
    }
  });

  test('delete reparents children atomically and removes the parent from the manage view', async ({ request }) => {
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      parentId = await createOrg(request, token, {
        tenantId,
        name: `TC-DIR Parent ${stamp}`,
        slug: `tc-dir-parent-${stamp}`,
        isActive: true,
      });
      childId = await createOrg(request, token, {
        tenantId,
        name: `TC-DIR Child ${stamp}`,
        slug: `tc-dir-child-${stamp}`,
        isActive: true,
        parentId,
      });

      const childBefore = await loadManageById(request, token, tenantId, childId);
      expect(childBefore?.parentId, 'child under parent before delete').toBe(parentId);

      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/directory/organizations?id=${encodeURIComponent(parentId)}`,
        { token },
      );
      expect(deleteRes.status(), 'delete parent returns 200').toBe(200);
      const deletedParentId = parentId;
      parentId = null;

      // Child reparented to root (deleted parent's parent) with a rebuilt hierarchy.
      const childAfter = await loadManageById(request, token, tenantId, childId);
      expect(childAfter, 'child still exists after parent delete').toBeTruthy();
      expect(childAfter?.parentId, 'child.parentId cleared to null').toBeNull();
      expect(childAfter?.ancestorIds ?? [], 'child no longer references deleted parent').not.toContain(deletedParentId);

      // Parent gone from the manage view.
      const parentAfter = await loadManageById(request, token, tenantId, deletedParentId);
      expect(parentAfter, 'deleted parent absent from manage view').toBeUndefined();
    } finally {
      await deleteOrgIfExists(request, token, childId);
      await deleteOrgIfExists(request, token, parentId);
    }
  });

  // Issue #2398: org create undo via the public undo API is now reachable for the
  // super-admin actor. The create-issued undo token round-trips through the public
  // undo route and removes the freshly created org from the manage view.
  test('org create undo via public undo API removes the created org (issue #2398)', async ({ request }) => {
    let token: string | null = null;
    let orgId: string | null = null;
    let undone = false;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);
      expect(tenantId, 'superadmin token carries a tenant id').toBeTruthy();

      const slug = `tc-dir-undo-${stamp}`;
      const createRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { tenantId, name: `TC-DIR Undo ${stamp}`, slug, isActive: true },
      });
      expect(createRes.status(), 'create organization returns 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string }>(createRes);
      expect(typeof createBody?.id, 'create returns an id').toBe('string');
      orgId = createBody!.id as string;
      const undoToken = readUndoToken(createRes);

      // Sanity: the org is present before the undo.
      const before = await loadManageById(request, token, tenantId!, orgId);
      expect(before, 'created organization present before undo').toBeTruthy();

      // Undo the create through the public undo API (was HTTP 400 before #2398).
      await undoAction(request, token, undoToken);
      undone = true;

      // Undo of a create removes the org from the manage view.
      const after = await loadManageById(request, token, tenantId!, orgId);
      expect(after, 'organization removed from manage view after undo').toBeUndefined();
    } finally {
      // If the undo did not run (e.g. earlier failure), clean up the org directly.
      if (!undone) await deleteOrgIfExists(request, token, orgId);
    }
  });
});
