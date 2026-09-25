export const features = [
  { id: 'hr.read', title: 'View HR records', module: 'hr_management' },
  { id: 'hr.write', title: 'Manage HR records', module: 'hr_management', dependsOn: ['hr.read'] },
  { id: 'hr.admin', title: 'Administer HR management', module: 'hr_management', dependsOn: ['hr.write'] },
  { id: 'hr.documents.manage', title: 'Manage employee documents', module: 'hr_management', dependsOn: ['hr.read'] },
  { id: 'approvals.config', title: 'Configure approval workflows', module: 'hr_management', dependsOn: ['hr.read'] },
  { id: 'approvals.action', title: 'Act on approval requests', module: 'hr_management', dependsOn: ['hr.read'] },
]

export default features
