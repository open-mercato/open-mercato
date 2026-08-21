import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEntityClassNames } from '../entity-class-declarations'

let tmpDir: string

function writeSource(content: string, fileName = 'entities.ts'): string {
  const filePath = path.join(tmpDir, fileName)
  fs.writeFileSync(filePath, content)
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-class-declarations-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('parseEntityClassNames', () => {
  it('collects exported classes decorated with @Entity()', () => {
    const filePath = writeSource(`
      import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'

      @Entity({ tableName: 'invoices' })
      export class Invoice {
        @PrimaryKey({ type: 'uuid' })
        id!: string
      }
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('looks past comments and stacked decorators', () => {
    const filePath = writeSource(`
      import { Entity, Index, Unique } from '@mikro-orm/decorators/legacy'

      @Entity({ tableName: 'invoices' })
      // The unique constraint bounds the lookup.
      @Unique({ properties: ['number'] })
      @Index({
        name: 'invoices_number_idx',
        expression: 'create index "invoices_number_idx" on "invoices" ("number")',
      })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('ignores exported classes that are not entities', () => {
    const filePath = writeSource(`
      export class InvoiceBuilder {}

      @Entity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('ignores entity classes that are not exported', () => {
    const filePath = writeSource(`
      @Entity({ tableName: 'invoices' })
      class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('handles a local export list', () => {
    const filePath = writeSource(`
      @Entity({ tableName: 'invoices' })
      class Invoice {}

      export { Invoice }
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('accepts a bare @Entity decorator', () => {
    const filePath = writeSource(`
      @Entity
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('returns nothing for an unreadable file instead of throwing', () => {
    expect(parseEntityClassNames(path.join(tmpDir, 'missing.ts'))).toEqual([])
  })

  it('recognises an aliased Entity import', () => {
    const filePath = writeSource(`
      import { Entity as OrmEntity } from '@mikro-orm/decorators/legacy'

      @OrmEntity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('recognises a namespace-qualified Entity decorator', () => {
    const filePath = writeSource(`
      import * as orm from '@mikro-orm/decorators/legacy'

      @orm.Entity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('does not treat an unrelated decorator as an entity', () => {
    const filePath = writeSource(`
      @Injectable()
      export class InvoiceService {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('parses a .tsx entity file as JSX rather than dropping declarations', () => {
    // MODULE_CODE_EXTENSIONS accepts .tsx, where `<T>` is JSX, not a type assertion.
    const filePath = writeSource(`
      import { Entity } from '@mikro-orm/decorators/legacy'

      export const icon = () => <span>invoice</span>

      @Entity({ tableName: 'invoices' })
      export class Invoice {}
    `, 'entities.tsx')

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })
})
