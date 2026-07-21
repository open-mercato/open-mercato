import fs from 'node:fs'
import path from 'node:path'
import { VariableDeclarationKind } from 'ts-morph'
import ts from 'typescript-js'
import type { GeneratorExtension } from '../extension'
import { resolveStandaloneSourceMirrorBase, scanModuleDir, SCAN_CONFIGS, type ModuleRoots } from '../scanner'
import {
  arrayLiteral,
  arrowFunction,
  identifier,
  methodCall,
  nullishCoalesce,
  objectLiteral,
  propertyAccess,
  writeValue,
} from '../ast'
import { dynamicImportExpression, emptyObject, namespaceFallback, namespaceImportSpec, renderGeneratedTsSource } from './shared'

type InjectionWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  importPath: string
  widgetId?: string
}

type InjectionTableEntry = {
  moduleId: string
  importName: string
  importPath: string
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function getPropertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text
  }
  return null
}

function collectObjectDeclarations(sourceFile: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const declarations = new Map<string, ts.ObjectLiteralExpression>()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isObjectLiteralExpression(initializer)) {
        declarations.set(declaration.name.text, initializer)
      }
    }
  }
  return declarations
}

function resolveObjectExpression(
  expression: ts.Expression,
  declarations: Map<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (ts.isIdentifier(unwrapped)) return declarations.get(unwrapped.text) ?? null
  return null
}

function getObjectPropertyExpression(object: ts.ObjectLiteralExpression, propertyName: string): ts.Expression | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (getPropertyNameText(property.name) === propertyName) return property.initializer
  }
  return null
}

function getStringPropertyValue(object: ts.ObjectLiteralExpression, propertyName: string): string | null {
  const expression = getObjectPropertyExpression(object, propertyName)
  if (!expression) return null
  const unwrapped = unwrapExpression(expression)
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text
  return null
}

function extractMetadataId(object: ts.ObjectLiteralExpression): string | null {
  const metadata = getObjectPropertyExpression(object, 'metadata')
  if (!metadata) return null
  const unwrapped = unwrapExpression(metadata)
  if (!ts.isObjectLiteralExpression(unwrapped)) return null
  return getStringPropertyValue(unwrapped, 'id')
}

function extractWidgetMetadataId(absolutePath: string): string | null {
  try {
    const source = fs.readFileSync(absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true)
    const declarations = collectObjectDeclarations(sourceFile)

    for (const statement of sourceFile.statements) {
      if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue
      const object = resolveObjectExpression(statement.expression, declarations)
      if (!object) continue
      const id = extractMetadataId(object)
      if (id) return id
    }

    for (const object of declarations.values()) {
      const id = extractMetadataId(object)
      if (id) return id
    }
  } catch {
    return null
  }
  return null
}

function collectWidgetIdsFromTableValue(
  value: ts.Expression,
  declarations: Map<string, ts.ObjectLiteralExpression>,
  ids: Set<string>,
) {
  const expression = unwrapExpression(value)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    ids.add(expression.text)
    return
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isExpression(element)) collectWidgetIdsFromTableValue(element, declarations, ids)
    }
    return
  }
  const object = resolveObjectExpression(expression, declarations)
  if (!object) return
  const widgetId = getStringPropertyValue(object, 'widgetId')
  if (widgetId) ids.add(widgetId)
}

function extractInjectionTableWidgetIds(absolutePath: string): string[] {
  try {
    const source = fs.readFileSync(absolutePath, 'utf8')
    const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true)
    const declarations = collectObjectDeclarations(sourceFile)
    let tableObject: ts.ObjectLiteralExpression | null = null

    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'injectionTable' || !declaration.initializer) {
            continue
          }
          tableObject = resolveObjectExpression(declaration.initializer, declarations)
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        tableObject ??= resolveObjectExpression(statement.expression, declarations)
      }
    }

    if (!tableObject) return []
    const ids = new Set<string>()
    for (const property of tableObject.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      collectWidgetIdsFromTableValue(property.initializer, declarations, ids)
    }
    return Array.from(ids)
  } catch {
    return []
  }
}

function resolveScannedWidgetPath(roots: ModuleRoots, fromApp: boolean, relPath: string): string {
  const base = fromApp ? roots.appBase : (resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase)
  return path.join(base, 'widgets', 'injection', ...relPath.split('/'))
}

