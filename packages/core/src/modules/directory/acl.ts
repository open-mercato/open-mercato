export const features = [
    { id: 'directory.tenants.view', title: 'View tenants', module: 'directory' },
    {
        id: 'directory.tenants.manage',
        title: 'Manage tenants',
        module: 'directory',
        dependsOn: ['directory.tenants.view'],
    },
    { id: 'directory.organizations.view', title: 'View organizations', module: 'directory' },
    {
        id: 'directory.organizations.manage',
        title: 'Manage organizations',
        module: 'directory',
        dependsOn: ['directory.organizations.view'],
    },
]

export default features
