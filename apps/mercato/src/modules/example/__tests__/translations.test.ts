import fs from 'node:fs'
import path from 'node:path'
import { buildInjectionTable } from '@open-mercato/core/modules/translations/widgets/injection-table'
import translatableFields from '../translations'
import extensionPoints from '../extension-points'

const moduleRoot = path.join(__dirname, '..')

function readModuleSource(relativePath: string): string {
  return fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8')
}

function todoEntityClassBody(): string {
  const source = readModuleSource('data/entities.ts')
  const start = source.indexOf('export class Todo {')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/**
 * The entity id the Todo CrudForm really renders under, taken from the declared extension
 * host the form consumes. Reading it from the declaration rather than regex-matching a
 * literal in the component keeps this test honest about the module's actual binding: the
 * call site derives its prop FROM the host, so there is no literal left to match.
 * `CrudForm` normalizes `example:todo` to `example.todo` when it builds the spot id.
 */
function crudFormEntityId(): string {
  return (extensionPoints.hosts.todoForm as { entityId: string }).entityId
}

describe('example translations.ts', () => {
  it('declares translatable fields for the module-owned Todo entity only', () => {
    expect(Object.keys(translatableFields)).toEqual(['example:todo'])
    expect(translatableFields['example:todo']).toEqual(['title'])
  })

  it('names only columns the Todo entity actually declares', () => {
    const body = todoEntityClassBody()
    for (const field of translatableFields['example:todo']) {
      expect(body).toMatch(new RegExp(`\\n\\s+${field}!?\\??:`))
    }
  })

  it('keys the entity type so the Translation Manager lands on the live Todo CrudForm spot', () => {
    // The translations module derives its injection table from exactly this registry shape,
    // so a mistyped key here silently produces a header spot no form ever renders.
    const table = buildInjectionTable(translatableFields)
    const formEntityId = crudFormEntityId()

    expect(formEntityId).toBe('example.todo')
    expect(table[`crud-form:${formEntityId}:header`]).toBe('translations.injection.translation-manager')
  })
})
