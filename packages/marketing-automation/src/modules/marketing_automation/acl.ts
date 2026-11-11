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
    /**
     * Recording a consent decision a customer relayed to a person.
     *
     * Its own grant on purpose: whoever answers the phone must be able to honour "take me off the list" without
     * also being able to author campaigns that message everybody, and an author has no particular business
     * editing consent. It depends on being able to SEE the customer's marketing record, because acting on a
     * screen you cannot open is not a workflow.
     */
    id: 'marketing_automation.consent.manage',
    title: 'Record a customer consent decision on their behalf',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.runs.view'],
  },
  {
    id: 'marketing_automation.runs.view',
    title: 'View campaign runs',
    module: 'marketing_automation',
    dependsOn: ['marketing_automation.campaigns.view'],
  },
]

export default features
