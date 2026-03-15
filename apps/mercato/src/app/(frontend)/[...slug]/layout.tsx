import { PortalLayoutProvider } from '@open-mercato/ui/portal/PortalLayoutProvider'

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return <PortalLayoutProvider>{children}</PortalLayoutProvider>
}
