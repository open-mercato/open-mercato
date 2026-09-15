export const features = [
  { id: 'documents.view', title: 'View documents', module: 'documents' },
  { id: 'documents.create', title: 'Create documents', module: 'documents', dependsOn: ['documents.view'] },
  { id: 'documents.edit', title: 'Edit documents', module: 'documents', dependsOn: ['documents.view'] },
  { id: 'documents.delete', title: 'Delete documents', module: 'documents', dependsOn: ['documents.view'] },
  { id: 'documents.share', title: 'Share documents', module: 'documents', dependsOn: ['documents.view'] },
  { id: 'documents.templates.manage', title: 'Manage document templates', module: 'documents', dependsOn: ['documents.view'] },
  { id: 'documents.manage', title: 'Manage all documents', module: 'documents', dependsOn: ['documents.view'] },
]

export default features
