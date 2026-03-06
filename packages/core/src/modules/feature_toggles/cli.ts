import { cliLogger } from '@open-mercato/cli/lib/helpers'
const logger = cliLogger.forModule('core')
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
const logger = cliLogger.forModule('core')
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { FeatureToggle } from './data/entities'
const logger = cliLogger.forModule('core')
import type { EntityManager } from '@mikro-orm/postgresql'
import fs from 'node:fs'
const logger = cliLogger.forModule('core')
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const logger = cliLogger.forModule('core')
import { toggleCreateSchemaList } from './data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
const logger = cliLogger.forModule('core')

type ParsedArgs = Record<string, string | boolean>
const logger = cliLogger.forModule('core')

// ESM equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = cliLogger.forModule('core')
const defaultFilePath = path.resolve(__dirname, 'defaults.json')

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (!rawKey) continue
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
      continue
    }
    args[rawKey] = true
  }
  return args
}

function stringOption(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function booleanOption(args: ParsedArgs, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = args[key]
    if (raw === undefined) continue
    if (raw === true) return true
    if (raw === false) return false
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return true
      const parsed = parseBooleanToken(trimmed)
      if (parsed !== null) return parsed
    }
  }
  return undefined
}

function parseValue(type: string, value: string | undefined): any {
  if (value === undefined) return undefined

  switch (type) {
    case 'boolean':
      if (value === 'true' || value === '1') return true
      if (value === 'false' || value === '0') return false
      return Boolean(value)
    case 'number':
      const num = Number(value)
      if (isNaN(num)) throw new Error(`Invalid number value: ${value}`)
      return num
    case 'json':
      try {
        return JSON.parse(value)
      } catch (e) {
        throw new Error(`Invalid JSON value: ${value}`)
      }
    case 'string':
    default:
      return value
  }
}

function buildCommandContext(container: Awaited<ReturnType<typeof createRequestContainer>>): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    request: undefined as any,
  }
}

const createToggle: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'toggle-create',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier', 'id')
    const name = stringOption(args, 'name')

    if (!identifier || !name) {
      logger.error('Usage: mercato feature_toggles toggle-create --identifier <id> --name <name> [--type boolean|string|number|json] [--defaultValue <value>] [--category <value>] [--description <value>]')
      return
    }

    const type = stringOption(args, 'type') || 'boolean'
    const defaultValueRaw = stringOption(args, 'defaultValue')
    const category = stringOption(args, 'category')
    const description = stringOption(args, 'description')


    let defaultValue: any = undefined
    try {
      defaultValue = parseValue(type, defaultValueRaw)
    } catch (e: any) {
      logger.error(e.message)
      return
    }

    const container = await createRequestContainer()
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      const { result } = await commandBus.execute('feature_toggles.global.create', {
        input: {
          identifier,
          name,
          type,
          defaultValue: defaultValue,
          category: category ?? null,
          description: description ?? null,

        },
        ctx,
      })
      logger.info('✅ Feature toggle created:', "Identifier: " + identifier)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const updateToggle: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'toggle-update',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')

    if (!identifier) {
      logger.error('Usage: mercato feature_toggles toggle-update --identifier <id> [--name <name>] [--defaultValue <value>] [--category <value>] [--description <value>]')
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      logger.error('Feature toggle not found:', identifier)
      return
    }

    const name = stringOption(args, 'name')
    const defaultValueRaw = stringOption(args, 'defaultValue')
    const category = stringOption(args, 'category')
    const description = stringOption(args, 'description')


    let defaultValue: any = undefined
    if (defaultValueRaw !== undefined) {
      try {
        defaultValue = parseValue(toggle.type, defaultValueRaw)
      } catch (e: any) {
        logger.error(e.message)
        return
      }
    }

    const toggleId = toggle.id
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      await commandBus.execute('feature_toggles.global.update', {
        input: {
          ...(toggleId ? { id: toggleId } : {}),
          ...(identifier ? { identifier } : {}),
          ...(name ? { name } : {}),
          ...(defaultValue !== undefined ? { defaultValue } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(description !== undefined ? { description } : {}),

        },
        ctx,
      })
      logger.info('✅ Feature toggle updated:', "Identifier: " + identifier)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const deleteToggle: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'toggle-delete',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')
    if (!identifier) {
      logger.error('Usage: mercato feature_toggles toggle-delete --identifier <id>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      logger.error('Feature toggle not found:', identifier)
      return
    }
    const toggleId = toggle.id
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      await commandBus.execute('feature_toggles.global.delete', {
        input: {
          ...(toggleId ? { id: toggleId } : {}),
          ...(identifier ? { identifier } : {}),
        },
        ctx,
      })
      logger.info('✅ Feature toggle deleted:', identifier ?? toggleId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const setOverrideValue: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'override-set-value',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')
    const tenantId = stringOption(args, 'tenantId', 'tenant', 'tenantId')
    const valueRaw = stringOption(args, 'value')

    if (!identifier || !tenantId) {
      logger.error('Usage: mercato feature_toggles override-set-value --identifier <id> --tenantId <uuid> --value <value>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      logger.error('Feature toggle not found:', identifier)
      return
    }

    let value: any = undefined
    if (valueRaw !== undefined) {
      try {
        value = parseValue(toggle.type, valueRaw)
      } catch (e: any) {
        logger.error(e.message)
        return
      }
    }

    const toggleId = toggle.id

    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      await commandBus.execute('feature_toggles.overrides.changeState', {
        input: {
          toggleId,
          tenantId,
          isOverride: true,
          overrideValue: value,
        },
        ctx,
      })
      logger.info('✅ Feature toggle override updated:', identifier, "Tenant ID: " + tenantId, "Value: " + (valueRaw || 'unchanged'))
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedDefaults: ModuleCli = {
const logger = cliLogger.forModule('core')
  command: 'seed-defaults',
  async run(rest) {
    const args = parseArgs(rest)
    const filePathFromArgs = stringOption(args, 'filePath')
    const filePath = filePathFromArgs ?? defaultFilePath
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsedJson = JSON.parse(raw)
    const data = Array.isArray(parsedJson) ? parsedJson : parsedJson.toggles

    // We can't strictly use toggleCreateSchemaList because it might validate types strictly, 
    // but the input JSON from file might have raw values that need refinement if we were going via CLI args.
    // However, since we are reading from JSON, we can assume the types match what zod expects for the literal types.
    // Let's rely on the schema to validate the structure.
    const toggles = toggleCreateSchemaList.parse(data)

    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as CommandBus
    const em = container.resolve('em') as EntityManager
    const ctx = buildCommandContext(container)
    let created = 0
    let skipped = 0

    for (const toggle of toggles) {
      const existing = await em.findOne(FeatureToggle, { identifier: toggle.identifier, deletedAt: null })
      if (existing) {
        skipped += 1
        continue
      }
      await commandBus.execute('feature_toggles.global.create', {
        input: {
          identifier: toggle.identifier,
          name: toggle.name,
          description: toggle.description ?? null,
          category: toggle.category ?? null,

          type: toggle.type,
          defaultValue: toggle.defaultValue,
        },
        ctx,
      })
      created += 1
      logger.info(`✅ Created feature toggle ${toggle.identifier}`)
    }
    logger.info(`✅ Feature toggle defaults seeded (created: ${created}, skipped: ${skipped})`)
  },
}

export default [createToggle, updateToggle, deleteToggle, setOverrideValue, seedDefaults]
