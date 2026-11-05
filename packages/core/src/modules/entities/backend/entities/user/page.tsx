import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import UserEntitiesTable from '@open-mercato/core/modules/entities/components/UserEntitiesTable'

export default function UserEntitiesPage() {
  return (
    <Page>
      <PageBody>
        <ContextHelp bulb title="Design your own user entities" className="mb-4">
          <p className="mb-2">Create and manage user entities — your own data types, similar to custom database tables. Store records and work with them across the admin UI and APIs.</p>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Define fields and forms once; they are automatically used for filters and inputs.</li>
            <li>Use <strong>Create</strong> to add a new entity and then attach custom fields.</li>
            <li>Programmatic access is available — see the cURL examples in the entity records page.</li>
          </ul>
        </ContextHelp>
        <UserEntitiesTable />
      </PageBody>
    </Page>
  )
}
