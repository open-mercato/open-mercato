import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { FiscalPeriod } from '../ledger/data/entities'
import { Currency } from '../currencies/data/entities'

/**
 * Developer tooling. `ledger` has no HTTP route or UI that posts a journal
 * entry in Phase 1 (`postJournalEntry` is called programmatically only), so
 * in a local demo nothing ever triggers the reclassification engine. This
 * command posts one balanced cost entry (DR a zespół 4 account / CR a
 * counter account) through `ledger.postJournalEntry`, exactly as a
 * downstream module would, so the engine's subscriber can be watched
 * mirroring it into zespół 5.
 *
 *   yarn mercato posting_rules dev-post-cost-entry \
 *     --tenant <id> --org <id> --cost-account <id> --counter-account <id> \
 *     [--amount 100.00] [--date YYYY-MM-DD] [--currency <id>] [--description "..."]
 *
 * Refuses to run when NODE_ENV is "production".
 */

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    if (arg.includes('=')) {
      const [key, ...value] = arg.slice(2).split('=')
      result[key] = value.join('=')
      continue
    }
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      result[key] = next
      i++
    } else {
      result[key] = true
    }
  }
  return result
}

function usage() {
  console.error(
    'Usage: mercato posting_rules dev-post-cost-entry --tenant <id> --org <id> --cost-account <id> --counter-account <id>\n' +
      '  [--amount 100.00] [--date YYYY-MM-DD] [--currency <id>] [--description "..."]\n' +
      '  cost-account    a zespół 4 ledger account (debited)\n' +
      '  counter-account any other ledger account (credited), e.g. a liability or bank account\n' +
      '  currency        defaults to the organization\'s base currency',
  )
}

function monthBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return { start, end }
}

const devPostCostEntry: ModuleCli = {
  command: 'dev-post-cost-entry',
  async run(rest) {
    if (process.env.NODE_ENV === 'production') {
      console.error('dev-post-cost-entry is developer tooling and refuses to run with NODE_ENV=production.')
      return
    }
    const args = parseArgs(rest)
    const tenantId = String(args.tenant ?? args.tenantId ?? '')
    const organizationId = String(args.org ?? args.organizationId ?? '')
    const costAccountId = String(args['cost-account'] ?? '')
    const counterAccountId = String(args['counter-account'] ?? '')
    if (!tenantId || !organizationId || !costAccountId || !counterAccountId) {
      usage()
      return
    }
    const amount = String(args.amount ?? '100.00')
    if (!/^\d+(\.\d{1,4})?$/.test(amount) || Number(amount) <= 0) {
      console.error(`--amount must be a positive decimal with at most 4 decimal places, got "${amount}".`)
      return
    }
    const dateArg = String(args.date ?? new Date().toISOString().slice(0, 10))
    const operationDate = new Date(`${dateArg}T00:00:00.000Z`)
    if (Number.isNaN(operationDate.getTime())) {
      console.error(`--date must be YYYY-MM-DD, got "${dateArg}".`)
      return
    }
    const description = String(args.description ?? 'Dev: cost entry to exercise the posting rules engine')

    const container = await createRequestContainer()
    try {
      const em = (container.resolve('em') as EntityManager).fork()
      const commandBus = container.resolve('commandBus') as CommandBus

      // Same shape the engine itself uses for system-triggered writes
      // (lib/reclassify.ts `buildCommandRuntimeContext`).
      const ctx = {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
        systemActor: true,
      } as never

      let currencyId = typeof args.currency === 'string' ? args.currency : ''
      if (!currencyId) {
        const base = await em.findOne(Currency, { tenantId, organizationId, isBase: true, deletedAt: null })
        if (!base) {
          console.error('No base currency found for this organization; pass --currency <id>.')
          return
        }
        currencyId = base.id
      }

      // postJournalEntry rejects a date no unlocked fiscal period covers.
      const covering = await em.findOne(FiscalPeriod, {
        tenantId,
        organizationId,
        deletedAt: null,
        startDate: { $lte: operationDate },
        endDate: { $gte: operationDate },
      })
      if (!covering) {
        const { start, end } = monthBounds(operationDate)
        console.log(`No fiscal period covers ${dateArg}; creating ${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}.`)
        await commandBus.execute('ledger.createFiscalPeriod', {
          input: { organizationId, tenantId, startDate: start, endDate: end },
          ctx,
        })
      } else if (covering.isLocked) {
        console.error(`The fiscal period covering ${dateArg} is locked; pick another --date or unlock it.`)
        return
      }

      const executed = await commandBus.execute<unknown, { journalEntryId: string; sequenceNumber: number }>(
        'ledger.postJournalEntry',
        {
          input: {
            organizationId,
            tenantId,
            operationDate,
            documentType: 'DEV',
            documentNumber: `DEV/${Date.now()}`,
            documentDate: operationDate,
            description,
            currencyId,
            lines: [
              { accountId: costAccountId, debit: amount },
              { accountId: counterAccountId, credit: amount },
            ],
          },
          ctx,
        },
      )
      console.log(
        `Posted journal entry ${executed.result.journalEntryId} (#${executed.result.sequenceNumber}): ` +
          `DR ${costAccountId} / CR ${counterAccountId} ${amount}. ` +
          'If posting_rules settings and a rule/sentinel cost centre exist, the engine mirrors it into zespół 5 shortly after.',
      )
    } catch (err) {
      console.error('dev-post-cost-entry failed:', err instanceof Error ? err.message : err)
      const body = (err as { body?: unknown })?.body
      if (body) console.error(JSON.stringify(body))
      process.exitCode = 1
    } finally {
      await (container as any).dispose?.()
    }
  },
}

export default [devPostCostEntry]