export function createInjectionWidgetsExtension(): GeneratorExtension {
  const widgetEntries = new Map<string, InjectionWidgetEntry>()
  const tableEntries: InjectionTableEntry[] = []

  return {
    id: 'registry.injection-widgets',
    outputFiles: ['injection-widgets.generated.ts', 'injection-tables.generated.ts'],
    scanModule(ctx) {
      const files = scanModuleDir(ctx.roots, SCAN_CONFIGS.injectionWidgets)
      const moduleWidgetEntries: InjectionWidgetEntry[] = []
      for (const { relPath, fromApp } of files) {
        const segments = relPath.split('/')
        const file = segments.pop() ?? ''
        const base = file.replace(/\.(t|j)sx?$/, '')
        const importPath = ctx.sanitizeGeneratedModuleSpecifier(
          `${fromApp ? ctx.imps.appBase : ctx.imps.pkgBase}/widgets/injection/${[...segments, base].join('/')}`
        )
        const key = [ctx.moduleId, ...segments, base].filter(Boolean).join(':')
        const entry: InjectionWidgetEntry = {
          moduleId: ctx.moduleId,
          key,
          source: fromApp ? 'app' : 'package',
          importPath,
          widgetId: extractWidgetMetadataId(resolveScannedWidgetPath(ctx.roots, fromApp, relPath)) ?? undefined,
        }
        moduleWidgetEntries.push(entry)
      }

      const table = ctx.resolveModuleFile(ctx.roots, ctx.imps, 'widgets/injection-table.ts')
      const tableWidgetIds = table ? extractInjectionTableWidgetIds(table.absolutePath) : []
      if (moduleWidgetEntries.length === 1 && tableWidgetIds.length === 1 && !moduleWidgetEntries[0].widgetId) {
        moduleWidgetEntries[0].widgetId = tableWidgetIds[0]
      }

      for (const entry of moduleWidgetEntries) {
        const existing = widgetEntries.get(entry.key)
        if (!existing || (existing.source !== 'app' && entry.source === 'app')) {
          widgetEntries.set(entry.key, entry)
        }
      }

      if (table) {
        tableEntries.push({
          moduleId: ctx.moduleId,
          importName: `InjTable_${ctx.moduleId.replace(/[^a-zA-Z0-9_]/g, '_')}_${ctx.importIdRef.value++}`,
          importPath: ctx.sanitizeGeneratedModuleSpecifier(table.importPath),
        })
      }
    },
    generateOutput() {
      const widgetDecls = Array.from(widgetEntries.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, entry]) =>
          objectLiteral([
            { name: 'moduleId', value: entry.moduleId },
            { name: 'key', value: entry.key },
            { name: 'source', value: entry.source },
            ...(entry.widgetId ? [{ name: 'widgetId', value: entry.widgetId }] : []),
            {
              name: 'loader',
              value: arrowFunction({
                body: methodCall(dynamicImportExpression(entry.importPath), 'then', [
                  arrowFunction({
                    parameters: ['mod'],
                    body: nullishCoalesce([
                      propertyAccess(identifier('mod'), 'default'),
                      identifier('mod'),
                    ]),
                  }),
                ]),
              }),
            },
          ]),
        )

      const widgetsOutput = renderGeneratedTsSource({
        fileName: 'injection-widgets.generated.ts',
        imports: [
          { namedImports: [{ name: 'ModuleInjectionWidgetEntry', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/registry' },
        ],
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'injectionWidgetEntries',
                type: 'ModuleInjectionWidgetEntry[]',
                initializer: arrayLiteral(widgetDecls, writeValue),
              },
            ],
          })
        },
      })

      const tableImports = tableEntries.map((entry) => namespaceImportSpec(entry.importName, entry.importPath))
      const tableDecls = tableEntries.map((entry) =>
        objectLiteral([
          { name: 'moduleId', value: entry.moduleId },
          {
            name: 'table',
            value: namespaceFallback({
              importName: entry.importName,
              members: ['default', 'injectionTable'],
              fallback: emptyObject(),
              castType: 'ModuleInjectionTable',
            }),
          },
        ]),
      )
      const tablesOutput = renderGeneratedTsSource({
        fileName: 'injection-tables.generated.ts',
        imports: [
          { namedImports: [{ name: 'ModuleInjectionTable', isTypeOnly: true }], moduleSpecifier: '@open-mercato/shared/modules/widgets/injection' },
          ...tableImports,
        ],
        build(sourceFile) {
          sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [
              {
                name: 'injectionTables',
                type: 'Array<{ moduleId: string; table: ModuleInjectionTable }>',
                initializer: arrayLiteral(tableDecls, writeValue),
              },
            ],
          })
        },
      })

      return new Map([
        ['injection-widgets.generated.ts', widgetsOutput],
        ['injection-tables.generated.ts', tablesOutput],
      ])
    },
  }
}
