import { DocsProviders } from '@/components/DocsProviders'
import { DocsShell } from '@/components/DocsShell'
import { navigationGroups } from '@/lib/manifest'

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocsProviders>
      <DocsShell groups={navigationGroups()}>{children}</DocsShell>
    </DocsProviders>
  )
}
