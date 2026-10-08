import { defineProcessConfig } from '@open-mercato/shared/modules/insights/process'
import { E } from '#generated/entities.ids.generated'
import { CLOSED_DEAL_STATUS_LIST } from './lib/dealStatus'

export const CUSTOMERS_DEAL_PROCESS_KEY = 'customers.deal'

/**
 * Process X-Ray: the deal lifecycle. Cases are deals; activities are the deal's creation and
 * deletion, its status and pipeline-stage changes, and owner hand-overs (the owner is stored
 * as a pseudonym). Snapshot paths and change keys match what the deal commands record
 * (`deal.*` in `snapshot_before` / `snapshot_after`, deep change keys derived by the command
 * bus). A deal ends when its status reaches a closed status.
 */
export const processConfig = defineProcessConfig({
  version: 1,
  processes: [
    {
      processKey: CUSTOMERS_DEAL_PROCESS_KEY,
      labelKey: 'customers.insights.process.deal',
      resourceKind: 'customers.deal',
      logResourceKinds: ['customers.deal'],
      entityId: E.customers.customer_deal,
      requiredFeatures: ['customers.deals.view'],
      stageFields: [
        {
          key: 'status',
          labelKey: 'customers.insights.fields.status',
          valueKind: 'dictionary',
          snapshotPaths: ['deal.status'],
          changeKeys: ['deal.status'],
        },
        {
          key: 'pipelineStageId',
          labelKey: 'customers.insights.fields.pipelineStage',
          valueKind: 'uuid',
          snapshotPaths: ['deal.pipelineStageId'],
          changeKeys: ['deal.pipelineStageId'],
        },
      ],
      followupFields: [
        {
          key: 'ownerUserId',
          labelKey: 'customers.insights.fields.owner',
          valueKind: 'user',
          snapshotPaths: ['deal.ownerUserId'],
          changeKeys: ['deal.ownerUserId'],
        },
      ],
      endStates: [{ field: 'status', values: [...CLOSED_DEAL_STATUS_LIST] }],
    },
  ],
})

export default processConfig
