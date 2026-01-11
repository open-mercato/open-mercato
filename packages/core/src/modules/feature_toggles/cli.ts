import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { FeatureToggle } from './data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import fs from 'node:fs'
import path from 'node:path'
import { toggleCreateSchemaList } from './data/validators'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

type ParsedArgs = Record<string, string | boolean>

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
  command: 'toggle-create',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier', 'id')
    const name = stringOption(args, 'name')
    if (!identifier || !name) {
      console.error('Usage: mercato feature_toggles toggle-create --identifier <id> --name <name> [--defaultState true|false] [--category <value>] [--description <value>] [--failMode fail_open|fail_closed]')
      return
    }
    const defaultState = booleanOption(args, 'defaultState')
    const category = stringOption(args, 'category')
    const description = stringOption(args, 'description')
    const failMode = stringOption(args, 'failMode')
    const container = await createRequestContainer()
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      const { result } = await commandBus.execute('feature_toggles.global.create', {
        input: {
          identifier,
          name,
          defaultState: defaultState ?? false,
          category: category ?? null,
          description: description ?? null,
          failMode: failMode ?? undefined,
        },
        ctx,
      })
      console.log('✅ Feature toggle created:', "Identifier: " + identifier)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const updateToggle: ModuleCli = {
  command: 'toggle-update',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')

    if (!identifier) {
      console.error('Usage: mercato feature_toggles toggle-update --identifier <id> [--name <name>] [--defaultState true|false] [--category <value>] [--description <value>] [--failMode fail_open|fail_closed]')
      return
    }
    const name = stringOption(args, 'name')
    const defaultState = booleanOption(args, 'defaultState')
    const category = stringOption(args, 'category')
    const description = stringOption(args, 'description')
    const failMode = stringOption(args, 'failMode')
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      console.error('Feature toggle not found:', identifier)
      return
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
          ...(defaultState !== undefined ? { defaultState } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(failMode !== undefined ? { failMode } : {}),
        },
        ctx,
      })
      console.log('✅ Feature toggle updated:', "Identifier: " + identifier)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const deleteToggle: ModuleCli = {
  command: 'toggle-delete',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')
    if (!identifier) {
      console.error('Usage: mercato feature_toggles toggle-delete --identifier <id>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      console.error('Feature toggle not found:', identifier)
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
      console.log('✅ Feature toggle deleted:', identifier ?? toggleId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const setOverrideState: ModuleCli = {
  command: 'override-set',
  async run(rest) {
    const args = parseArgs(rest)
    const identifier = stringOption(args, 'identifier')
    const tenantId = stringOption(args, 'tenantId', 'tenant', 'tenantId')
    const state = stringOption(args, 'state', 'enabled', 'disabled', 'inherit')
    if (!identifier || !tenantId || !state) {
      console.error('Usage: mercato feature_toggles override-set --identifier <id> --tenantId <uuid> --state enabled|disabled|inherit')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const toggle = await em.findOne(FeatureToggle, { identifier })
    if (!toggle) {
      console.error('Feature toggle not found:', identifier)
      return
    }
    const toggleId = toggle.id
    try {
      const commandBus = container.resolve('commandBus') as CommandBus
      const ctx = buildCommandContext(container)
      await commandBus.execute('feature_toggles.overrides.changeState', {
        input: {
          toggleId,
          tenantId,
          state,
        },
        ctx,
      })
      console.log('✅ Feature toggle override updated:', identifier, "Tenant ID: " + tenantId, "State: " + state)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedDefaults: ModuleCli = {
  command: 'seed-defaults',
  async run(rest) {
    const args = parseArgs(rest)
    const filePathFromArgs = stringOption(args, 'filePath')
    const filePath = filePathFromArgs ?? defaultFilePath
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsedJson = JSON.parse(raw)
    const data = Array.isArray(parsedJson) ? parsedJson : parsedJson.toggles
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
          defaultState: toggle.defaultState ?? false,
          failMode: toggle.failMode ?? undefined,
        },
        ctx,
      })
      created += 1
      console.log(`✅ Created feature toggle ${toggle.identifier}`)
    }
    console.log(`✅ Feature toggle defaults seeded (created: ${created}, skipped: ${skipped})`)
  },
}

export default [createToggle, updateToggle, deleteToggle, setOverrideState, seedDefaults]
