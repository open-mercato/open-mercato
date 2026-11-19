const specifier = process.argv[2]
try {
  import.meta.resolve(specifier)
  process.stdout.write('resolved')
} catch (error) {
  process.stdout.write(error && typeof error === 'object' && 'code' in error ? String(error.code) : `error:${String(error)}`)
}
