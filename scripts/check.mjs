/**
 * Validate the bundle without any dependency: the declarations a DSH profile
 * needs, the generated browser half, the dictionary parity and its staleness.
 *
 * Run with: npm test
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const PLACEHOLDER = /\{\{?[a-zA-Z0-9_]+\}?\}|%[sd]/g
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`)
    failures.push(label)
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log('package declarations')
check('main is lib/index.js', pkg.main === 'lib/index.js', String(pkg.main))
check("exports['./client'] is lib/client.js", pkg.exports?.['./client']?.default === './lib/client.js')
check("dsh.client.platform is 'web'", pkg.dsh?.client?.platform === 'web')
check('dsh.bundle.patch names cordis.patch.yml', (pkg.dsh?.bundle?.patch ?? []).includes('./cordis.patch.yml'))

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
console.log('bundle patch')
check("patch inserts the package's own row", patch.includes('name: dsh-locale-ja'))
check('patch row id is stable', patch.includes('id: dsh-locale-ja'))

const clientPath = join(root, 'lib', 'client.js')
if (!existsSync(clientPath)) {
  console.log('generated browser half')
  console.log('  FAIL lib/client.js is missing; run "npm run build"')
  console.log('\ncheck: FAIL (1)')
  process.exit(1)
}
const client = readFileSync(clientPath, 'utf8')
console.log('generated browser half')
check('uses the official module loader', client.includes('window.__ModuleLoader__.load'))
check("registers under the package id", client.includes("id: 'dsh-locale-ja'"))
check('exports apply', client.includes('exports.apply = apply'))
check('injects the locale service', client.includes("const inject = ['locale']"))
check('adds the ja language with an en fallback', client.includes("addLanguage({ id: 'ja', label: '日本語', fallback: 'en' })"))
check('registers per-namespace dictionaries', client.includes("ctx.locale.register(namespace, 'ja', DICTIONARIES[namespace])"))
check('applies the interface font token', client.includes('--dsw-font-family'))
check('applies the code font token', client.includes('--ds-font-family-code'))
check('requires no platform module', [...client.matchAll(/require\(['"]([^'"]+)['"]\)/g)].length === 0)

const en = JSON.parse(readFileSync(join(root, 'dictionaries', 'en.json'), 'utf8'))
const ja = JSON.parse(readFileSync(join(root, 'dictionaries', 'ja.json'), 'utf8'))
let baseline = 'unknown'
try {
  baseline = JSON.parse(readFileSync(join(root, 'dictionaries', 'baseline.json'), 'utf8')).runtime
} catch {}
console.log(`dictionaries (extracted from DSH ${baseline})`)
let keys = 0
const problems = []
for (const [namespace, dictionary] of Object.entries(en)) {
  for (const [key, source] of Object.entries(dictionary)) {
    const value = ja[namespace]?.[key]
    if (typeof value !== 'string') problems.push(`${namespace}.${key}: missing`)
    else if (value.length === 0 && source.length > 0) problems.push(`${namespace}.${key}: empty`)
    else if ((value.match(PLACEHOLDER) ?? []).slice().sort().join('|') !== (source.match(PLACEHOLDER) ?? []).slice().sort().join('|'))
      problems.push(`${namespace}.${key}: placeholder mismatch`)
    keys += 1
  }
}
for (const [namespace, dictionary] of Object.entries(ja)) {
  if (en[namespace] === undefined) problems.push(`${namespace}: unknown namespace`)
  else {
    for (const key of Object.keys(dictionary)) if (en[namespace][key] === undefined) problems.push(`${namespace}.${key}: unknown key`)
  }
}
check(`${Object.keys(en).length} namespaces / ${keys} keys fully covered`, problems.length === 0, problems.slice(0, 5).join('; '))
check('extraction baseline is recorded', baseline !== 'unknown')

const hash = createHash('sha256').update(readFileSync(join(root, 'dictionaries', 'ja.json'))).digest('hex')
check('bundle is not stale (sha256 of dictionaries/ja.json)', client.includes(`dictionaries: ja.json sha256 ${hash}`))

console.log(failures.length === 0 ? '\ncheck: PASS' : `\ncheck: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
