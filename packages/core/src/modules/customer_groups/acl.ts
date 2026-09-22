export const features = [
  { id: 'customer_groups.groups.view', title: 'View customer groups', module: 'customer_groups' },
  { id: 'customer_groups.groups.manage', title: 'Manage customer groups', module: 'customer_groups', dependsOn: ['customer_groups.groups.view'] },
  { id: 'customer_groups.memberships.view', title: 'View group memberships', module: 'customer_groups' },
  { id: 'customer_groups.memberships.manage', title: 'Manage group memberships', module: 'customer_groups', dependsOn: ['customer_groups.memberships.view'] },
  { id: 'customer_groups.terms.view', title: 'View commercial terms', module: 'customer_groups' },
  { id: 'customer_groups.terms.manage', title: 'Manage commercial terms', module: 'customer_groups', dependsOn: ['customer_groups.terms.view'] },
]

export default features
