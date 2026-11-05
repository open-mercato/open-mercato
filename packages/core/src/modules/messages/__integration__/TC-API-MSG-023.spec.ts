import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  composeInternalMessage,
  composeMessageWithToken,
  decodeJwtSubject,
  deleteMessageIfExists,
} from './helpers';

/**
 * TC-API-MSG-023: Undoing a recipient-only delete keeps a later global delete
 * Surfaces:
 *  - api/[id]/route.ts (DELETE) via messages.messages.delete_for_actor
 *  - POST /api/audit_logs/audit-logs/actions/undo
 *
 * A recipient deleting a message only hides it for themselves. If the sender
 * then deletes the message for everyone, the recipient undoing their own
 * earlier delete must restore only their recipient row and must not bring the
 * globally deleted message back for every participant. The sender undoing
 * their own global delete still restores the message. When a sender who is
 * also a recipient sends two overlapping deletes, each undo must reverse the
 * branch its own request actually executed. Replaying either delete token as
 * another actor without tenant-wide undo, as an actor from another
 * organization, or as an actor from another tenant is rejected and leaves both
 * deletes and their action logs untouched.
 */

type ReplayActor = {
  label: string;
  token: string;
};

type MessageDeletionState = {
  messageDeletedAt: Date | null;
  recipientStatus: string | null;
  recipientDeletedAt: Date | null;
  logStates: string[];
};

async function createTenantFixture(request: APIRequestContext, superadminToken: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: superadminToken,
    data: { name },
  });
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture should return an id');
}

async function deleteTenantIfExists(
  request: APIRequestContext,
  superadminToken: string | null,
  tenantId: string | null,
): Promise<void> {
  if (!superadminToken || !tenantId) return;
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, {
    token: superadminToken,
  }).catch(() => undefined);
}

async function createReplayActor(
  request: APIRequestContext,
  superadminToken: string,
  input: { label: string; stamp: string; tenantId: string; organizationId: string; features: string[] },
  created: Array<{ userId: string | null; roleId: string | null }>,
): Promise<ReplayActor> {
  const slot: { userId: string | null; roleId: string | null } = { userId: null, roleId: null };
  created.push(slot);
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `qa_msg023_${input.label}_${input.stamp}`,
    tenantId: input.tenantId,
  });
  slot.roleId = roleId;
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: input.features,
    organizations: [input.organizationId],
  });
  const email = `qa-msg023-${input.label}-${input.stamp}@test.invalid`;
  const password = 'Msg023!Pass1';
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password,
    organizationId: input.organizationId,
    roles: [roleId],
  });
  slot.userId = userId;
  const token = await getAuthToken(request, email, password);
  return { label: input.label, token };
}

async function readMessageDeletionState(
  messageId: string,
  recipientUserId: string,
  logIds: string[],
): Promise<MessageDeletionState> {
  return withClient(async (client) => {
    const messageRows = await client.query<{ deleted_at: Date | null }>(
      'select deleted_at from messages where id = $1',
      [messageId],
    );
    const recipientRows = await client.query<{ status: string; deleted_at: Date | null }>(
      'select status, deleted_at from message_recipients where message_id = $1 and recipient_user_id = $2',
      [messageId, recipientUserId],
    );
    const logRows = await client.query<{ id: string; execution_state: string }>(
      'select id, execution_state from action_logs where id = any($1::uuid[])',
      [logIds],
    );
    const logStateById = new Map(logRows.rows.map((row) => [row.id, row.execution_state]));
    return {
      messageDeletedAt: messageRows.rows[0]?.deleted_at ?? null,
      recipientStatus: recipientRows.rows[0]?.status ?? null,
      recipientDeletedAt: recipientRows.rows[0]?.deleted_at ?? null,
      logStates: logIds.map((logId) => logStateById.get(logId) ?? 'missing'),
    };
  });
}

