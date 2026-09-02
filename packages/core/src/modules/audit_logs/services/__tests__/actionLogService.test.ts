import { ActionLogService, SCHEMA_UUID_REGEX } from '../actionLogService'
import { uuid } from '@open-mercato/core/modules/audit_logs/data/validators'

type OrGroup = { __group: 'or'; children: unknown[] }
type ExpressionBuilderMock = ((...args: unknown[]) => unknown) & {
  and: (children: unknown[]) => unknown
  or: (children: unknown[]) => unknown
}
type WhereCallback = (eb: ExpressionBuilderMock) => unknown
type FakeQueryBuilder = {
  selectAll: () => FakeQueryBuilder
  where: (...args: unknown[]) => FakeQueryBuilder
  orderBy: () => FakeQueryBuilder
  _state: { wheres: WhereCallback[] }
}

function buildServiceForQueryInspection(): {
  service: ActionLogService
  build: (query: Record<string, unknown>) => { orGroup: OrGroup | null }
} {
  const fakeKysely = {
    selectFrom(_table: string) {
      const state: FakeQueryBuilder['_state'] = { wheres: [] }
      const builder: FakeQueryBuilder = {
        selectAll: () => builder,
        where: (...args: unknown[]) => {
          if (typeof args[0] === 'function') {
            state.wheres.push(args[0] as WhereCallback)
          }
          return builder
        },
        orderBy: () => builder,
        _state: state,
      }
      return builder
    },
  }
  const fakeEm = { getKysely: () => fakeKysely }
  const service = new ActionLogService(fakeEm as unknown as ConstructorParameters<typeof ActionLogService>[0])
  const serviceWithPrivate = service as unknown as {
    buildListQuery: (parsed: Record<string, unknown>) => FakeQueryBuilder
    parseListQuery: (query: Record<string, unknown>) => Record<string, unknown>
  }
  return {
    service,
    build: (query) => {
      const parsed = serviceWithPrivate.parseListQuery(query)
      const builder = serviceWithPrivate.buildListQuery(parsed)
      let orGroup: OrGroup | null = null
      const ebMock = ((..._args: unknown[]) => ({ __leaf: true })) as ExpressionBuilderMock
      ebMock.and = (children: unknown[]) => ({ __group: 'and', children })
      ebMock.or = (children: unknown[]) => {
        const group: OrGroup = { __group: 'or', children }
        orGroup = group
        return group
      }
      for (const w of builder._state.wheres) {
        try {
          w(ebMock)
        } catch {
          continue
        }
      }
      return { orGroup }
    },
  }
}

describe('ActionLogService.buildListQuery - related resource filter', () => {
  it('adds a generic related-resource OR branch with includeRelated', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      includeRelated: true,
    })
    expect(orGroup).not.toBeNull()
    expect(orGroup!.children.length).toBe(3)
  })

  it('uses the same related-resource branch for non-deal resources with includeRelated', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.person',
      resourceId: 'person-1',
      includeRelated: true,
    })
    expect(orGroup).not.toBeNull()
    expect(orGroup!.children.length).toBe(3)
  })

  it('emits no OR group when includeRelated is false for deals', () => {
    const { build } = buildServiceForQueryInspection()
    const { orGroup } = build({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      includeRelated: false,
    })
    expect(orGroup).toBeNull()
  })
})

