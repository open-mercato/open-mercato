import type { ModuleCli } from '@/modules/registry'
import type { EntityManager } from '@mikro-orm/core'
import { createRequestContainer } from '@/lib/di/container'
import { RateFetchingService } from './services/rateFetchingService'
import { NBPProvider } from './services/providers/nbp'
import { RaiffeisenPolandProvider } from './services/providers/raiffeisen'
import { Currency, CurrencyFetchConfig } from './data/entities'

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      const key = arg.slice(2)

      if (arg.includes('=')) {
        const [k, v] = arg.slice(2).split('=')
        result[k] = v
      } else {
        const nextArg = args[i + 1]
        if (nextArg && !nextArg.startsWith('--')) {
          result[key] = nextArg
          i++
        } else {
          result[key] = true
        }
      }
    }
  }

  return result
}

const fetchRatesCommand: ModuleCli = {
  command: 'fetch-rates',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? '')

    if (!tenantId || !organizationId) {
      console.error(
        'Usage: mercato currencies fetch-rates --tenant <id> --org <id> [options]'
      )
      console.error('Options:')
      console.error('  --date YYYY-MM-DD       Fetch for specific date (default: today)')
      console.error('  --from YYYY-MM-DD       Start date for range')
      console.error('  --to YYYY-MM-DD         End date for range')
      console.error('  --provider NAME         Specific provider (default: all enabled)')
      return
    }

    const container = await createRequestContainer()

    try {
      const em = container.resolve<EntityManager>('em')
      const fetchService = new RateFetchingService(em)

      // Register providers
      fetchService.registerProvider(new NBPProvider())
      fetchService.registerProvider(new RaiffeisenPolandProvider())

      const dateStr = String(args.date || '')
      const fromStr = String(args.from || '')
      const toStr = String(args.to || '')
      const providerArg = args.provider ? String(args.provider) : null

      let dates: Date[] = []

      if (fromStr && toStr) {
        // Date range
        const from = new Date(fromStr)
        const to = new Date(toStr)
        const current = new Date(from)

        while (current <= to) {
          dates.push(new Date(current))
          current.setDate(current.getDate() + 1)
        }

        console.log(
          `📅 Fetching rates for date range: ${fromStr} to ${toStr} (${dates.length} days)`
        )
      } else if (dateStr) {
        dates = [new Date(dateStr)]
        console.log(`📅 Fetching rates for: ${dateStr}`)
      } else {
        dates = [new Date()]
        console.log(`📅 Fetching rates for today`)
      }

      const providers = providerArg
        ? providerArg.split(',').map((p) => p.trim())
        : undefined

      let totalFetched = 0
      const allErrors: string[] = []

      for (const date of dates) {
        const dateStr = date.toISOString().split('T')[0]
        console.log(`\n🔄 Fetching for ${dateStr}...`)

        const result = await fetchService.fetchRatesForDate(
          date,
          { tenantId, organizationId },
          { providers }
        )

        totalFetched += result.totalFetched

        console.log(`  ✅ Fetched ${result.totalFetched} rates`)

        for (const [provider, data] of Object.entries(result.byProvider)) {
          console.log(`    ${provider}: ${data.count} rates`)
          if (data.errors?.length) {
            data.errors.forEach((err) => console.log(`      ⚠️  ${err}`))
          }
        }

        if (result.errors.length > 0) {
          result.errors.forEach((err) => console.log(`  ❌ ${err}`))
          allErrors.push(...result.errors)
        }
      }

      console.log(`\n✨ Complete! Total rates fetched: ${totalFetched}`)

      if (allErrors.length > 0) {
        console.log(`⚠️  Encountered ${allErrors.length} error(s)`)
      }
    } catch (err: any) {
      console.error('❌ Error:', err.message)
      process.exit(1)
    } finally {
      await (container as any).dispose?.()
    }
  },
}

