// Copy to config.mjs (committed) or config.local.mjs (gitignored) and edit.
// Every key is optional — see README.md in this directory.
export default {
  name: 'Acme Corp',
  itContact: 'servicedesk@acme.example (queue: Developer Tooling)',
  mirrors: {
    npmRegistry: '',
    alpineMirror: '',
    nodeDist: '',
  },
  certs: {
    bundles: [
      // 'starters/company/certs/acme-root-ca.pem',
    ],
    capture: true,
  },
  checks: [
    // {
    //   id: 'vpn',
    //   title: 'Corporate VPN reachability',
    //   run: async () => ({ level: 'pass', detail: 'reachable' }),
    // },
  ],
  steps: {
    disable: [],
    extra: [],
  },
  env: {
    // OM_LOG_LEVEL: 'debug',
  },
}
