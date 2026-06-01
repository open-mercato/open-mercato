export const features = [
  { id: 'onboarding.access', title: 'Access onboarding flow', module: 'onboarding' },
  {
    id: 'onboarding.submit',
    title: 'Submit onboarding request',
    module: 'onboarding',
    dependsOn: ['onboarding.access'],
  },
  {
    id: 'onboarding.verify',
    title: 'Verify onboarding request',
    module: 'onboarding',
    dependsOn: ['onboarding.access'],
  },
]

export default features
