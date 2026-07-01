export const features = [
  { id: 'incidents.incident.view', title: 'View incidents', module: 'incidents' },
  { id: 'incidents.incident.create', title: 'Create incidents', module: 'incidents', dependsOn: ['incidents.incident.view'] },
  { id: 'incidents.incident.manage', title: 'Manage incidents', module: 'incidents', dependsOn: ['incidents.incident.view'] },
  { id: 'incidents.incident.assign', title: 'Assign incidents', module: 'incidents', dependsOn: ['incidents.incident.view'] },
  { id: 'incidents.incident.close', title: 'Close incidents', module: 'incidents', dependsOn: ['incidents.incident.view'] },
  { id: 'incidents.incident.escalate', title: 'Escalate incidents', module: 'incidents', dependsOn: ['incidents.incident.view'] },
  { id: 'incidents.postmortem.view', title: 'View postmortems', module: 'incidents' },
  { id: 'incidents.postmortem.manage', title: 'Manage postmortems', module: 'incidents', dependsOn: ['incidents.postmortem.view'] },
  { id: 'incidents.settings.manage', title: 'Manage incident settings', module: 'incidents' },
]

export default features
