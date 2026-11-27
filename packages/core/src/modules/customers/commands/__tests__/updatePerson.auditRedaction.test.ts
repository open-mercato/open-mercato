/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import '@open-mercato/core/modules/customers/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandLogMetadata, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { redactActionLogEntries } from '@open-mercato/core/modules/audit_logs/lib/actionLogRedaction'
import {
  loadCustomerAuditRedactionContext,
  redactCustomerAuditEntry,
} from '@open-mercato/core/modules/customers/lib/auditRedaction'

const TENANT_ID = '00000000-0000-4000-8000-0000000000b1'
const ORG_ID = '00000000-0000-4000-8000-0000000000a1'
const PERSON_ID = '00000000-0000-4000-8000-0000000000c1'
const INTERACTION_ID = '00000000-0000-4000-8000-0000000000d1'
const EDITOR_USER_ID = '00000000-0000-4000-8000-0000000000e1'
const EMAIL_AUTHOR_USER_ID = '00000000-0000-4000-8000-0000000000e2'

const PRIVATE_SUBJECT = 'Confidential offer to Jane'
const PRIVATE_BODY = 'Plaintext body that only the mailbox owner may read'
const PRIVATE_PARTICIPANTS = [{ email: 'jane.private@example.com' }]

type SnapshotRecord = Record<string, unknown> & { interactions: Array<Record<string, unknown>> }

function makeDecryptedPersonSnapshot(displayName: string): SnapshotRecord {
  return {
    entity: {
      id: PERSON_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      kind: 'person',
      displayName,
      nextInteractionRefId: null,
      nextInteractionName: null,
    },
    interactions: [
      {
        id: INTERACTION_ID,
        interactionType: 'email',
        title: PRIVATE_SUBJECT,
        body: PRIVATE_BODY,
        participants: PRIVATE_PARTICIPANTS,
        status: 'done',
        authorUserId: EMAIL_AUTHOR_USER_ID,
        ownerUserId: EMAIL_AUTHOR_USER_ID,
        custom: { cf_secret: 'private custom value' },
      },
    ],
  }
}

function makeRedactionEm(): EntityManager {
  const find = jest.fn(async (_entityName: unknown, where: Record<string, unknown>) => {
    const idFilter = where?.id as { $in?: string[] } | undefined
    if (idFilter?.$in?.includes(INTERACTION_ID)) {
      return [{
        id: INTERACTION_ID,
        visibility: 'private',
        authorUserId: EMAIL_AUTHOR_USER_ID,
        channelId: null,
        entity: PERSON_ID,
      }]
    }
    return []
  })
  return { find } as unknown as EntityManager
}

const redactionContainer = {
  hasRegistration: (name: string) => name === 'actionLogRedactionProvider',
  resolve: <R = unknown>(_name: string): R => ({
    loadContext: loadCustomerAuditRedactionContext,
    redactEntry: redactCustomerAuditEntry,
  }) as R,
}

async function buildUpdatePersonLog(): Promise<CommandLogMetadata> {
  const handler = commandRegistry.get('customers.people.update') as CommandHandler<unknown, { entityId: string }>
  expect(handler?.buildLog).toBeDefined()
  const before = makeDecryptedPersonSnapshot('Jane Doe')
  const after = makeDecryptedPersonSnapshot('Jane Q. Doe')
  const log = await handler.buildLog!({
    input: { id: PERSON_ID },
    result: { entityId: PERSON_ID },
    ctx: {} as CommandRuntimeContext,
    snapshots: { before, after },
  })
  expect(log).toBeTruthy()
  return log as CommandLogMetadata
}

function toStoredActionLog(log: CommandLogMetadata): ActionLog {
  return {
    id: 'action-log-1',
    commandId: 'customers.people.update',
    actionLabel: log.actionLabel,
    executionState: 'done',
    actorUserId: EDITOR_USER_ID,
    tenantId: log.tenantId,
    organizationId: log.organizationId,
    resourceKind: log.resourceKind,
    resourceId: log.resourceId,
    snapshotBefore: log.snapshotBefore,
    snapshotAfter: log.snapshotAfter,
    changesJson: {
      displayName: { from: 'Jane Doe', to: 'Jane Q. Doe' },
      interactions: {
        from: (log.snapshotBefore as SnapshotRecord).interactions,
        to: (log.snapshotAfter as SnapshotRecord).interactions,
      },
    },
    commandPayload: log.payload,
  } as unknown as ActionLog
}

async function readAsViewer(viewerUserId: string): Promise<ActionLog> {
  const stored = toStoredActionLog(await buildUpdatePersonLog())
  const [entry] = await redactActionLogEntries(
    redactionContainer,
    makeRedactionEm(),
    { tenantId: TENANT_ID, organizationId: ORG_ID },
    viewerUserId,
    [stored],
  )
  return entry
}

function embeddedInteraction(snapshot: unknown): Record<string, unknown> {
  return (snapshot as SnapshotRecord).interactions[0]
}

describe('customers.people.update audit snapshots with decrypted command reads (#2115)', () => {
  it('does not expose another user\'s private email plaintext to an audit_logs.view_self reader', async () => {
    const entry = await readAsViewer(EDITOR_USER_ID)

    for (const snapshot of [entry.snapshotBefore, entry.snapshotAfter]) {
      const interaction = embeddedInteraction(snapshot)
      expect(interaction.title).toBeNull()
      expect(interaction.body).toBeNull()
      expect(interaction.participants).toBeNull()
      expect(interaction.custom).toBeNull()
    }
    const changes = entry.changesJson as { interactions: { from: unknown[]; to: unknown[] } }
    expect(embeddedInteraction({ interactions: changes.interactions.from }).title).toBeNull()
    expect(embeddedInteraction({ interactions: changes.interactions.to }).body).toBeNull()

    const serialized = JSON.stringify({
      snapshotBefore: entry.snapshotBefore,
      snapshotAfter: entry.snapshotAfter,
      changes: entry.changesJson,
    })
    expect(serialized).not.toContain(PRIVATE_SUBJECT)
    expect(serialized).not.toContain(PRIVATE_BODY)
    expect(serialized).not.toContain('jane.private@example.com')
    expect(serialized).toContain('Jane Q. Doe')
  })

  it('keeps the private email visible to its own author', async () => {
    const entry = await readAsViewer(EMAIL_AUTHOR_USER_ID)
    expect(embeddedInteraction(entry.snapshotBefore).title).toBe(PRIVATE_SUBJECT)
    expect(embeddedInteraction(entry.snapshotAfter).body).toBe(PRIVATE_BODY)
  })

  it('keeps the full undo payload intact so undo still restores the person', async () => {
    const log = await buildUpdatePersonLog()
    const payload = log.payload as { undo: { before: SnapshotRecord; after: SnapshotRecord } }
    expect(payload.undo.before.entity).toMatchObject({ id: PERSON_ID, displayName: 'Jane Doe' })
    expect(payload.undo.after.entity).toMatchObject({ displayName: 'Jane Q. Doe' })
  })
})
