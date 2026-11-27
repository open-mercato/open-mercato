export const features = [
  { id: 'legal_review.matters.view', title: 'View legal matters', module: 'legal_review' },
  {
    id: 'legal_review.matters.manage',
    title: 'Manage legal matters',
    module: 'legal_review',
    dependsOn: ['legal_review.matters.view'],
  },
]

export default features
