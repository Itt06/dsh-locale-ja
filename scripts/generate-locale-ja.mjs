/**
 * Generate `lib/client.js` from the checked-in dictionaries.
 *
 * `dictionaries/en.json` is the English copy extracted from a DSH runtime (see
 * `scripts/extract-dsh-dictionaries.mjs`); `dictionaries/ja.json` is the
 * Japanese translation with the same namespaces and keys. The emitted client
 * module is self-contained because the runtime serves plugin client halves
 * through `__ModuleLoader__`, which only resolves the frozen platform modules —
 * relative imports would not load.
 *
 * The generator fails on anything that could corrupt the UI: a Japanese key the
 * runtime does not know, a placeholder dropped from a translation, or an empty
 * value. Missing keys are reported and fall back to English at runtime.
 *
 * Run with: npm run build
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const enPath = join(root, 'dictionaries', 'en.json')
const jaPath = join(root, 'dictionaries', 'ja.json')
const pluginsPath = join(root, 'dictionaries', 'plugins.json')
const outputPath = join(root, 'lib', 'client.js')

const PLACEHOLDER = /\{\{?[a-zA-Z0-9_]+\}?\}|%[sd]/g
const UI_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, system-ui, sans-serif'
const CODE_FONT_STACK =
  '"JetBrains Mono", "Fira Code", ui-monospace, "Noto Sans Mono CJK JP", "Noto Sans CJK JP", Consolas, "Liberation Mono", monospace'

if (!existsSync(jaPath)) {
  console.error(`generate: missing ${jaPath}`)
  process.exit(1)
}
if (!existsSync(enPath)) {
  console.error(`generate: missing ${enPath} (run "npm run extract" first)`)
  process.exit(1)
}

const en = JSON.parse(readFileSync(enPath, 'utf8'))
const ja = JSON.parse(readFileSync(jaPath, 'utf8'))

const placeholders = (value) => (value.match(PLACEHOLDER) ?? []).slice().sort()
const problems = []
let missing = 0
let translated = 0

for (const [namespace, dictionary] of Object.entries(ja)) {
  if (en[namespace] === undefined) {
    problems.push(`${namespace}: namespace is not in the extracted English copy`)
    continue
  }
  for (const [key, value] of Object.entries(dictionary)) {
    const source = en[namespace][key]
    if (source === undefined) {
      problems.push(`${namespace}.${key}: key is not in the extracted English copy`)
      continue
    }
    if (typeof value !== 'string' || (value.length === 0 && source.length > 0)) {
      problems.push(`${namespace}.${key}: translation is empty`)
      continue
    }
    const expected = placeholders(source)
    const actual = placeholders(value)
    if (expected.join('\u0000') !== actual.join('\u0000')) {
      problems.push(`${namespace}.${key}: placeholders ${JSON.stringify(actual)} do not match ${JSON.stringify(expected)}`)
      continue
    }
    translated += 1
  }
}
for (const [namespace, dictionary] of Object.entries(en)) {
  missing += Object.keys(dictionary).length - Object.keys(ja[namespace] ?? {}).length
}
if (missing > 0) console.warn(`generate: ${missing} keys have no Japanese copy yet (English fallback applies)`)

// Third-party namespaces carry their own zh+en inside their own client bundles, so this pack
// registers the Japanese dictionary ONLY for them. Their English copy lives beside it in
// dictionaries/plugins.json and is the authority for keys and placeholders.
const thirdParty = existsSync(pluginsPath) ? JSON.parse(readFileSync(pluginsPath, 'utf8')) : {}
let pluginKeys = 0
for (const [namespace, halves] of Object.entries(thirdParty)) {
  const source = halves.en
  const target = halves.ja
  if (typeof source !== 'object' || source === null || typeof target !== 'object' || target === null) {
    problems.push(`${namespace}: needs both an "en" and a "ja" half`)
    continue
  }
  if (ja[namespace] !== undefined || en[namespace] !== undefined) {
    problems.push(`${namespace}: is both an official and a third-party namespace`)
    continue
  }
  for (const [key, value] of Object.entries(target)) {
    const english = source[key]
    if (english === undefined) {
      problems.push(`${namespace}.${key}: key is not in the plugin's English half`)
      continue
    }
    if (typeof value !== 'string' || (value.length === 0 && english.length > 0)) {
      problems.push(`${namespace}.${key}: translation is empty`)
      continue
    }
    if (placeholders(english).join('\u0000') !== placeholders(value).join('\u0000')) {
      problems.push(`${namespace}.${key}: placeholders ${JSON.stringify(placeholders(value))} do not match ${JSON.stringify(placeholders(english))}`)
      continue
    }
    pluginKeys += 1
  }
  const pluginMissing = Object.keys(source).length - Object.keys(target).length
  if (pluginMissing > 0) console.warn(`generate: ${namespace}: ${pluginMissing} plugin keys have no Japanese copy yet (English fallback applies)`)
}

if (problems.length > 0) {
  console.error(`generate: ${problems.length} problem(s):`)
  for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`)
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`)
  process.exit(1)
}

// Third-party ja dictionaries join the same literal; they are registered per locale only.
for (const [namespace, halves] of Object.entries(thirdParty)) ja[namespace] = halves.ja

const namespaces = Object.keys(ja).sort()
// The check script compares these hashes to the dictionaries to catch a stale bundle.
const dictionaryHash = createHash('sha256').update(readFileSync(jaPath)).digest('hex')
const pluginsHash = existsSync(pluginsPath)
  ? createHash('sha256').update(readFileSync(pluginsPath)).digest('hex')
  : 'none'
const dictionaryLiteral = namespaces
  .map((namespace) => {
    const entries = Object.entries(ja[namespace])
      .map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
      .join('\n')
    return `    ${JSON.stringify(namespace)}: {\n${entries}\n    },`
  })
  .join('\n')

const source = `/**
 * DSH locale-ja bundle, browser half. GENERATED FILE - do not edit by hand.
 *
 * Regenerate with \`npm run build\` after changing \`dictionaries/ja.json\`
 * (translation), \`dictionaries/plugins.json\` (Japanese for third-party plugin
 * namespaces) or \`dictionaries/en.json\` (extracted from a DSH runtime with
 * \`npm run extract -- <runtime @deepseek-ai dir>\`).
 * dictionaries: ja.json sha256 ${dictionaryHash} plugins.json sha256 ${pluginsHash}
 *
 * Three jobs, all first-party opinions the official GUI does not hold:
 *   1. registers the \`ja\` locale with one dictionary per official namespace,
 *      so Settings -> General -> Language offers 日本語 and every registered key
 *      renders Japanese (unknown keys fall back to English per the locale
 *      service's fallback chain);
 *   2. registers the same locale id for third-party plugin namespaces listed in
 *      \`dictionaries/plugins.json\`. Those bundles ship zh+en themselves and the
 *      locale service keys dictionaries by namespace+locale, so adding \`ja\`
 *      here cannot collide with them; registering an unknown namespace is also
 *      safe (the service creates it on first register);
 *   3. applies a Japanese-first font stack, because the official stylesheets
 *      name Chinese families ("PingFang SC", "Microsoft YaHei") that a Linux
 *      fontconfig resolves to a Simplified-Chinese face, which renders shared
 *      kanji with Chinese glyph shapes. A font chosen in Settings still wins:
 *      that setting lands as inline style on the root element and outranks this
 *      rule.
 */
