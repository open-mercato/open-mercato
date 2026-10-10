import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { FreightContract, FreightContractRoute, FreightTripAbstract } from '../data/entities'
import {
  contractActionSchema,
  createContractRouteSchema,
  createContractSchema,
  updateContractRouteSchema,
  updateContractSchema,
} from '../data/validators'
import { registerCrudCommands, resolveScope, type CrudCommandConfig } from './crud'
import {
  FREIGHT_CONTRACT_ENTITY_ID,
  FREIGHT_CONTRACT_ROUTE_ENTITY_ID,
  freightContractEvents,
  freightContractIndexer,
  freightContractRouteEvents,
  freightContractRouteIndexer,
} from './entities'
import { raiseFreightError } from '../lib/errors'
import { readFreightSettings, type FreightScope } from '../lib/freightSettings'
import { allocateDocumentNumber } from '../lib/documentNumber'
import { emitFreightEvent } from '../events'

const OPEN_ABSTRACT_STATUSES = ['draft', 'submitted', 'disputed'] as const

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value
  const parsed = new Date(`${String(value)}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function loadSettings(ctx: CommandRuntimeContext, scope: FreightScope) {
  const configService = ctx.container.resolve('moduleConfigService') as ModuleConfigService
  return readFreightSettings(configService, scope)
}

async function findContractForUpdate(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: FreightScope,
  id: string,
): Promise<FreightContract> {
  const contract = await em.findOne(
    FreightContract,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
  if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: FREIGHT_CONTRACT_ENTITY_ID,
    resourceId: contract.id,
    current: contract.updatedAt,
    request: ctx.request ?? null,
  })
  return contract
}

export async function assertContractWritable(em: EntityManager, contract: FreightContract): Promise<void> {
  if (contract.status === 'terminated') {
    return raiseFreightError(409, 'contract_not_writable', 'A terminated contract cannot be changed.')
  }
}

const contractCrudConfig: CrudCommandConfig<FreightContract> = {
  entity: FreightContract,
  entityId: FREIGHT_CONTRACT_ENTITY_ID,
  resource: 'contracts',
  createSchema: createContractSchema,
  updateSchema: updateContractSchema,
  toCreateData: async (input, ctx) => {
    const scope = resolveScope(ctx)
    const settings = await loadSettings(ctx, scope)
    const em = entityManager(ctx)
    const contractNumber = await allocateDocumentNumber(em, scope, 'contract', settings)
    return {
      contractNumber,
      status: 'draft',
      customerId: String(input.customerId),
      customerSnapshot: input.customerSnapshot as Record<string, unknown>,
      title: String(input.title),
      validFrom: toDate(input.validFrom),
      validTo: toDate(input.validTo),
      billingCycle: (input.billingCycle as FreightContract['billingCycle']) ?? settings.defaultBillingCycle,
      paymentTermsDays: input.paymentTermsDays === undefined ? settings.defaultPaymentTermsDays : Number(input.paymentTermsDays),
      currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : 'SAR',
      vatRate: input.vatRate === undefined ? String(settings.defaultVatRate * 100) : String(input.vatRate),
      requiresCustomerApproval:
        input.requiresCustomerApproval === undefined
          ? settings.defaultRequiresCustomerApproval
          : Boolean(input.requiresCustomerApproval),
      salesChannelId: (input.salesChannelId as string | null | undefined) ?? settings.salesChannelId,
      signedAt: input.signedAt ? new Date(String(input.signedAt)) : null,
      notes: (input.notes as string | null | undefined) ?? null,
    }
  },
  toUpdateData: (input) =>
    compact({
      customerId: input.customerId === undefined ? undefined : String(input.customerId),
      customerSnapshot: input.customerSnapshot,
      title: input.title === undefined ? undefined : String(input.title),
      validFrom: toDate(input.validFrom),
      validTo: toDate(input.validTo),
      billingCycle: input.billingCycle,
      paymentTermsDays: input.paymentTermsDays === undefined ? undefined : Number(input.paymentTermsDays),
      currencyCode: input.currencyCode,
      vatRate: input.vatRate === undefined ? undefined : String(input.vatRate),
      requiresCustomerApproval: input.requiresCustomerApproval,
      salesChannelId: input.salesChannelId,
      signedAt: input.signedAt ? new Date(String(input.signedAt)) : undefined,
      notes: input.notes,
    }),
  events: freightContractEvents,
  indexer: freightContractIndexer,
  beforeUpdate: async (_input, current) => {
    const contract = current as FreightContract
    if (contract.status === 'terminated') {
      return raiseFreightError(409, 'contract_not_writable', 'A terminated contract cannot be changed.')
    }
  },
  beforeDelete: async (current) => {
    const contract = current as FreightContract
    if (contract.status !== 'draft') {
      return raiseFreightError(409, 'contract_not_deletable', 'Only draft contracts can be deleted.')
    }
  },
}

registerCrudCommands(contractCrudConfig)

const contractRouteCrudConfig: CrudCommandConfig<FreightContractRoute> = {
  entity: FreightContractRoute,
  entityId: FREIGHT_CONTRACT_ROUTE_ENTITY_ID,
  resource: 'contract-routes',
  createSchema: createContractRouteSchema,
  updateSchema: updateContractRouteSchema,
  toCreateData: async (input, ctx) => {
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const contractId = String(input.contractId)
    const contract = await em.findOne(FreightContract, {
      id: contractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
    if (contract.status !== 'draft' && contract.status !== 'active') {
      return raiseFreightError(409, 'contract_not_writable', 'A terminated contract cannot be changed.')
    }

    let lineNumber = input.lineNumber === undefined ? null : Number(input.lineNumber)
    if (lineNumber === null) {
      const rows = await em.getConnection().execute<{ next: string | number | null }[]>(
        `select coalesce(max(line_number), 0) + 1 as next from freight_contract_routes
         where tenant_id = ? and organization_id = ? and contract_id = ? and deleted_at is null`,
        [scope.tenantId, scope.organizationId, contractId],
      )
      lineNumber = Number(rows[0]?.next ?? 1)
    } else {
      const duplicate = await em.findOne(FreightContractRoute, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contract: contractId,
        lineNumber,
        deletedAt: null,
      })
      if (duplicate) return raiseFreightError(409, 'rate_line_number_taken', 'This rate line number is already used on the contract.')
    }

    return {
      contract,
      lineNumber,
      transportRouteId: (input.transportRouteId as string | null | undefined) ?? null,
      routeCodeSnapshot: (input.routeCodeSnapshot as string | null | undefined) ?? null,
      origin: String(input.origin),
      destination: String(input.destination),
      rateBasis: (input.rateBasis as FreightContractRoute['rateBasis']) ?? 'per_trip',
      rateAmount: String(input.rateAmount),
      minimumCharge: (input.minimumCharge as string | null | undefined) ?? null,
      currencyCode: typeof input.currencyCode === 'string' ? input.currencyCode : contract.currencyCode,
      includesTolls: Boolean(input.includesTolls ?? false),
      includesWaiting: Boolean(input.includesWaiting ?? false),
      freeWaitingMinutes: input.freeWaitingMinutes === undefined || input.freeWaitingMinutes === null ? null : Number(input.freeWaitingMinutes),
      waitingRatePerHour: (input.waitingRatePerHour as string | null | undefined) ?? null,
      vehicleTypeId: (input.vehicleTypeId as string | null | undefined) ?? null,
      equipmentType: (input.equipmentType as string | null | undefined) ?? null,
      driverIncentiveType: (input.driverIncentiveType as FreightContractRoute['driverIncentiveType']) ?? 'none',
      driverIncentiveValue: (input.driverIncentiveValue as string | null | undefined) ?? null,
      vatRateOverride: (input.vatRateOverride as string | null | undefined) ?? null,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      effectiveFrom: toDate(input.effectiveFrom),
      effectiveTo: toDate(input.effectiveTo),
      position: input.position === undefined ? 0 : Number(input.position),
    }
  },
  toUpdateData: (input) =>
    compact({
      lineNumber: input.lineNumber === undefined ? undefined : Number(input.lineNumber),
      transportRouteId: input.transportRouteId,
      routeCodeSnapshot: input.routeCodeSnapshot,
      origin: input.origin === undefined ? undefined : String(input.origin),
      destination: input.destination === undefined ? undefined : String(input.destination),
      rateBasis: input.rateBasis,
      rateAmount: input.rateAmount === undefined ? undefined : String(input.rateAmount),
      minimumCharge: input.minimumCharge,
      currencyCode: input.currencyCode,
      includesTolls: input.includesTolls,
      includesWaiting: input.includesWaiting,
      freeWaitingMinutes: input.freeWaitingMinutes,
      waitingRatePerHour: input.waitingRatePerHour,
      vehicleTypeId: input.vehicleTypeId,
      equipmentType: input.equipmentType,
      driverIncentiveType: input.driverIncentiveType,
      driverIncentiveValue: input.driverIncentiveValue,
      vatRateOverride: input.vatRateOverride,
      isActive: input.isActive,
      effectiveFrom: toDate(input.effectiveFrom),
      effectiveTo: toDate(input.effectiveTo),
      position: input.position,
    }),
  events: freightContractRouteEvents,
  indexer: freightContractRouteIndexer,
  beforeUpdate: async (_input, current, scope, ctx) => {
    const route = current as FreightContractRoute
    const em = entityManager(ctx)
    const contractId = typeof route.contract === 'string' ? route.contract : route.contract.id
    const contract = await em.findOne(FreightContract, {
      id: contractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
    if (contract.status !== 'draft' && contract.status !== 'active') {
      return raiseFreightError(409, 'contract_not_writable', 'A terminated contract cannot be changed.')
    }
  },
  beforeDelete: async (current, scope, ctx) => {
    const route = current as FreightContractRoute
    const em = entityManager(ctx)
    const contractId = typeof route.contract === 'string' ? route.contract : route.contract.id
    const contract = await em.findOne(FreightContract, {
      id: contractId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!contract) return raiseFreightError(404, 'contract_not_found', 'Freight contract not found.')
    if (contract.status !== 'draft' && contract.status !== 'active') {
      return raiseFreightError(409, 'contract_not_writable', 'A terminated contract cannot be changed.')
    }
  },
}

registerCrudCommands(contractRouteCrudConfig)

async function emitContractUpdate(
  ctx: CommandRuntimeContext,
  contract: FreightContract,
  scope: FreightScope,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: contract,
    identifiers: { id: contract.id, ...scope },
    actorUserId: ctx.auth?.sub ?? null,
    events: freightContractEvents,
    indexer: freightContractIndexer,
  })
}

async function emitContractLifecycle(
  eventId: Parameters<typeof emitFreightEvent>[0],
  contract: FreightContract,
  scope: FreightScope,
): Promise<void> {
  await emitFreightEvent(eventId, {
    id: contract.id,
    contractNumber: contract.contractNumber,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

function registerContractAction(
  action: string,
  eventId: Parameters<typeof emitFreightEvent>[0],
  guard: (em: EntityManager, scope: FreightScope, contract: FreightContract) => Promise<void>,
  apply: (contract: FreightContract) => void,
): void {
  const command: CommandHandler<{ id: string }, { contractId: string }> = {
    id: `freight_operations.contracts.${action}`,
    async execute(rawInput, ctx) {
      const input = contractActionSchema.parse(rawInput)
      const scope = resolveScope(ctx)
      const em = entityManager(ctx)
      const contract = await em.transactional(async (tx) => {
        const locked = await findContractForUpdate(ctx, tx, scope, input.id)
        await guard(tx, scope, locked)
        apply(locked)
        locked.updatedAt = new Date()
        await tx.persist(locked).flush()
        return locked
      })
      await emitContractUpdate(ctx, contract, scope)
      await emitContractLifecycle(eventId, contract, scope)
      return { contractId: contract.id }
    },
    buildLog: ({ input, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `${action} freight contract`,
        resourceKind: FREIGHT_CONTRACT_ENTITY_ID,
        resourceId: input.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }
  registerCommand(command)
}

registerContractAction(
  'activate',
  'freight_operations.contract.activated',
  async (em, scope, contract) => {
    if (contract.status !== 'draft') return raiseFreightError(409, 'contract_not_draft', 'Only draft contracts can be activated.')
    const activeLines = await em.count(FreightContractRoute, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      contract: contract.id,
      isActive: true,
      deletedAt: null,
    })
    if (activeLines === 0) {
      return raiseFreightError(409, 'contract_no_active_rates', 'Add at least one active rate line before activating the contract.')
    }
  },
  (contract) => {
    contract.status = 'active'
  },
)

registerContractAction(
  'suspend',
  'freight_operations.contract.suspended',
  async (_em, _scope, contract) => {
    if (contract.status !== 'active') return raiseFreightError(409, 'contract_not_active', 'Only active contracts can be suspended.')
  },
  (contract) => {
    contract.status = 'suspended'
  },
)

registerContractAction(
  'resume',
  'freight_operations.contract.resumed',
  async (_em, _scope, contract) => {
    if (contract.status !== 'suspended') return raiseFreightError(409, 'contract_not_suspended', 'Only suspended contracts can be resumed.')
  },
  (contract) => {
    contract.status = 'active'
  },
)

registerContractAction(
  'terminate',
  'freight_operations.contract.terminated',
  async (em, scope, contract) => {
    if (contract.status === 'terminated') {
      return raiseFreightError(409, 'contract_already_terminated', 'The contract is already terminated.')
    }
    const openAbstracts = await em.count(FreightTripAbstract, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      contractId: contract.id,
      status: { $in: [...OPEN_ABSTRACT_STATUSES] },
      deletedAt: null,
    })
    if (openAbstracts > 0) {
      return raiseFreightError(409, 'contract_has_open_abstract', 'The contract has an abstract awaiting customer review.')
    }
  },
  (contract) => {
    contract.status = 'terminated'
  },
)
