import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import SystemEntitiesTable from '@open-mercato/core/modules/entities/components/SystemEntitiesTable'

export default function SystemEntitiesPage() {
  return (
    <Page>
      <PageBody>
        <ContextHelp bulb title="Customize system entities with custom fields" className="mb-4">
          <p className="mb-2">This section lists built-in system entities. You can extend them by adding custom fields. These fields will automatically appear in list filters and edit forms wherever this entity is used.</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Use <strong>Edit</strong> to define custom fields for a system entity.</li>
            <li>Custom fields are applied at query time and are available across the admin UI.</li>
            <li>No schema fork needed — changes are stored safely in the custom fields engine.</li>
          </ul>
        </ContextHelp>
        <SystemEntitiesTable />
      </PageBody>
    </Page>
  )
}
