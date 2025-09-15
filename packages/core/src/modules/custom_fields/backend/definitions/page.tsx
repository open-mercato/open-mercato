import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

async function loadDefs() {
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const defs = await em.find(CustomFieldDef, {}, { orderBy: { entityId: 'asc', key: 'asc' } as any })
  return defs
}

export default async function DefinitionsPage() {
  const defs = await loadDefs()
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Field Definitions</h1>
      <p className="text-sm text-muted-foreground">Declared and seeded custom field definitions. Editing UI to be added.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b"><th className="py-2 pr-4">Entity</th><th className="py-2 pr-4">Org</th><th className="py-2 pr-4">Key</th><th className="py-2 pr-4">Kind</th><th className="py-2 pr-4">Active</th></tr>
          </thead>
          <tbody>
            {defs.map((d) => (
              <tr key={`${d.entityId}:${d.organizationId ?? 'global'}:${d.key}`} className="border-b">
                <td className="py-2 pr-4">{d.entityId}</td>
                <td className="py-2 pr-4">{d.organizationId ?? 'global'}</td>
                <td className="py-2 pr-4">{d.key}</td>
                <td className="py-2 pr-4">{d.kind}</td>
                <td className="py-2 pr-4">{d.isActive ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

