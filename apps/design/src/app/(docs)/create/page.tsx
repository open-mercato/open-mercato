import { PageHeader } from '@/components/PageHeader'
import { ThemeCreator } from '@/components/create/ThemeCreator'
import { serverT } from '@/lib/server-text'

export default function CreatePage() {
  return (
    <div className="flex flex-col gap-8 py-6">
      <PageHeader overline={serverT('design.create.overline', 'Theme creator')} title={serverT('design.create.title', 'Create your theme')} lead={serverT('design.create.lead', 'Pick colours, shape and density, check contrast in both modes and copy the code.')} />
      <ThemeCreator />
    </div>
  )
}