test.describe('TC-API-MSG-023: Recipient delete undo keeps the sender global delete', () => {
  test('recipient undo after a sender global delete leaves the message deleted', async ({ request }) => {
    skipIfUndoTestsDisabled();
    let messageId: string | null = null;
    let senderToken: string | null = null;

    try {
      const composed = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-023 ${Date.now()}`,
      });
      messageId = composed.messageId;
      senderToken = composed.senderToken;
      const recipientToken = composed.recipientToken;
      const recipientUserId = decodeJwtSubject(recipientToken);

      const recipientDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: recipientToken,
      });
      expect(recipientDelete.status()).toBe(200);
      const recipientDeleteOperation = expectOperation(recipientDelete, 'recipient-only delete');
      expect(recipientDeleteOperation.commandId).toBe('messages.messages.delete_for_actor');

      const senderDetailAfterRecipientDelete = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterRecipientDelete.status()).toBe(200);

      const senderDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDelete.status()).toBe(200);

      const senderDetailAfterGlobalDelete = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterGlobalDelete.status()).toBe(404);

      await undoOk(request, recipientToken, recipientDeleteOperation.undoToken, 'recipient-only delete');

      const senderDetailAfterUndo = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(
        senderDetailAfterUndo.status(),
        'the sender global delete must survive the recipient undo',
      ).toBe(404);

      const recipientDetailAfterUndo = await apiRequest(
        request,
        'GET',
        `/api/messages/${messageId}?skipMarkRead=1`,
        { token: recipientToken },
      );
      expect(recipientDetailAfterUndo.status()).toBe(404);

      const persisted = await withClient(async (client) => {
        const messageRows = await client.query<{ deleted_at: Date | null }>(
          'select deleted_at from messages where id = $1',
          [messageId],
        );
        const recipientRows = await client.query<{ status: string; deleted_at: Date | null }>(
          'select status, deleted_at from message_recipients where message_id = $1 and recipient_user_id = $2',
          [messageId, recipientUserId],
        );
        return { message: messageRows.rows[0], recipient: recipientRows.rows[0] };
      });
      expect(persisted.message?.deleted_at, 'messages.deleted_at stays set after the recipient undo').not.toBeNull();
      expect(persisted.recipient?.deleted_at, 'the recipient row itself is restored').toBeNull();
      expect(persisted.recipient?.status).toBe('unread');
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId);
    }
  });

  test('sender undo of a global delete restores the message with its content', async ({ request }) => {
    skipIfUndoTestsDisabled();
    let messageId: string | null = null;
    let senderToken: string | null = null;

    try {
      const composed = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-023 global ${Date.now()}`,
      });
      messageId = composed.messageId;
      senderToken = composed.senderToken;

      const senderDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDelete.status()).toBe(200);
      const senderDeleteOperation = expectOperation(senderDelete, 'global delete');

      const senderDetailAfterDelete = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterDelete.status()).toBe(404);

      await undoOk(request, senderToken, senderDeleteOperation.undoToken, 'global delete');

      const senderDetailAfterUndo = await apiRequest(request, 'GET', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDetailAfterUndo.status()).toBe(200);
      const detailBody = (await senderDetailAfterUndo.json()) as { subject?: unknown };
      expect(detailBody.subject).toBe(composed.subject);
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId);
    }
  });

  test('overlapping deletes by a sender who is also a recipient undo to the original state', async ({ request }) => {
    skipIfUndoTestsDisabled();
    const senderToken = await getAuthToken(request, 'admin');
    const senderUserId = decodeJwtSubject(senderToken);
    const rounds = 5;

    for (let round = 0; round < rounds; round += 1) {
      let messageId: string | null = null;
      try {
        messageId = await composeMessageWithToken(request, senderToken, {
          recipients: [{ userId: senderUserId, type: 'to' }],
          subject: `QA TC-API-MSG-023 overlap ${round} ${Date.now()}`,
          body: 'Overlapping delete fixture',
          sendViaEmail: false,
        });

        const [firstDelete, secondDelete] = await Promise.all([
          apiRequest(request, 'DELETE', `/api/messages/${messageId}`, { token: senderToken }),
          apiRequest(request, 'DELETE', `/api/messages/${messageId}`, { token: senderToken }),
        ]);
        expect(firstDelete.status()).toBe(200);
        expect(secondDelete.status()).toBe(200);
        const pending = [
          expectOperation(firstDelete, `overlapping delete ${round} (first)`).undoToken,
          expectOperation(secondDelete, `overlapping delete ${round} (second)`).undoToken,
        ];

        const afterDeletes = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token: senderToken });
        expect(afterDeletes.status()).toBe(404);

        while (pending.length > 0) {
          let undone = false;
          for (let index = 0; index < pending.length; index += 1) {
            const response = await undoByToken(request, senderToken, pending[index]);
            if (response.ok()) {
              pending.splice(index, 1);
              undone = true;
              break;
            }
          }
          expect(undone, `one of the remaining overlapping deletes is undoable in round ${round}`).toBe(true);
        }

        const persisted = await withClient(async (client) => {
          const messageRows = await client.query<{ deleted_at: Date | null }>(
            'select deleted_at from messages where id = $1',
            [messageId],
          );
          const recipientRows = await client.query<{ deleted_at: Date | null }>(
            'select deleted_at from message_recipients where message_id = $1 and recipient_user_id = $2',
            [messageId, senderUserId],
          );
          return { message: messageRows.rows[0], recipient: recipientRows.rows[0] };
        });
        expect(persisted.message?.deleted_at, `round ${round}: undoing both deletes restores the message`).toBeNull();
        expect(persisted.recipient?.deleted_at, `round ${round}: undoing both deletes restores the recipient row`).toBeNull();
      } finally {
        await deleteMessageIfExists(request, senderToken, messageId);
        await deleteMessageIfExists(request, senderToken, messageId);
      }
    }
  });

  test('replaying the delete tokens as another actor, organization, or tenant is rejected', async ({ request }) => {
    skipIfUndoTestsDisabled();
    const stamp = `${Date.now()}`;
    const superadminToken = await getAuthToken(request, 'superadmin');
    const createdActors: Array<{ userId: string | null; roleId: string | null }> = [];
    let messageId: string | null = null;
    let senderToken: string | null = null;
    let otherOrganizationId: string | null = null;
    let otherTenantId: string | null = null;
    let otherTenantOrganizationId: string | null = null;

    try {
      const composed = await composeInternalMessage(request, {
        subject: `QA TC-API-MSG-023 replay ${stamp}`,
      });
      messageId = composed.messageId;
      senderToken = composed.senderToken;
      const recipientToken = composed.recipientToken;
      const recipientUserId = decodeJwtSubject(recipientToken);
      const senderScope = getTokenScope(senderToken);

      const recipientDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: recipientToken,
      });
      expect(recipientDelete.status()).toBe(200);
      const recipientDeleteOperation = expectOperation(recipientDelete, 'recipient-only delete');

      const senderDelete = await apiRequest(request, 'DELETE', `/api/messages/${messageId}`, {
        token: senderToken,
      });
      expect(senderDelete.status()).toBe(200);
      const senderDeleteOperation = expectOperation(senderDelete, 'global delete');

      const logIds = [recipientDeleteOperation.logId, senderDeleteOperation.logId];
      const deletedState = await readMessageDeletionState(messageId, recipientUserId, logIds);
      expect(deletedState.messageDeletedAt).not.toBeNull();
      expect(deletedState.recipientStatus).toBe('deleted');
      expect(deletedState.recipientDeletedAt).not.toBeNull();
      expect(deletedState.logStates).toEqual(['done', 'done']);

      otherOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-API-MSG-023 Other Org ${stamp}`,
        tenantId: senderScope.tenantId,
      });
      otherTenantId = await createTenantFixture(request, superadminToken, `QA TC-API-MSG-023 Tenant ${stamp}`);
      otherTenantOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-API-MSG-023 Tenant Org ${stamp}`,
        tenantId: otherTenantId,
      });

      const replayActors = [
        await createReplayActor(
          request,
          superadminToken,
          {
            label: 'peer',
            stamp,
            tenantId: senderScope.tenantId,
            organizationId: senderScope.organizationId,
            features: ['audit_logs.view_self', 'audit_logs.undo_self'],
          },
          createdActors,
        ),
        await createReplayActor(
          request,
          superadminToken,
          {
            label: 'otherorg',
            stamp,
            tenantId: senderScope.tenantId,
            organizationId: otherOrganizationId,
            features: ['audit_logs.view_self', 'audit_logs.undo_self', 'audit_logs.undo_tenant'],
          },
          createdActors,
        ),
        await createReplayActor(
          request,
          superadminToken,
          {
            label: 'othertenant',
            stamp,
            tenantId: otherTenantId,
            organizationId: otherTenantOrganizationId,
            features: ['*'],
          },
          createdActors,
        ),
      ];

      for (const actor of replayActors) {
        for (const operation of [recipientDeleteOperation, senderDeleteOperation]) {
          const replay = await undoByToken(request, actor.token, operation.undoToken);
          const replayBody = await readJsonSafe<{ error?: string }>(replay);
          expect(replay.status(), `${actor.label} replay of ${operation.logId} is rejected`).toBe(400);
          expect(replayBody?.error).toBe('Undo token not available');
        }
        const afterReplay = await readMessageDeletionState(messageId, recipientUserId, logIds);
        expect(afterReplay, `${actor.label} replays leave both deletes untouched`).toEqual(deletedState);
      }

      await undoOk(request, recipientToken, recipientDeleteOperation.undoToken, 'recipient-only delete');
      await undoOk(request, senderToken, senderDeleteOperation.undoToken, 'global delete');
      const restoredState = await readMessageDeletionState(messageId, recipientUserId, logIds);
      expect(restoredState.messageDeletedAt, 'the sender still undoes their own global delete').toBeNull();
      expect(restoredState.recipientDeletedAt, 'the recipient still undoes their own delete').toBeNull();
      expect(restoredState.recipientStatus).toBe('unread');
      expect(restoredState.logStates).toEqual(['undone', 'undone']);
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId);
      for (const actor of createdActors) {
        await deleteUserIfExists(request, superadminToken, actor.userId);
        await deleteRoleIfExists(request, superadminToken, actor.roleId);
      }
      await deleteOrganizationIfExists(request, superadminToken, otherTenantOrganizationId);
      await deleteTenantIfExists(request, superadminToken, otherTenantId);
      await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId);
    }
  });
});