describe('ActionLogService normalizeInput', () => {
  it('maps optional strings to undefined and parent fields to null', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }
    const normalized = serviceWithPrivateAccess.normalizeInput({
      commandId: 'cmd-1',
      actionLabel: null,
      resourceKind: '',
      resourceId: undefined,
      undoToken: null,
      parentResourceKind: '',
      parentResourceId: undefined,
      relatedResourceKind: 'customers.deal',
      relatedResourceId: 'deal-1',
    })

    expect(normalized.actionLabel).toBeUndefined()
    expect(normalized.resourceKind).toBeUndefined()
    expect(normalized.resourceId).toBeUndefined()
    expect(normalized.undoToken).toBeUndefined()
    expect(normalized.parentResourceKind).toBeNull()
    expect(normalized.parentResourceId).toBeNull()
    expect(normalized.relatedResourceKind).toBe('customers.deal')
    expect(normalized.relatedResourceId).toBe('deal-1')
  })

  it('defaults related resource fields to null when fallback normalization receives no input', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: null) => Record<string, unknown>
    }
    const normalized = serviceWithPrivateAccess.normalizeInput(null)

    expect(normalized.relatedResourceKind).toBeNull()
    expect(normalized.relatedResourceId).toBeNull()
  })

  it('normalizes only UUID actor ids into the uuid-backed actor column', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
    }).actorUserId).toBeNull()

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'customers.people.update',
      actorUserId: '11111111-1111-4111-8111-111111111111',
    }).actorUserId).toBe('11111111-1111-4111-8111-111111111111')

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'api.something',
      actorUserId: 'api_key:22222222-2222-4222-8222-222222222222',
    }).actorUserId).toBe('22222222-2222-4222-8222-222222222222')

    expect(serviceWithPrivateAccess.normalizeInput({
      commandId: 'test',
      actorUserId: 'not-a-uuid',
    }).actorUserId).toBeNull()
  })

  it('rejects non-UUID actorUserId so system-originated commands (sync workers, scheduler) never blow up the action log driver with `invalid input syntax for type uuid`', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const systemSub = serviceWithPrivateAccess.normalizeInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
    })
    expect(systemSub.actorUserId).toBeNull()

    const realUser = serviceWithPrivateAccess.normalizeInput({
      commandId: 'customers.people.update',
      actorUserId: '11111111-1111-4111-8111-111111111111',
    })
    expect(realUser.actorUserId).toBe('11111111-1111-4111-8111-111111111111')

    const apiKey = serviceWithPrivateAccess.normalizeInput({
      commandId: 'api.something',
      actorUserId: 'api_key:22222222-2222-4222-8222-222222222222',
    })
    expect(apiKey.actorUserId).toBe('22222222-2222-4222-8222-222222222222')

    const garbage = serviceWithPrivateAccess.normalizeInput({
      commandId: 'test',
      actorUserId: 'not-a-uuid',
    })
    expect(garbage.actorUserId).toBeNull()
  })

  it('keeps the system actor identifier in the log context instead of discarding it', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const parsed = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
      tenantId: '33333333-3333-4333-8333-333333333333',
    })

    expect(parsed.actorUserId).toBeNull()
    expect(parsed.context).toEqual({ systemActor: 'system:example_customers_sync:outbound' })
    expect(parsed.tenantId).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('merges the system actor into an existing context without clobbering it', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const parsed = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'scheduler.schedules.run',
      actorUserId: 'system:scheduler',
      context: { source: 'system', scheduleId: 'schedule-1' },
    })

    expect(parsed.context).toEqual({
      source: 'system',
      scheduleId: 'schedule-1',
      systemActor: 'system:scheduler',
    })
  })

  it('leaves real user and api key actors untouched and adds no system actor context', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const realUser = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'customers.people.update',
      actorUserId: '11111111-1111-4111-8111-111111111111',
    })
    expect(realUser.actorUserId).toBe('11111111-1111-4111-8111-111111111111')
    expect(realUser.context).toBeUndefined()

    const apiKey = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'api.something',
      actorUserId: 'api_key:22222222-2222-4222-8222-222222222222',
    })
    expect(apiKey.actorUserId).toBe('22222222-2222-4222-8222-222222222222')
    expect(apiKey.context).toBeUndefined()
  })

  it('marks a system-originated entry as a system source while keeping the actor column null', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
      createLogEntity: (
        fork: { create: (_entity: unknown, payload: Record<string, unknown>) => Record<string, unknown> },
        query: Record<string, unknown>,
      ) => Record<string, unknown>
    }

    const parsed = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'example.todos.create',
      actorUserId: 'system:example_customers_sync:outbound',
    })
    const created = serviceWithPrivateAccess.createLogEntity({
      create: (_entity, payload) => payload,
    }, parsed)

    expect(created.actorUserId).toBeNull()
    expect(created.sourceKey).toBe('system')
    expect(created.contextJson).toEqual({ systemActor: 'system:example_customers_sync:outbound' })
  })

  it('keeps every actor id the create schema accepts in the uuid-backed actor column', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const schemaAcceptedActors = [
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '01900000-0000-7000-8000-000000000000',
      '44444444-4444-6444-8444-444444444444',
      '11111111-1111-4111-8111-111111111111',
    ]

    for (const actorUserId of schemaAcceptedActors) {
      const parsed = serviceWithPrivateAccess.parseCreateInput({
        commandId: 'scheduler.schedules.run',
        actorUserId,
      })

      expect(parsed.actorUserId).toBe(actorUserId)
      expect(parsed.context).toBeUndefined()
    }
  })

  it('leaves the scheduler system actor queryable so undo and redo keep resolving its entries', () => {
    const schedulerSystemActorId = '00000000-0000-0000-0000-000000000000'
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
      createLogEntity: (
        fork: { create: (_entity: unknown, payload: Record<string, unknown>) => Record<string, unknown> },
        query: Record<string, unknown>,
      ) => Record<string, unknown>
    }

    const created = serviceWithPrivateAccess.createLogEntity({
      create: (_entity, payload) => payload,
    }, serviceWithPrivateAccess.parseCreateInput({
      commandId: 'scheduler.schedules.run',
      actorUserId: schedulerSystemActorId,
    }))

    expect(created.actorUserId).toBe(schedulerSystemActorId)
    expect(created.sourceKey).toBe('ui')
    expect(created.contextJson).toBeNull()
  })

  it('drops an unrecognized actor instead of recording it as an automated principal', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
      createLogEntity: (
        fork: { create: (_entity: unknown, payload: Record<string, unknown>) => Record<string, unknown> },
        query: Record<string, unknown>,
      ) => Record<string, unknown>
    }

    for (const actorUserId of ['not-a-uuid', 'system:', 'api_key:not-a-uuid']) {
      const parsed = serviceWithPrivateAccess.parseCreateInput({
        commandId: 'example.todos.create',
        actorUserId,
      })
      const created = serviceWithPrivateAccess.createLogEntity({
        create: (_entity, payload) => payload,
      }, parsed)

      expect(created.actorUserId).toBeNull()
      expect(created.sourceKey).toBe('system')
      expect(created.contextJson).toBeNull()
    }
  })

  it('unwraps an api key actor to any uuid the create schema accepts, not only v4', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const wrappedActors = [
      '00000000-0000-0000-0000-000000000000',
      '01900000-0000-7000-8000-000000000000',
      '22222222-2222-4222-8222-222222222222',
    ]

    for (const actorUserId of wrappedActors) {
      const parsed = serviceWithPrivateAccess.parseCreateInput({
        commandId: 'api.something',
        actorUserId: `api_key:${actorUserId}`,
      })

      expect(parsed.actorUserId).toBe(actorUserId)
      expect(parsed.context).toBeUndefined()
    }
  })

  it('trims a padded actor id into the actor column rather than treating it as a system actor', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const parsed = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'customers.people.update',
      actorUserId: '  11111111-1111-4111-8111-111111111111  ',
    })

    expect(parsed.actorUserId).toBe('11111111-1111-4111-8111-111111111111')
    expect(parsed.context).toBeUndefined()
  })

  it('caps the preserved system actor identifier so a corrupted subject cannot bloat the context column', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      parseCreateInput: (input: Record<string, unknown>) => Record<string, unknown>
    }

    const parsed = serviceWithPrivateAccess.parseCreateInput({
      commandId: 'example.todos.create',
      actorUserId: `system:${'a'.repeat(600)}`,
    })

    expect(parsed.actorUserId).toBeNull()
    expect((parsed.context as Record<string, unknown>).systemActor).toBe(`system:${'a'.repeat(248)}`)
  })

  it('keeps the zod-runtime-missing fallback regex in parity with the create schema', () => {
    const candidates = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-1222-8222-222222222222',
      '33333333-3333-5333-9333-333333333333',
      '44444444-4444-6444-a444-444444444444',
      '01900000-0000-7000-8000-000000000000',
      '55555555-5555-8555-b555-555555555555',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      '66666666-6666-9666-8666-666666666666',
      '77777777-7777-4777-7777-777777777777',
      '11111111-1111-4111-8111-11111111111',
      'system:example_customers_sync:outbound',
      'not-a-uuid',
      '',
    ]

    for (const candidate of candidates) {
      expect([candidate, SCHEMA_UUID_REGEX.test(candidate)])
        .toEqual([candidate, uuid.safeParse(candidate).success])
    }
  })

  it('populates projection columns when creating a log entity', () => {
    const service = new ActionLogService(
      {} as unknown as ConstructorParameters<typeof ActionLogService>[0],
      { isEnabled: () => true } as unknown as ConstructorParameters<typeof ActionLogService>[1],
    )

    const serviceWithPrivateAccess = service as unknown as {
      createLogEntity: (
        fork: { create: (_entity: unknown, payload: Record<string, unknown>) => Record<string, unknown> },
        query: Record<string, unknown>,
      ) => Record<string, unknown>
    }

    const created = serviceWithPrivateAccess.createLogEntity({
      create: (_entity, payload) => payload,
    }, {
      actorUserId: 'user-1',
      actionLabel: 'Update company',
      changes: {
        'entity.displayName': { from: 'Acme', to: 'Copperleaf' },
      },
      commandId: 'customers.companies.update',
      context: {
        source: 'ui',
      },
      createdAt: new Date('2026-04-12T10:00:00.000Z'),
      executionState: 'done',
      organizationId: 'org-1',
      resourceId: 'company-1',
      resourceKind: 'customers.company',
      relatedResourceKind: 'customers.deal',
      relatedResourceId: 'deal-1',
      snapshotBefore: { entity: { displayName: 'Acme' } },
      tenantId: 'tenant-1',
    })

    expect(created.actionType).toBe('edit')
    expect(created.sourceKey).toBe('ui')
    expect(created.changedFields).toEqual(['entity.displayName'])
    expect(created.primaryChangedField).toBe('entity.displayName')
    expect(created.relatedResourceKind).toBe('customers.deal')
    expect(created.relatedResourceId).toBe('deal-1')
  })

  it.each([
    { encryptionEnabled: false, mode: 'unavailable' },
    { encryptionEnabled: true, mode: 'enabled' },
  ])('redacts direct service writes before persistence when encryption is $mode', async ({ encryptionEnabled }) => {
    const persisted: Record<string, unknown>[] = []
    const fork = {
      create: (_entity: unknown, payload: Record<string, unknown>) => payload,
      persist: (payload: Record<string, unknown>) => ({
        flush: async () => {
          persisted.push(payload)
        },
      }),
    }
    const service = new ActionLogService(
      { fork: () => fork } as unknown as ConstructorParameters<typeof ActionLogService>[0],
      {
        decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
        getDek: async () => null,
        isEnabled: () => encryptionEnabled,
      } as unknown as ConstructorParameters<typeof ActionLogService>[1],
    )

    await service.log({
      commandId: 'security.password.change',
      undoToken: 'undo-capability',
      commandPayload: {
        __redoInput: {
          currentPassword: 'CurrentPass1!',
          newPassword: 'NewPass2!',
        },
        safe: true,
      },
      snapshotBefore: { password: 'SnapshotPass3!', passwordHash: 'stored-verifier' },
      changes: {
        refresh_token: { from: 'old-token', to: 'new-token' },
        displayName: { from: 'Before', to: 'After' },
      },
      context: { apiSecret: 'context-secret', source: 'profile' },
    })

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toEqual(expect.objectContaining({
      undoToken: null,
      commandPayload: {
        safe: true,
        __redoUnavailable: 'sensitive-data-redacted',
      },
      snapshotBefore: {
        password: '[REDACTED]',
        passwordHash: 'stored-verifier',
      },
      changesJson: {
        refresh_token: '[REDACTED]',
        displayName: { from: 'Before', to: 'After' },
      },
      contextJson: { apiSecret: '[REDACTED]', source: 'profile' },
    }))
    expect(JSON.stringify(persisted[0])).not.toContain('CurrentPass1!')
    expect(JSON.stringify(persisted[0])).not.toContain('NewPass2!')
    expect(JSON.stringify(persisted[0])).not.toContain('SnapshotPass3!')
    expect(JSON.stringify(persisted[0])).not.toContain('old-token')
    expect(JSON.stringify(persisted[0])).not.toContain('context-secret')
  })
})

