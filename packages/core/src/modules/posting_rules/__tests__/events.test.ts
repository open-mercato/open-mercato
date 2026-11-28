// Every CRUD event the module's commands and routes emit
// (`<events.module>.<events.entity>.<action>`) must be declared in
// events.ts, and nothing else is declared.
import { readFileSync, readdirSync } from 'node:fs'

function sourcesIn(relativeDir: string, fileFilter: (name: string) => boolean): string[] {
  const dirUrl = new URL(relativeDir, import.meta.url)
  return readdirSync(dirUrl, { recursive: true, encoding: 'utf8' })
    .filter((name) => fileFilter(name) && !name.includes('__tests__'))
    .map((name) => readFileSync(new URL(name, dirUrl), 'utf8'))
}

function emittedEventIds(): string[] {
  const ids = new Set<string>()
  const commandSources = sourcesIn('../commands/', (name) => name.endsWith('.ts'))
  for (const source of commandSources) {
    const config = source.match(/CrudEventsConfig<[^>]+>\s*=\s*\{[^}]*module:\s*'([^']+)',\s*entity:\s*'([^']+)'/)
    if (!config) continue
    for (const action of source.matchAll(/action:\s*'(created|updated|deleted)'/g)) {
      ids.add(`${config[1]}.${config[2]}.${action[1]}`)
    }
  }
  const routeSources = sourcesIn('../api/', (name) => name.endsWith('route.ts'))
  for (const source of routeSources) {
    const config = source.match(/events:\s*\{\s*module:\s*'([^']+)',\s*entity:\s*'([^']+)'/)
    if (!config) continue
    for (const action of ['create', 'update', 'delete'] as const) {
      if (new RegExp(`\\b${action}:\\s*\\{`).test(source)) ids.add(`${config[1]}.${config[2]}.${action}d`)
    }
  }
  return [...ids].sort()
}

describe('posting_rules events', () => {
  it('declares exactly the CRUD events the module emits', async () => {
    const { eventsConfig } = await import('../events')
    const declared = eventsConfig.events.map((event) => event.id).sort()
    const emitted = emittedEventIds()
    expect(emitted).toHaveLength(6)
    expect(declared).toEqual(emitted)
  })
})
