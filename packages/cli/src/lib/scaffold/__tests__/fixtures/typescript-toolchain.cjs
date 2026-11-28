const resolutionDirectory = process.argv[2]
const typeScriptPath = require.resolve('typescript', { paths: [resolutionDirectory] })
const typeScript = require(typeScriptPath)

console.log(`${typeScriptPath} v${typeScript.version} Extension=${typeof typeScript.Extension}`)
