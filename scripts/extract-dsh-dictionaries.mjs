/**
 * Extract the English copy of every official client-plugin locale namespace
 * from an installed DSH runtime, into `dictionaries/en.json`.
 *
 * The runtime ships one `ctx.locale.register(namespace, { zh, en })` call per UI
 * package inside its compiled `lib/*.js`. This script parses those modules with
 * the TypeScript parser (so shorthand properties such as `{ zh, en }` and
 * identifier references resolve), collects the `en` dictionary of each
 * namespace, and writes the sorted result.
 *
 * Usage:
 *   npm run extract -- <path to an installed @deepseek-ai directory>
 *   DSH_RUNTIME_ROOT=<path> npm run extract
 *
 * Without an argument the script resolves the runtime in this order: a
 * `@deepseek-ai/dsh` resolvable from the working directory, then a profile in
 * `$DSH_HOME`, then the newest npx cache entry.
 *
 * Run this after a DSH update, then translate the new keys in
 * `dictionaries/ja.json` and run `npm run build`.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const root = fileURLToPath(new URL('..', import.meta.url))
const outputPath = join(root, 'dictionaries', 'en.json')

/** Compare two DSH versions well enough to pick a baseline (release beats prerelease). */
function isNewer(candidate, incumbent) {
  const parse = (value) => {
    const [base, pre = ''] = String(value).split('-')
    return { nums: base.split('.').map((part) => Number.parseInt(part, 10) || 0), pre }
  }
  const a = parse(candidate)
  const b = parse(incumbent)
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i]
  }
  if (a.pre === b.pre) return false
  if (a.pre === '') return true
  if (b.pre === '') return false
  return a.pre > b.pre
}

function runtimeVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'dsh', 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/** Resolve the installed `@deepseek-ai` directory that holds the client packages. */
function resolveRuntimeRoot() {
  const explicit = process.argv[2] ?? process.env.DSH_RUNTIME_ROOT
  if (explicit !== undefined && explicit.length > 0) return explicit

  try {
    const entry = require.resolve('@deepseek-ai/dsh/lib/bin.js')
    return dirname(dirname(dirname(entry)))
  } catch {}

  const candidates = []
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const profiles = join(dshHome, 'profiles')
  if (existsSync(profiles)) {
    for (const profile of readdirSync(profiles)) {
      candidates.push(join(profiles, profile, 'node_modules', '@deepseek-ai'))
    }
  }
  const npx = join(homedir(), '.npm', '_npx')
  if (existsSync(npx)) {
    for (const cache of readdirSync(npx)) {
      candidates.push(join(npx, cache, 'node_modules', '@deepseek-ai'))
    }
  }
  const found = candidates.filter((path) => existsSync(join(path, 'dsh', 'package.json')))
  if (found.length === 0) return undefined
  // The newest runtime wins: dictionaries are extracted from one baseline, and an
  // older copy would silently drop namespaces the translation already covers.
  found.sort((a, b) => (isNewer(runtimeVersion(a), runtimeVersion(b)) ? -1 : 1))
  return found[0]
}

const runtimeRoot = resolveRuntimeRoot()
if (runtimeRoot === undefined) {
  console.error('extract: could not locate an installed DSH runtime.')
  console.error('         Pass the directory that contains the @deepseek-ai client packages, e.g.')
  console.error('         npm run extract -- ~/.npm/_npx/<id>/node_modules/@deepseek-ai')
  process.exit(1)
}
console.log(`extract: runtime ${runtimeVersion(runtimeRoot)} at ${runtimeRoot}`)

/** Resolve a node to a plain JS value when it is a literal or an object of literals. */
function evaluate(node, bindings, depth = 0) {
  if (node === undefined || depth > 6) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, bindings, depth + 1)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluate(node.left, bindings, depth + 1)
    const right = evaluate(node.right, bindings, depth + 1)
    return left === undefined || right === undefined ? undefined : left + right
  }
  if (ts.isIdentifier(node)) return bindings.get(node.text)
  if (ts.isObjectLiteralExpression(node)) {
    const out = {}
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        const value = evaluate(property.initializer, bindings, depth + 1)
        if (value !== undefined) out[property.name.text] = value
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const value = bindings.get(property.name.text)
        if (value !== undefined) out[property.name.text] = value
      }
    }
    return out
  }
  return undefined
}

/** Every `const X = <literal>` binding anywhere in the module, resolved in passes. */
function collectBindings(sourceFile) {
  const bindings = new Map()
  const declarations = []
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  for (let pass = 0; pass < 3; pass += 1) {
    for (const declaration of declarations) {
      if (bindings.has(declaration.name.text)) continue
      const value = evaluate(declaration.initializer, bindings)
      if (value !== undefined) bindings.set(declaration.name.text, value)
    }
  }
  return bindings
}

const dictionaries = {}
for (const packageName of readdirSync(runtimeRoot)) {
  const libDir = join(runtimeRoot, packageName, 'lib')
  if (!packageName.startsWith('dsh-client') || !existsSync(libDir)) continue
  for (const file of readdirSync(libDir)) {
    if (!file.endsWith('.js')) continue
    const full = join(libDir, file)
    const text = readFileSync(full, 'utf8')
    if (!text.includes('.register(')) continue
    const sourceFile = ts.createSourceFile(full, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
    const bindings = collectBindings(sourceFile)
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'register' &&
        node.arguments.length >= 2
      ) {
        const [namespaceArg, second] = node.arguments
        const namespace = ts.isStringLiteral(namespaceArg) ? namespaceArg.text : bindings.get(namespaceArg.getText(sourceFile))
        // The per-locale form `register(ns, 'xx', dict)` belongs to language packs, not the shipped pairs.
        if (namespace !== undefined && !ts.isStringLiteral(second)) {
          let dictionary
          if (ts.isObjectLiteralExpression(second)) {
            for (const property of second.properties) {
              if (property.name === undefined || property.name.text !== 'en') continue
              dictionary = ts.isShorthandPropertyAssignment(property) ? bindings.get('en') : evaluate(property.initializer, bindings)
            }
          }
          if (dictionary !== undefined && typeof dictionary === 'object') {
            dictionaries[namespace] = { ...(dictionaries[namespace] ?? {}), ...dictionary }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
}

const sorted = Object.fromEntries(
  Object.entries(dictionaries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, keys]) => [namespace, Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)))]),
)
writeFileSync(outputPath, `${JSON.stringify(sorted, null, 1)}\n`, 'utf8')
// The baseline is part of the artifact: a later extraction from another runtime
// version would otherwise look like a translation gap.
writeFileSync(
  join(root, 'dictionaries', 'baseline.json'),
  `${JSON.stringify({ runtime: runtimeVersion(runtimeRoot) }, null, 1)}\n`,
  'utf8',
)
const total = Object.values(sorted).reduce((sum, keys) => sum + Object.keys(keys).length, 0)
console.log(`extract: ${Object.keys(sorted).length} namespaces, ${total} keys -> ${outputPath}`)
