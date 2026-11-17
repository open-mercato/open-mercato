import 'reflect-metadata'
import fs from 'node:fs'
import path from 'node:path'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import pl from '../i18n/pl.json'

const registeredHandlers: Array<CommandHandler<unknown, unknown>> = []

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (handler: CommandHandler<unknown, unknown>) => {
    registeredHandlers.push(handler)
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) =>
      (pl as Record<string, string>)[key] ?? fallback ?? key,
  }),
}))

jest.mock('../events', () => ({
  emitFormsEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../events-payloads', () => ({
  formsEventPayloadSchemas: {},
}))

import '../commands/form'
import '../commands/form-version'
import '../commands/distribution'
import '../commands/invitation'
import '../commands/submission'

const commandsDir = path.join(__dirname, '..', 'commands')
const i18nDir = path.join(__dirname, '..', 'i18n')
const locales = fs.readdirSync(i18nDir).filter((file) => file.endsWith('.json'))

function collectActionLabelKeys(): string[] {
  const keys: string[] = []
  for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(commandsDir, file), 'utf8')
    for (const match of source.matchAll(/actionLabel:\s*translate\(\s*'([^']+)'/g)) {
      keys.push(match[1])
    }
  }
  return keys
}

describe('forms command audit action labels (#7087)', () => {
  it('never stores a raw string literal as an action label', () => {
    for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(commandsDir, file), 'utf8')
      expect({ file, rawLabels: source.match(/actionLabel:\s*['"`]/g) ?? [] }).toEqual({ file, rawLabels: [] })
    }
  })

  it('defines every action label key in every locale file', () => {
    const keys = collectActionLabelKeys()
    expect(keys.length).toBeGreaterThanOrEqual(20)
    for (const locale of locales) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(i18nDir, locale), 'utf8')) as Record<string, string>
      const missing = keys.filter((key) => !dictionary[key] || dictionary[key] === key)
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })

  it('resolves the action label to translated text when building the audit log', async () => {
    const handlersWithLog = registeredHandlers.filter((handler) => typeof handler.buildLog === 'function')
    expect(handlersWithLog.length).toBeGreaterThanOrEqual(20)
    for (const handler of handlersWithLog) {
      const log = await handler.buildLog!({
        input: { tenantId: 't', organizationId: 'o' },
        result: { invitations: [] },
        snapshots: {},
        ctx: {},
      } as never)
      expect(`${handler.id}: ${log?.actionLabel}`).not.toMatch(/: forms\./)
    }
    const createForm = registeredHandlers.find((handler) => handler.id === 'forms.form.create')
    const createLog = await createForm!.buildLog!({ input: {}, result: {}, snapshots: {}, ctx: {} } as never)
    expect(createLog?.actionLabel).toBe('Utwórz formularz')
  })
})
