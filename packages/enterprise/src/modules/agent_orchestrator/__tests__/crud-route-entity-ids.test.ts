import fs from 'node:fs'
import path from 'node:path'
import { MetadataStorage } from '@mikro-orm/core'
import * as agentOrchestratorEntities from '../data/entities'

/**
 * A CRUD list route's `ENTITY_TYPE` is resolved to a database table by the query
 * engine. An id that names no registered entity makes the engine derive a table
 * that does not exist, so every list request fails with a 500. Guard every
 * `ENTITY_TYPE` declared under `api/` against the module's registered entities.
 */

const MODULE_ID = 'agent_orchestrator'
const API_DIR = path.resolve(__dirname, '../api')
const ENTITY_TYPE_PATTERN = /const ENTITY_TYPE = '([^']+)'/

function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/(?:^_+|_+$)/g, '')
    .toLowerCase()
}

function collectRegisteredEntityIds(): Set<string> {
  void agentOrchestratorEntities
  const ids = new Set<string>()
  for (const meta of Object.values(MetadataStorage.getMetadata()) as Array<{ className?: string }>) {
    if (meta.className) ids.add(`${MODULE_ID}:${toSnake(meta.className)}`)
  }
  return ids
}

function collectRouteEntityTypes(directory: string): Array<{ file: string; entityType: string }> {
  const found: Array<{ file: string; entityType: string }> = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...collectRouteEntityTypes(fullPath))
      continue
    }
    if (entry.name !== 'route.ts') continue
    const match = fs.readFileSync(fullPath, 'utf8').match(ENTITY_TYPE_PATTERN)
    if (match) found.push({ file: path.relative(API_DIR, fullPath), entityType: match[1] })
  }
  return found
}

describe('agent_orchestrator CRUD route entity ids', () => {
  const registered = collectRegisteredEntityIds()
  const routes = collectRouteEntityTypes(API_DIR)

  it('finds the CRUD list routes', () => {
    expect(routes.map((route) => route.file)).toEqual(
      expect.arrayContaining([
        path.join('guardrail-checks', 'route.ts'),
        path.join('context-bundles', 'route.ts'),
        path.join('runs', 'route.ts'),
      ]),
    )
  })

  it('names a registered entity in every ENTITY_TYPE', () => {
    const unknown = routes.filter((route) => !registered.has(route.entityType))
    expect(unknown).toEqual([])
  })
})
