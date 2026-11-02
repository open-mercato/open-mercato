export const features = [
  { id: 'phone_calls.view', title: 'View phone calls', module: 'phone_calls' },
  {
    id: 'phone_calls.manage',
    title: 'Manage phone calls (pull, raw payload)',
    module: 'phone_calls',
    dependsOn: ['phone_calls.view'],
  },
]

export default features
