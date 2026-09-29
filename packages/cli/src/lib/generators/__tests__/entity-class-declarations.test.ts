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
      import { Entity } from '@mikro-orm/decorators/legacy'

      export class InvoiceBuilder {}

      @Entity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('ignores entity classes that are not exported', () => {
    const filePath = writeSource(`
      import { Entity } from '@mikro-orm/decorators/legacy'

      @Entity({ tableName: 'invoices' })
      class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('handles a local export list', () => {
    const filePath = writeSource(`
      import { Entity } from '@mikro-orm/decorators/legacy'

      @Entity({ tableName: 'invoices' })
      class Invoice {}

      export { Invoice }
    `)

    expect(parseEntityClassNames(filePath)).toEqual(['Invoice'])
  })

  it('accepts a bare @Entity decorator', () => {
    const filePath = writeSource(`
      import { Entity } from '@mikro-orm/decorators/legacy'

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

  it('ignores an Entity decorator imported from an unrelated library', () => {
    // Any library may export an `Entity` decorator; only MikroORM's collides in the ORM
    // metadata registry, so only a decorator bound to a @mikro-orm/* import counts.
    const filePath = writeSource(`
      import { Entity } from 'some-other-orm'

      @Entity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('ignores a namespace-qualified Entity decorator from an unrelated library', () => {
    const filePath = writeSource(`
      import * as other from 'some-other-orm'

      @other.Entity({ tableName: 'invoices' })
      export class Invoice {}
    `)

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('ignores an Entity decorator with no import to bind it', () => {
    const filePath = writeSource(`
      @Entity({ tableName: 'invoices' })
      export class Invoice {}
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

describe('parseEntityClassNames on compiled package output', () => {
  // A package that ships dist only hands the generator its built entity file, where a
  // decorated class has become a class expression plus a decorator-helper call. Without
  // this the standalone generator sees no entities at all and misses every collision.
  it('reads an esbuild ESM emit', () => {
    const filePath = writeSource(`
      var __decorateClass = (decorators, target) => target;
      import { Entity, PrimaryKey } from "@mikro-orm/decorators/legacy";
      let ApiKey = class {
      };
      __decorateClass([
        PrimaryKey({ type: "uuid" })
      ], ApiKey.prototype, "id", 2);
      ApiKey = __decorateClass([
        Entity({ tableName: "api_keys" })
      ], ApiKey);
      export {
        ApiKey
      };
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual(['ApiKey'])
  })

  it('reads a tsc CommonJS emit', () => {
    const filePath = writeSource(`
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ApiKey = void 0;
      const legacy_1 = require("@mikro-orm/decorators/legacy");
      let ApiKey = class ApiKey {
      };
      ApiKey = __decorate([
        (0, legacy_1.Entity)({ tableName: "api_keys" })
      ], ApiKey);
      exports.ApiKey = ApiKey;
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual(['ApiKey'])
  })

  it('reads a bundler export table', () => {
    const filePath = writeSource(`
      import { Entity } from "@mikro-orm/core";
      var entities_exports = {};
      __export(entities_exports, {
        ApiKey: () => ApiKey
      });
      let ApiKey = class {
      };
      ApiKey = __decorateClass([
        Entity({ tableName: "api_keys" })
      ], ApiKey);
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual(['ApiKey'])
  })

  it('ignores a compiled class that is never exported', () => {
    const filePath = writeSource(`
      import { Entity } from "@mikro-orm/decorators/legacy";
      let Internal = class {
      };
      Internal = __decorateClass([
        Entity({ tableName: "internal" })
      ], Internal);
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('ignores a compiled class decorated by an unrelated library', () => {
    const filePath = writeSource(`
      import { Entity } from "some-other-orm";
      let Invoice = class {
      };
      Invoice = __decorateClass([
        Entity({ tableName: "invoices" })
      ], Invoice);
      export {
        Invoice
      };
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual([])
  })

  it('ignores property decorators, which share the helper call', () => {
    const filePath = writeSource(`
      import { Entity, Property } from "@mikro-orm/decorators/legacy";
      let Helper = class {
      };
      __decorateClass([
        Property({ type: "text" })
      ], Helper.prototype, "name", 2);
      export {
        Helper
      };
    `, 'entities.js')

    expect(parseEntityClassNames(filePath)).toEqual([])
  })
})
