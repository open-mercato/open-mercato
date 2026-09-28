/**
 * Feature flags for the marketing_automation module.
 *
 * `publish` and `test_dispatch` are deliberately separate from `manage`: flipping a
 * campaign live and test-firing one are the two acts that send real messages to real
 * customers, which is a different trust level from drafting a campaign.
 */
export const features = [
  { id: 'marketing_automation.campaigns.view', title: 'View campaigns', module: 'marketing_automation' },
  {
    id: 'marketing_automation.campaigns.manage',
    title: 'Manage campaigns',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.campaigns.view'],
  },
  {
    id: 'marketing_automation.campaigns.publish',
    title: 'Enable or disable campaigns',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.campaigns.manage'],
  },
  {
    id: 'marketing_automation.test_dispatch',
    title: 'Test-fire a campaign (sends real messages)',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.campaigns.manage'],
  },
  {
    id: 'marketing_automation.runs.view',
    title: 'View campaign runs',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.campaigns.view'],
  },
]

export default features