describe('ActionLogService.redactSensitiveHistory', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const createdAt = new Date('2026-08-20T10:00:00.000Z')

  function buildRow(overrides: Record<string, unknown> = {}) {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      tenant_id: tenantId,
      organization_id: organizationId,
      undo_token: 'undo-capability',
      command_payload: {
        __redoInput: { currentPassword: 'CurrentPass1!', newPassword: 'NewPass2!' },
        operation: 'password-change',
      },
      snapshot_before: { password: 'SnapshotPass3!', passwordHash: 'stored-verifier' },
      snapshot_after: null,
      changes_json: { refreshToken: { from: 'old-token', to: 'new-token' } },
      context_json: { source: 'profile', apiSecret: 'context-secret' },
      created_at: createdAt,
      ...overrides,
    }
  }

  it('supports scoped dry runs without writing or printing payload data', async () => {
    const row = buildRow()
    const execute = jest.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
    const messages: string[] = []
    const service = new ActionLogService({
      getConnection: () => ({ execute }),
    } as unknown as ConstructorParameters<typeof ActionLogService>[0])

    const result = await service.redactSensitiveHistory({
      batchSize: 25,
      dryRun: true,
      logger: (message) => messages.push(message),
      organizationId,
      tenantId,
    })

    expect(result).toEqual({ errors: 0, scanned: 1, skipped: 0, updated: 0, wouldUpdate: 1 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toContain('tenant_id = ?')
    expect(execute.mock.calls[0][0]).toContain('organization_id = ?')
    expect(execute.mock.calls[0][1]).toEqual([tenantId, organizationId, 25])
    expect(JSON.stringify(messages)).not.toContain('CurrentPass1!')
    expect(JSON.stringify(messages)).not.toContain('context-secret')
  })

  it('irreversibly redacts plaintext rows and disables undo and redo', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce([buildRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const service = new ActionLogService({
      getConnection: () => ({ execute }),
    } as unknown as ConstructorParameters<typeof ActionLogService>[0])

    const result = await service.redactSensitiveHistory()

    expect(result).toEqual({ errors: 0, scanned: 1, skipped: 0, updated: 1, wouldUpdate: 1 })
    const updateCall = execute.mock.calls[1]
    expect(updateCall[0]).toContain('undo_token = null')
    const persisted = JSON.stringify(updateCall[1])
    expect(persisted).not.toContain('CurrentPass1!')
    expect(persisted).not.toContain('NewPass2!')
    expect(persisted).not.toContain('SnapshotPass3!')
    expect(persisted).not.toContain('old-token')
    expect(persisted).not.toContain('context-secret')
    expect(persisted).toContain('[REDACTED]')
    expect(persisted).toContain('stored-verifier')
    expect(persisted).toContain('sensitive-data-redacted')
  })

  it('decrypts, redacts, and re-encrypts mapped fields before updating', async () => {
    const ciphertext = 'iv:ciphertext:tag:v1'
    const replacementCiphertext = 'nextiv:nextciphertext:nexttag:v1'
    const execute = jest.fn()
      .mockResolvedValueOnce([buildRow({ command_payload: ciphertext })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const encryptionService = {
      decryptEntityPayload: jest.fn(async () => ({
        command_payload: {
          __redoInput: { password: 'EncryptedPass1!' },
          operation: 'password-change',
        },
      })),
      encryptEntityPayload: jest.fn(async (_entityId: string, payload: Record<string, unknown>) => ({
        ...payload,
        command_payload: replacementCiphertext,
      })),
      getDek: jest.fn(async () => ({ key: Buffer.alloc(32) })),
      getEncryptedFieldNames: jest.fn(async () => ['command_payload']),
      isEnabled: () => true,
    }
    const service = new ActionLogService(
      { getConnection: () => ({ execute }) } as unknown as ConstructorParameters<typeof ActionLogService>[0],
      encryptionService as unknown as ConstructorParameters<typeof ActionLogService>[1],
    )

    const result = await service.redactSensitiveHistory()

    expect(result).toEqual({ errors: 0, scanned: 1, skipped: 0, updated: 1, wouldUpdate: 1 })
    expect(encryptionService.decryptEntityPayload).toHaveBeenCalledTimes(1)
    expect(encryptionService.encryptEntityPayload).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(encryptionService.encryptEntityPayload.mock.calls[0][1])).not.toContain('EncryptedPass1!')
    expect(execute.mock.calls[1][1][0]).toBe(JSON.stringify(replacementCiphertext))
  })

  it('leaves encrypted rows unchanged when the encryption service is unavailable', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce([buildRow({ command_payload: 'iv:ciphertext:tag:v1' })])
      .mockResolvedValueOnce([])
    const messages: string[] = []
    const service = new ActionLogService(
      { getConnection: () => ({ execute }) } as unknown as ConstructorParameters<typeof ActionLogService>[0],
      {
        getEncryptedFieldNames: async () => ['command_payload'],
        isEnabled: () => false,
      } as unknown as ConstructorParameters<typeof ActionLogService>[1],
    )

    const result = await service.redactSensitiveHistory({
      logger: (message) => messages.push(message),
    })

    expect(result).toEqual({ errors: 1, scanned: 1, skipped: 0, updated: 0, wouldUpdate: 0 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(messages.join('\n')).toContain('tenant encryption is required but unavailable')
    expect(messages.join('\n')).not.toContain('CurrentPass1!')
  })

  it('is idempotent for rows that are already sanitized', async () => {
    const execute = jest.fn()
      .mockResolvedValueOnce([buildRow({
        command_payload: { __redoUnavailable: 'sensitive-data-redacted' },
        snapshot_before: { password: '[REDACTED]', passwordHash: 'stored-verifier' },
        changes_json: { refreshToken: '[REDACTED]' },
        context_json: { apiSecret: '[REDACTED]', source: 'profile' },
        undo_token: null,
      })])
      .mockResolvedValueOnce([])
    const service = new ActionLogService({
      getConnection: () => ({ execute }),
    } as unknown as ConstructorParameters<typeof ActionLogService>[0])

    const result = await service.redactSensitiveHistory()

    expect(result).toEqual({ errors: 0, scanned: 1, skipped: 1, updated: 0, wouldUpdate: 0 })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('ActionLogService.list pagination', () => {
  function buildServiceWithSpies(items: unknown[], total: number) {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const loadEntries = jest.spyOn(service as any, 'loadEntries').mockResolvedValue(items as any)
    const count = jest.spyOn(service as any, 'count').mockResolvedValue(total)
    return { service, loadEntries, count }
  }

  it('returns pagination envelope derived from page/pageSize', async () => {
    const mockItems = [{ id: '1' }, { id: '2' }]
    const { service } = buildServiceWithSpies(mockItems, 42)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      page: 3,
      pageSize: 10,
    })

    expect(result.items).toBe(mockItems)
    expect(result.total).toBe(42)
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(10)
    expect(result.totalPages).toBe(5)
  })

  it('defaults to page=1 pageSize=50 when not provided', async () => {
    const { service } = buildServiceWithSpies([], 0)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
    expect(result.totalPages).toBe(1)
    expect(result.total).toBe(0)
  })

  it('computes totalPages correctly for partial last page', async () => {
    const { service } = buildServiceWithSpies([], 101)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      pageSize: 25,
    })

    expect(result.totalPages).toBe(5)
  })

  it('returns totalPages=1 when total is 0', async () => {
    const { service } = buildServiceWithSpies([], 0)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.totalPages).toBe(1)
  })
})

describe('ActionLogService.claimForUndo / releaseUndoClaim (TOCTOU guard)', () => {
  function buildServiceWithNativeUpdate(affected: number) {
    const nativeUpdate = jest.fn(async () => affected)
    const fakeEm = { nativeUpdate }
    const service = new ActionLogService(
      fakeEm as unknown as ConstructorParameters<typeof ActionLogService>[0],
    )
    return { service, nativeUpdate }
  }

  it('claimForUndo issues a compare-and-set guarded on the done state', async () => {
    const { service, nativeUpdate } = buildServiceWithNativeUpdate(1)

    const claimed = await service.claimForUndo('log-1')

    expect(claimed).toBe(true)
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
    const [, filter, update] = nativeUpdate.mock.calls[0]
    expect(filter).toMatchObject({ id: 'log-1', executionState: 'done', deletedAt: null })
    expect(update).toEqual({ executionState: 'undoing' })
  })

  it('claimForUndo returns false when the row was already claimed (0 rows affected)', async () => {
    const { service } = buildServiceWithNativeUpdate(0)

    expect(await service.claimForUndo('log-1')).toBe(false)
  })

  it('releaseUndoClaim reverts an undoing row back to done', async () => {
    const { service, nativeUpdate } = buildServiceWithNativeUpdate(1)

    const released = await service.releaseUndoClaim('log-1')

    expect(released).toBe(true)
    const [, filter, update] = nativeUpdate.mock.calls[0]
    expect(filter).toMatchObject({ id: 'log-1', executionState: 'undoing', deletedAt: null })
    expect(update).toEqual({ executionState: 'done' })
  })
})
