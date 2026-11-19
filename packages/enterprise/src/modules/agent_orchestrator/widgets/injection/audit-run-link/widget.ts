import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { buildRunTraceHref, readAuditEntryCorrelation } from '../../../lib/identity/auditEntryLinks'

/**
 * Adds an "Open agent run" row action to the core audit log actions table, shown only on
 * entries whose correlation carries an `agentRunId`. Additive injection into
 * `data-table:audit_logs.actions.list:row-actions`; no audit_logs file depends on it.
 */
const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'agent_orchestrator.injection.audit-run-link',
    priority: 30,
    features: ['agent_orchestrator.trace.view'],
  },
  rowActions: [
    {
      id: 'agent_orchestrator.open_run',
      label: 'agent_orchestrator.audit.links.openRun',
      icon: 'Bot',
      isVisible: (row: unknown) => readAuditEntryCorrelation(row).agentRunId !== null,
      onSelect: (row: unknown, context: unknown) => {
        const { agentRunId } = readAuditEntryCorrelation(row)
        if (!agentRunId) return
        const ctx = context as { navigate?: (path: string) => void }
        ctx.navigate?.(buildRunTraceHref(agentRunId))
      },
    },
  ],
}

export default widget
