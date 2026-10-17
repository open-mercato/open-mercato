import { isCausationEnabled, runEntryWithCausation } from '@open-mercato/shared/lib/causation/server'

export function buildCliCausationRef(moduleId: string, commandName: string): string {
  return `cli:${moduleId}:${commandName}`
}

export function runCliCommandWithCausation<T>(moduleId: string, commandName: string, run: () => T): T {
  if (!isCausationEnabled()) return run()
  return runEntryWithCausation({ kind: 'system', ref: buildCliCausationRef(moduleId, commandName) }, run)
}
