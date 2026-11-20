import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OverrideProbeControlWidget from './widget.client'

/**
 * Control for `example.injection.override-probe`: same spot, no override. Its
 * appearance is what proves the browser injection registry finished registering,
 * so the sibling's absence means "the override survived hydration" rather than
 * "the spot never rendered".
 */
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.override-probe-control',
    title: 'Module Override Probe (control)',
    description: 'Not overridden; renders on the same spot to prove the spot itself is live.',
    priority: 20,
    enabled: true,
  },
  Widget: OverrideProbeControlWidget,
}

export default widget
