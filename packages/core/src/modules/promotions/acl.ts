export const features = [
  { id: 'promotions.view', title: 'View promotions', module: 'promotions' },
  { id: 'promotions.create', title: 'Create promotions', module: 'promotions', dependsOn: ['promotions.view'] },
  { id: 'promotions.update', title: 'Update promotions', module: 'promotions', dependsOn: ['promotions.view'] },
  { id: 'promotions.delete', title: 'Delete promotions', module: 'promotions', dependsOn: ['promotions.view'] },
  { id: 'promotions.codes.manage', title: 'Manage promotional codes', module: 'promotions', dependsOn: ['promotions.view'] },
  { id: 'promotions.evaluate', title: 'Evaluate promotions against a cart context', module: 'promotions' },
  { id: 'promotions.codes.redeem', title: 'Redeem promotional codes', module: 'promotions' },
  { id: 'promotions.usage.manage', title: 'Register and revert promotion usage', module: 'promotions' },
]

export default features
