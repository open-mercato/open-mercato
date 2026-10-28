import { expect, test, type Page } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  Cleanup,
  addProjectMember,
  adminToken,
  createProject,
  createStaffPerson,
  deleteTask,
  dismissNotices,
  getStaffTask,
  listProjectStatuses,
  loginStaffInBrowser,
  moveTask,
} from '@open-mercato/core/modules/staff/__integration__/support/fixtures';
import {
  getRecordLockSettings,
  saveRecordLockSettings,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-STAFF-time-task: record locks on the time-tracking task drawer
 * (`staff.timesheets.task`).
 *
 * The drawer saves every property on its own (status, assignee, …) through
 * `useGuardedMutation`, so record locking sees a stream of small saves rather
 * than one form submit. Two failures meet in the lock the record-lock widget
 * takes after each save:
 *
 *  - #8101: a single user, nobody else editing, is refused from the third save
 *    on, because the lock's base action log stays at the first save while the
 *    user's own later saves move the record forward.
 *  - #8045: once a save over another user's change is refused, the drawer user
 *    stays refused for the lock's lifetime, even from the refreshed latest
 *    version and after a reload, because the refusal leaves a pending conflict
 *    that the drawer has no way to resolve.
 *
 * Self-contained: creates its own project, people and task, restores the
 * record-lock settings and deletes everything in `finally`.
 */

type StatusOption = { id: string; name: string };

async function projectStatuses(request: Parameters<typeof listProjectStatuses>[0], token: string, projectId: string): Promise<StatusOption[]> {
  const rows = (await listProjectStatuses(request, token, projectId)) as Array<{ id: string; name?: string }>;
  return rows.map((row) => ({ id: row.id, name: String(row.name ?? '') })).filter((row) => row.name.length > 0);
}

async function createTask(request: Parameters<typeof apiRequest>[0], token: string, projectId: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/staff/timesheets/tasks', {
    token,
    data: { timeProjectId: projectId, title: `QA lock drawer ${Date.now()}` },
  });
  expect(response.ok(), `create task failed with ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function openDrawer(page: Page, projectId: string, taskId: string) {
  await page.goto(`/backend/staff/time-tracking/board?projectId=${projectId}&task=${taskId}`, { waitUntil: 'domcontentloaded' });
  await dismissNotices(page);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('task-drawer-status-select')).toBeVisible({ timeout: 60_000 });
  return drawer;
}

/**
 * Picks a status in the drawer and returns the HTTP status of the save it sent (null when
 * none left). After a successful save it also waits for the record-lock widget to take its
 * lock, as it does after every save, so the next step meets the lock a real user would.
 */
async function pickStatus(page: Page, statusName: string): Promise<number | null> {
  const drawer = page.getByRole('dialog');
  const save = page
    .waitForResponse(
      (response) => /\/api\/staff\/timesheets\/tasks\/[^/]+\/status$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'PATCH',
      { timeout: 15_000 },
    )
    .then((response) => response.status())
    .catch(() => null);
  const lockRefreshed = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/record_locks/acquire' && response.request().method() === 'POST',
      { timeout: 15_000 },
    )
    .catch(() => null);
  await drawer.getByTestId('task-drawer-status-select').click();
  await page.getByRole('option', { name: statusName, exact: true }).click();
  const status = await save;
  if (status === 200) await lockRefreshed;
  await expect(drawer.getByTestId('task-drawer-status-select')).toBeEnabled({ timeout: 15_000 });
  return status;
}

test.describe('TC-LOCK-STAFF-time-task: record locks on the time-tracking task drawer', () => {
  test.describe.configure({ timeout: 240_000 });

  let previousSettings: RecordLockSettings | null = null;
  let superadmin: string;

  test.beforeEach(async ({ request }) => {
    superadmin = await getAuthToken(request, 'superadmin');
    previousSettings = await getRecordLockSettings(request, superadmin);
    await saveRecordLockSettings(request, superadmin, {
      ...previousSettings,
      enabled: true,
      strategy: 'optimistic',
      enabledResources: ['staff.timesheets.task'],
    });
  });

  test.afterEach(async ({ request }) => {
    if (previousSettings) await saveRecordLockSettings(request, superadmin, previousSettings).catch(() => {});
  });

  test('#8101: one user saving properties one after another is never refused', async ({ browser, request }) => {
    const cleanup = new Cleanup();
    try {
      const admin = await adminToken(request);
      const project = await createProject(request, admin, cleanup, 'lock-solo');
      const editor = await createStaffPerson(request, admin, cleanup, 'lock-solo-editor', ['admin']);
      await addProjectMember(request, admin, project.id, editor.staffMemberId);
      const statuses = await projectStatuses(request, admin, project.id);
      expect(statuses.length).toBeGreaterThanOrEqual(3);
      const taskId = await createTask(request, admin, project.id);
      cleanup.add(() => deleteTask(request, admin, taskId));

      const context = await browser.newContext();
      cleanup.add(() => context.close());
      const page = await context.newPage();
      await loginStaffInBrowser(page, editor);
      const drawer = await openDrawer(page, project.id, taskId);

      const sequence = [statuses[1], statuses[2], statuses[0], statuses[1]];
      const results: Array<number | null> = [];
      for (const status of sequence) results.push(await pickStatus(page, status.name));

      expect(results, 'every save by the only editor succeeds').toEqual(sequence.map(() => 200));
      await expect(drawer.getByTestId('task-drawer-notice')).toHaveCount(0);
      const saved = (await getStaffTask(request, admin, taskId)) as { task_status_id?: string } | null;
      expect(saved?.task_status_id).toBe(sequence[sequence.length - 1].id);
    } finally {
      await cleanup.run();
    }
  });

  test('#8045: after another user changes the task, the drawer user can save again from the latest version', async ({ browser, request }) => {
    const cleanup = new Cleanup();
    try {
      const admin = await adminToken(request);
      const project = await createProject(request, admin, cleanup, 'lock-pair');
      const editor = await createStaffPerson(request, admin, cleanup, 'lock-pair-editor', ['admin']);
      const other = await createStaffPerson(request, admin, cleanup, 'lock-pair-other', ['admin']);
      await addProjectMember(request, admin, project.id, editor.staffMemberId);
      await addProjectMember(request, admin, project.id, other.staffMemberId);
      const statuses = await projectStatuses(request, admin, project.id);
      expect(statuses.length).toBeGreaterThanOrEqual(3);
      const taskId = await createTask(request, admin, project.id);
      cleanup.add(() => deleteTask(request, admin, taskId));

      const context = await browser.newContext();
      cleanup.add(() => context.close());
      const page = await context.newPage();
      await loginStaffInBrowser(page, editor);
      await openDrawer(page, project.id, taskId);

      expect(await pickStatus(page, statuses[1].name), 'the editor first save succeeds').toBe(200);

      const otherWrite = await moveTask(request, other.token, taskId, statuses[2].id);
      expect(otherWrite.ok(), 'the other user change succeeds').toBeTruthy();

      // The editor saves over a change they have not seen yet: refusing it is correct.
      expect(await pickStatus(page, statuses[0].name), 'a save over an unseen change is not applied').not.toBe(200);
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByTestId('task-drawer-notice')).toBeVisible();
      await expect(drawer.getByTestId('task-drawer-status-select')).toHaveText(statuses[2].name, { timeout: 30_000 });

      // The drawer now shows the latest version, so the next save must go through.
      expect(await pickStatus(page, statuses[0].name), 'a save made from the latest version succeeds').toBe(200);
      let saved = (await getStaffTask(request, admin, taskId)) as { task_status_id?: string } | null;
      expect(saved?.task_status_id).toBe(statuses[0].id);

      // And a reload does not bring the refusal back.
      await openDrawer(page, project.id, taskId);
      expect(await pickStatus(page, statuses[1].name), 'a save after a reload succeeds').toBe(200);
      saved = (await getStaffTask(request, admin, taskId)) as { task_status_id?: string } | null;
      expect(saved?.task_status_id).toBe(statuses[1].id);
    } finally {
      await cleanup.run();
    }
  });
});
