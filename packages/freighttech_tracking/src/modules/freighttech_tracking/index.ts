import type { ModuleInfo } from '@/modules/registry'
import './commands/settings'
import './commands/webhook'

export const metadata: ModuleInfo = {
  name: 'freighttech_tracking',
  title: 'Freighttech Container Tracking',
  version: '0.1.0',
  description: 'Track containers',
  author: 'Freighttech',
  license: '',
}
