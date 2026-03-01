export const entities = [
  {
    id: 'instructors:instructor_profile',
    label: 'Instructor Profile',
    description: 'KARIANA instructor with Unreal Engine credentials and expertise.',
    labelField: 'displayName',
    showInSidebar: true,
    fields: [],
  },
  {
    id: 'instructors:instructor_credential',
    label: 'Instructor Credential',
    description: 'Verified credential or certification from Unreal Engine / Credly.',
    labelField: 'title',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
]

export default entities
