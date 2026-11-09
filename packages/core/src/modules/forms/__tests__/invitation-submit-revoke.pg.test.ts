/**
 * Submit vs revoke race for form invitations (#7230) against a real PostgreSQL.
 *
 * The public submit route finalizes the submission and then calls
 * `DistributionService.markInvitationSubmitted`, while staff can revoke the same
 * invitation at any moment through `forms.invitation.revoke`. A revoke that
 * lands in between must win: the invitation ends `revoked`, never `submitted`.
 * As in the request, the entity manager handed to the service has already
 * loaded the invitation before the revoke commits.
 *
 * Gated on OM_FORMS_PG_URL — a throwaway database, since the suite drops and
 * recreates the `forms_invitation` table. Never point it at a development or
 * shared database. Run it with, for example:
 *
 *   docker run -d --rm --name om-forms-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54373:5432 postgres:18-alpine
 *   OM_FORMS_PG_URL=postgres://postgres:postgres@127.0.0.1:54373/om \
 *     yarn workspace @open-mercato/core jest invitation-submit-revoke.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { FormInvitation } from '../data/entities'
import { revokeInvitationCommand } from '../commands/invitation'
import { DistributionService } from '../services/distribution-service'

const PG_URL = process.env.OM_FORMS_PG_URL ?? ''
const ROUNDS = Number(process.env.OM_FORMS_RACE_ROUNDS ?? '200')
const PARALLEL = Number(process.env.OM_FORMS_RACE_PARALLEL ?? '8')
const maybe = PG_URL ? describe : describe.skip

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

type Deferred = { promise: Promise<void>; resolve: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function withGatedFlush(em: EntityManager, beforeFlush: () => Promise<void>): EntityManager {
  return new Proxy(em, {
    get(target, property, receiver) {
      if (property === 'flush') {
        return async () => {
          await beforeFlush()
          return target.flush()
        }
      }
      if (property === 'transactional') {
        return (callback: (trx: EntityManager) => Promise<unknown>, options?: unknown) =>
          target.transactional((trx) => callback(withGatedFlush(trx as EntityManager, beforeFlush)), options as never)
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

maybe('form invitation submit vs revoke against PostgreSQL (#7230)', () => {
  jest.setTimeout(300_000)
  let orm: MikroORM
  const submittedEvents: string[] = []

  beforeAll(async () => {
    orm = await MikroORM.init({
      clientUrl: PG_URL,
      entities: [FormInvitation],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: PARALLEL * 3 + 2 },
    })
    await orm.schema.refresh()
    setGlobalEventBus({ emit: async () => undefined })
  }, 60_000)

  afterAll(async () => {
    await orm?.close(true)
  })

  beforeEach(() => {
    submittedEvents.length = 0
  })

  async function seedInvitation(): Promise<string> {
    const em = orm.em.fork()
    const now = new Date()
    const invitation = em.create(FormInvitation, {
      distributionId: randomUUID(),
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      recipientEmail: null,
      recipientName: null,
      recipientRef: null,
      role: null,
      tokenHash: null,
      status: 'started',
      submissionId: randomUUID(),
      locale: null,
      sendCount: 0,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(invitation)
    await em.flush()
    return invitation.id
  }

  function buildService(emFactory: () => EntityManager): DistributionService {
    return new DistributionService({
      emFactory,
      submissionService: {} as never,
      emitEvent: async (eventId, payload) => {
        if (eventId === 'forms.invitation.submitted') {
          submittedEvents.push((payload as { invitationId: string }).invitationId)
        }
      },
    })
  }

  function markSubmitted(service: DistributionService, invitationId: string): Promise<void> {
    return service.markInvitationSubmitted({
      invitationId,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      submissionId: randomUUID(),
    })
  }

  function revoke(invitationId: string): Promise<unknown> {
    const ctx = {
      container: {
        resolve: () => orm.em.fork(),
        hasRegistration: () => false,
      },
      auth: { sub: randomUUID(), tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
      organizationScope: null,
      selectedOrganizationId: ORG_ID,
    }
    return revokeInvitationCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, invitationId },
      ctx as never,
    )
  }

  async function preloadedEm(invitationId: string): Promise<EntityManager> {
    const em = orm.em.fork()
    await em.findOneOrFail(FormInvitation, { id: invitationId })
    return em
  }

  async function readStatus(invitationId: string): Promise<{ status: string; submittedAt: Date | null }> {
    const row = await orm.em.fork().findOneOrFail(FormInvitation, { id: invitationId })
    return { status: row.status, submittedAt: row.submittedAt ?? null }
  }

  it('a revoke that commits while submit is between its read and its write still wins', async () => {
    const invitationId = await seedInvitation()
    const requestEm = await preloadedEm(invitationId)
    const writeReached = deferred()
    const releaseWrite = deferred()
    const service = buildService(() =>
      withGatedFlush(requestEm, async () => {
        writeReached.resolve()
        await releaseWrite.promise
      }),
    )

    const marking = markSubmitted(service, invitationId)
    await writeReached.promise
    let revokeSettled = false
    const revoking = revoke(invitationId).finally(() => {
      revokeSettled = true
    })
    await Promise.race([revoking, delay(500)])
    const revokeFinishedBeforeSubmitWrite = revokeSettled
    releaseWrite.resolve()
    await Promise.all([marking, revoking])

    const final = await readStatus(invitationId)
    console.info(
      `[forms race] interleaved: revokeFinishedBeforeSubmitWrite=${revokeFinishedBeforeSubmitWrite} final=${final.status} submittedEvents=${submittedEvents.length}`,
    )
    expect(final.status).toBe('revoked')
  })

  it('a submit that runs after a committed revoke leaves the invitation revoked and emits nothing', async () => {
    const invitationId = await seedInvitation()
    const requestEm = await preloadedEm(invitationId)
    await revoke(invitationId)

    await markSubmitted(buildService(() => requestEm), invitationId)

    const final = await readStatus(invitationId)
    expect(final).toEqual({ status: 'revoked', submittedAt: null })
    expect(submittedEvents).toEqual([])
  })

  it(`never ends submitted when submit and revoke race (${ROUNDS} rounds x ${PARALLEL})`, async () => {
    let resurrected = 0
    let total = 0
    for (let round = 0; round < ROUNDS; round += 1) {
      const ids = await Promise.all(Array.from({ length: PARALLEL }, () => seedInvitation()))
      await Promise.all(
        ids.map(async (invitationId) => {
          const requestEm = await preloadedEm(invitationId)
          const service = buildService(() => requestEm)
          const submitFirst = Math.random() < 0.5
          const jitter = Math.floor(Math.random() * 4)
          const first = submitFirst ? () => markSubmitted(service, invitationId) : () => revoke(invitationId)
          const second = submitFirst ? () => revoke(invitationId) : () => markSubmitted(service, invitationId)
          await Promise.all([first(), delay(jitter).then(second)])
        }),
      )
      for (const invitationId of ids) {
        total += 1
        const final = await readStatus(invitationId)
        if (final.status !== 'revoked') resurrected += 1
      }
    }
    console.info(`[forms race] stress: resurrected=${resurrected}/${total}`)
    expect(resurrected).toBe(0)
  })
})