window.__ModuleLoader__.load({
  id: 'dsh-locale-ja',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const DICTIONARIES = {
${dictionaryLiteral}
    }

    const UI_FONT_STACK =
      '${UI_FONT_STACK}'
    const CODE_FONT_STACK =
      '${CODE_FONT_STACK}'

    function applyFonts() {
      if (typeof document === 'undefined') return
      const style = document.createElement('style')
      style.dataset.dshLocaleJa = 'fonts'
      style.textContent =
        ':root{--dsw-font-family:' + UI_FONT_STACK + ';--ds-font-family-code:' + CODE_FONT_STACK + ';}'
      document.head.appendChild(style)
    }

    const inject = ['locale']

    function apply(ctx) {
      applyFonts()
      ctx.effect(
        () => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }),
        'dsh-locale-ja: language',
      )
      for (const namespace of Object.keys(DICTIONARIES)) {
        ctx.effect(
          () => ctx.locale.register(namespace, 'ja', DICTIONARIES[namespace]),
          'dsh-locale-ja: ' + namespace,
        )
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
`

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, source, 'utf8')
console.log(
  `generate: ${namespaces.length} namespaces (${Object.keys(thirdParty).length} third-party, ${pluginKeys} keys), ` +
    `${translated} translated keys, ${missing} missing -> ${outputPath}`,
)
