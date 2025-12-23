import type { ModuleInfo } from '@/modules/registry'
import './commands/freighttech/settings'
import './commands/freighttech/webhook'
import './commands/register_tracking'

export const metadata: ModuleInfo = {
  name: 'fms_tracking',
  title: 'Freighttech Container Tracking',
  version: '0.1.0',
  description: 'Track containers',
  author: 'Freighttech',
  license: '',
}
