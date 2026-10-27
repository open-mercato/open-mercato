import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import OverrideProbeWidget from './widget.client'

/**
 * Disabled from `src/modules.ts` (`widgets.injection`) so integration coverage can
 * prove the override reaches the BROWSER registry, not only the server one.
 * `ClientBootstrap` re-registers the injection registry after hydration, and before
 * #5152 that re-registration restored every widget the server had filtered out.
 *
 * The override there is keyed by this widget's registry `key`, the spelling the
 * injection tables do NOT use, so the alias resolution added for #5152 is exercised
 * end to end. `override-probe-control` sits on the same spot with no override and
 * must stay visible, which keeps the absence assertion from passing for the wrong
 * reason (a spot that renders nothing at all).
 */
const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.override-probe',
    title: 'Module Override Probe (disabled)',
    description: 'Disabled through modules.ts; must not render once the client bootstrap has run.',
    priority: 10,
    enabled: true,
  },
  Widget: OverrideProbeWidget,
}

export default widget
