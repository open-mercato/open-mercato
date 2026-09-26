import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { ZatcaInvoiceChainScope, ZatcaInvoiceChainState, ZatcaInvoiceChainStore } from './chain'
import { ZatcaInvoiceChainError } from './chain'
import { isZatcaInvoiceHash } from './hash'

/**
 * The invoice chain, persisted through the platform's `module_configs` store.
 *
 * The chain is two numbers per taxpayer — a counter and a hash — so it does not
 * deserve an entity, a migration and a repository of its own; the config store is
 * already tenant- and organization-scoped, versioned and cached.
 *
 * Failure mode that matters: a stored value that cannot be read as a chain must
 * **throw**, never fall back to "no chain yet". Reading a corrupt chain as an empty
 * one would hand out counter 1 and the chain-start hash again, quietly forking the
 * invoice history that ZATCA validates against. Failing closed stops the invoice.
 */

export const ZATCA_CHAIN_MODULE_ID = 'saudi_localization'
export const ZATCA_CHAIN_KEY = 'zatca_chain'

type StoredChain = {
  icv?: unknown
  lastInvoiceHash?: unknown
}

function parseStoredChain(value: unknown): ZatcaInvoiceChainState | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') {
    throw new ZatcaInvoiceChainError('invalid_chain', 'The stored ZATCA invoice chain is not an object.')
  }
  const stored = value as StoredChain
  const icv = stored.icv
  if (typeof icv !== 'number' || !Number.isInteger(icv) || icv < 0) {
    throw new ZatcaInvoiceChainError('invalid_chain', 'The stored ZATCA invoice chain has no usable counter value.')
  }
  const lastInvoiceHash = stored.lastInvoiceHash
  if (lastInvoiceHash !== null && lastInvoiceHash !== undefined && !isZatcaInvoiceHash(lastInvoiceHash)) {
    throw new ZatcaInvoiceChainError('invalid_chain', 'The stored ZATCA invoice chain has a malformed hash.')
  }
  return { icv, lastInvoiceHash: (lastInvoiceHash as string | null | undefined) ?? null }
}

export function createModuleConfigZatcaInvoiceChainStore(
  configService: ModuleConfigService,
): ZatcaInvoiceChainStore {
  return {
    async read(scope: ZatcaInvoiceChainScope) {
      const record = await configService.getRecord(ZATCA_CHAIN_MODULE_ID, ZATCA_CHAIN_KEY, scope)
      if (!record) return null
      return parseStoredChain(record.value)
    },
    async write(scope: ZatcaInvoiceChainScope, state: ZatcaInvoiceChainState) {
      await configService.setValue(ZATCA_CHAIN_MODULE_ID, ZATCA_CHAIN_KEY, state, scope)
    },
  }
}
