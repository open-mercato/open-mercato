type ModuleMap = Record<string, Record<string, string>>

function createModuleProxy(moduleKey: string): Record<string, string> {
  return new Proxy(
    {},
    {
      get: (_target, entityKey) => {
        if (entityKey === Symbol.toStringTag) return 'ModuleEntityMap'
        return `${moduleKey}:${String(entityKey)}`
      },
      set: () => {
        throw new Error('entities.ids.generated proxy is read-only')
      },
    }
  )
}

export const E = new Proxy(
  {},
  {
    get: (_target, moduleKey) => {
      if (moduleKey === '__esModule') return false
      return createModuleProxy(String(moduleKey))
    },
    set: () => {
      throw new Error('entities.ids.generated proxy is read-only')
    },
  }
) as unknown as ModuleMap

export default E
