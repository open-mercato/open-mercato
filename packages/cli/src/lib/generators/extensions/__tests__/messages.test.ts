import { createMessagesExtension } from '../messages'
import type { ModuleScanContext, StandaloneConfigOptions } from '../../extension'
import type { GeneratedImportSpec } from '../../ast'

function createScanContext(options?: {
  availablePaths?: string[]
}): { calls: StandaloneConfigOptions[]; context: ModuleScanContext } {
  const availablePaths = new Set(options?.availablePaths ?? ['message-types.ts', 'message-objects.ts'])
  const calls: StandaloneConfigOptions[] = []
  const importIdRef = { value: 1 }

  const context: ModuleScanContext = {
    moduleId: 'orders',
    roots: {
      appBase: '/tmp/app/orders',
      pkgBase: '/tmp/pkg/orders',
    },
    imps: {
      appBase: '@/modules/orders',
      pkgBase: '@open-mercato/core/modules/orders',
    },
    importIdRef,
    sharedImports: [],
    resolveModuleFile: () => null,
    resolveFirstModuleFile: () => null,
    sanitizeGeneratedModuleSpecifier: (importPath) => importPath,
    processStandaloneConfig(config) {
      calls.push(config)

      if (!availablePaths.has(config.relativePath)) {
        return null
      }

      if (!config.standaloneEntries || !config.writeConfig) {
        throw new Error(`Test helper only supports entry-based standalone configs for ${config.relativePath}`)
      }

      const importName = `${config.prefix}_${config.modId}_${importIdRef.value++}`
      const importSpec: GeneratedImportSpec = {
        namespaceImport: importName,
        moduleSpecifier: `@test/${config.modId}/${config.relativePath.replace(/\.ts$/, '')}`,
      }
      const standaloneImports = config.standaloneImports as GeneratedImportSpec[]
      standaloneImports.push(importSpec)
      const sharedImports = config.sharedImports as GeneratedImportSpec[] | undefined
      sharedImports?.push(importSpec)
      config.standaloneEntries.push(config.writeConfig({ importName, moduleId: config.modId }))
      return importName
    },
  }

  return { calls, context }
}

function getOutput(outputs: Map<string, string>, fileName: string): string {
  const output = outputs.get(fileName)
  expect(output).toBeDefined()
  return output ?? ''
}

describe('createMessagesExtension', () => {
  it('scans message type and object files into fallback-aware registry outputs', () => {
    const extension = createMessagesExtension()
    const { calls, context } = createScanContext()

    extension.scanModule(context)

    expect(extension.outputFiles).toEqual([
      'message-types.generated.ts',
      'message-objects.generated.ts',
      'messages.client.generated.ts',
    ])
    expect(calls.map(({ relativePath, prefix }) => ({ relativePath, prefix }))).toEqual([
      { relativePath: 'message-types.ts', prefix: 'MSG_TYPES' },
      { relativePath: 'message-objects.ts', prefix: 'MSG_OBJECTS' },
    ])

    const outputs = extension.generateOutput()
    const messageTypesOutput = getOutput(outputs, 'message-types.generated.ts')
    const messageObjectsOutput = getOutput(outputs, 'message-objects.generated.ts')

    expect(messageTypesOutput).toContain('import * as MSG_TYPES_orders_1 from "@test/orders/message-types";')
    expect(messageTypesOutput).toContain('moduleId: "orders"')
    expect(messageTypesOutput).toContain('"default"')
    expect(messageTypesOutput).toContain('"messageTypes"')
    expect(messageTypesOutput).toContain('export const messageTypeEntries = entriesRaw, messageTypes = allTypes;')
    expect(messageTypesOutput).toContain('return allTypes.find((entry) => entry.type === type);')

    expect(messageObjectsOutput).toContain('import * as MSG_OBJECTS_orders_2 from "@test/orders/message-objects";')
    expect(messageObjectsOutput).toContain('moduleId: "orders"')
    expect(messageObjectsOutput).toContain('"default"')
    expect(messageObjectsOutput).toContain('"messageObjectTypes"')
    expect(messageObjectsOutput).toContain('export const messageObjectTypeEntries = entriesRaw, messageObjectTypes = allTypes;')
    expect(messageObjectsOutput).toContain('return allTypes.find((entry) => entry.module === module && entry.entityType === entityType);')
  })

  it('builds the client registry bootstrap and component maps from scanned modules', () => {
    const extension = createMessagesExtension()
    const { context } = createScanContext()

    extension.scanModule(context)

    const clientOutput = getOutput(extension.generateOutput(), 'messages.client.generated.ts')

    expect(clientOutput).toContain('export type MessageUiComponentRegistry = {')
    expect(clientOutput).toContain('Boolean(typeDef.ui?.listItemComponent) && Boolean(typeDef.ListItemComponent)')
    expect(clientOutput).toContain('Boolean(typeDef.ui?.contentComponent) && Boolean(typeDef.ContentComponent)')
    expect(clientOutput).toContain('Boolean(typeDef.ui?.actionsComponent) && Boolean(typeDef.ActionsComponent)')
    expect(clientOutput).toContain('`${typeDef.module}:${typeDef.entityType}`')
    expect(clientOutput).toContain('registerMessageObjectTypes(entry.types);')
    expect(clientOutput).toContain('configureMessageUiComponentRegistry(registry);')
    expect(clientOutput).toContain('export const messageClientTypeEntries = messageTypeEntriesRaw, messageClientObjectTypeEntries = messageObjectTypeEntriesRaw, messageUiComponentRegistry = registry;')
    expect(clientOutput).toContain('export function getMessageUiComponentRegistry(): MessageUiComponentRegistry {')
  })
})