const listProvidersCommand: ModuleCli = {
  command: 'list-providers',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? '')

    console.log('📋 Available Currency Rate Providers:\n')
    console.log('  • NBP (National Bank of Poland)')
    console.log('    - ~13 currencies with bid/ask rates')
    console.log('    - Table C: Buy/Sell rates')
    console.log('')
    console.log('  • Raiffeisen Bank Polska')
    console.log('    - 4 major currencies (EUR, USD, CHF, GBP)')
    console.log('    - Intraday rates with buy/sell spreads')

    if (tenantId && organizationId) {
      const container = await createRequestContainer()

      try {
        const em = container.resolve<EntityManager>('em')

        const configs = await em.find(CurrencyFetchConfig, {
          tenantId,
          organizationId,
        })

        if (configs.length > 0) {
          console.log('\n📊 Configuration Status:')

          for (const config of configs) {
            const status = config.isEnabled ? '✅ Enabled' : '⭕ Disabled'
            const lastSync = config.lastSyncAt
              ? new Date(config.lastSyncAt).toISOString()
              : 'Never'

            console.log(`\n  ${config.provider}: ${status}`)
            console.log(`    Last Sync: ${lastSync}`)
            if (config.lastSyncCount !== null) {
              console.log(`    Last Count: ${config.lastSyncCount} rates`)
            }
            if (config.syncTime) {
              console.log(`    Scheduled: Daily at ${config.syncTime}`)
            }
          }
        }
      } finally {
        await (container as any).dispose?.()
      }
    }
  },
}

const SEED_CURRENCIES = [
  {
    code: "USD",
    name: "US Dollar",
    decimalPlaces: 2,
    symbol: "$",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: true,
    isActive: true,
  },
  {
    code: "EUR",
    name: "Euro",
    decimalPlaces: 2,
    symbol: "€",
    decimalSeparator: ',',
    thousandsSeparator: ".",
    isBase: false,
    isActive: true,
  },
  {
    code: "JPY",
    name: "Japanese Yen",
    decimalPlaces: 0,
    symbol: "¥",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "GBP",
    name: "British Pound",
    decimalPlaces: 2,
    symbol: "£",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "CHF",
    name: "Swiss Franc",
    decimalPlaces: 2,
    symbol: "Fr",
    decimalSeparator: '.',
    thousandsSeparator: "'",
    isBase: false,
    isActive: true,
  },
  {
    code: "CAD",
    name: "Canadian Dollar",
    decimalPlaces: 2,
    symbol: "C$",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "AUD",
    name: "Australian Dollar",
    decimalPlaces: 2,
    symbol: "A$",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "CNY",
    name: "Chinese Yuan",
    decimalPlaces: 2,
    symbol: "¥",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "CNH",
    name: "Chinese Yuan (Offshore)",
    decimalPlaces: 2,
    symbol: "¥",
    decimalSeparator: '.',
    thousandsSeparator: ",",
    isBase: false,
    isActive: true,
  },
  {
    code: "PLN",
    name: "Polish Zloty",
    decimalPlaces: 2,
    symbol: "zł",
    decimalSeparator: ',',
    thousandsSeparator: " ",
    isBase: false,
    isActive: true,
  },
]

const seed: ModuleCli = {
  command: 'seed',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato currencies seed --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)

    const existingEntries = await em.find(Currency, {
      tenantId,
      organizationId,
    })
    const existingMap = new Map<string, Currency>()
    existingEntries.forEach((entry) => existingMap.set(entry.code, entry))

    const seeded = await em.transactional(async (tem) => {
      for (const curr of SEED_CURRENCIES) {
        const current = existingMap.get(curr.code)
        if (current) {
          if (current.name !== curr.name) {
            current.name = curr.name
            current.updatedAt = new Date()
            em.persist(current)
          }
          continue
        }
        const entry = em.create(Currency, {
          tenantId,
          organizationId,
          ...curr,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(entry)
      }

      return true
    })

    if (seeded) {
      console.log('Currencies seeded for organization', organizationId)
    } else {
      console.log('Currencies already present; skipping')
    }
  },
}

export default [seed, fetchRatesCommand, listProvidersCommand]
