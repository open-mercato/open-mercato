export interface GeneratorPluginBootstrapRegistration {
  /** Name of the variable exported from this plugin's output file, e.g. 'securityMfaProviderEntries' */
  entriesExportName: string
  /** Full TypeScript import statements needed for the registration call (e.g. the register function) */
  registrationImports: string[]
  /** Build the registration call expression, receives the entries variable name */
  buildCall: (entriesExportName: string) => string
}

export interface GeneratorPlugin {
  /** Unique ID, e.g. 'security.mfa-providers' */
  id: string
  /** Convention file path relative to module root, e.g. 'security.mfa-providers.ts' */
  conventionFile: string
  /** Import variable prefix used in generated code, e.g. 'SECURITY_MFA_PROVIDERS' */
  importPrefix: string
  /** Build the TypeScript entry expression for each discovered module */
  configExpr: (importName: string, moduleId: string) => string
  /** Output filename relative to the generated output directory, e.g. 'security-mfa-providers.generated.ts' */
  outputFileName: string
  /** Generate the full TypeScript file content from collected imports and entry literals */
  buildOutput: (params: { importSection: string; entriesLiteral: string }) => string
  /**
   * When present, contributes a registration call to the auto-generated
   * `bootstrap-registrations.generated.ts` file. This lets modules inject
   * bootstrap-time side effects without bootstrap.ts knowing about them.
   */
  bootstrapRegistration?: GeneratorPluginBootstrapRegistration
}
