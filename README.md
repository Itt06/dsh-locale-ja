# dsh-locale-ja

A **DSH profile bundle** that makes the official DSH web GUI Japanese and fixes the Chinese glyph
shapes a Linux font stack produces.

It registers the `ja` locale with one dictionary per official namespace (57 namespaces, 2,491
keys) and applies a Japanese-first font stack through the official tokens. Untranslated keys fall
back to English, so a newer DSH that adds copy keeps working with the pack installed.

| Piece | Role |
|---|---|
| `lib/client.js` | Generated browser half: `addLanguage({ id: 'ja', … })` + per-namespace `register` + the font stack. Served by the runtime's `/plugins` route. |
| `lib/index.js` | Host half: an empty `apply`, so Loader has a row to mount. |
| `cordis.patch.yml` | The bundle's own Loader row, inserted into whichever profile installs it. |
| `dictionaries/en.json` | English copy extracted from a DSH runtime — the translation baseline and the key/placeholder authority. |
| `dictionaries/baseline.json` | Which DSH version `en.json` came from (currently 0.2.1-rc.2), so a later extraction from another version reads as a deliberate change. |
| `dictionaries/ja.json` | The Japanese translation. |
| `scripts/*.mjs` | Extract → validate → generate. `npm run build` regenerates `lib/client.js`; `npm test` checks declarations, dictionary parity and staleness. |

## Install (official path)

DSH installs profile bundles itself — no hand-edited patch paths, so the same bundle works on every
device. It needs `pnpm` on `PATH`:

```bash
pnpm --version || npm install -g pnpm@11.28.5   # or: corepack enable pnpm
dsh plugin --profile web add git+https://github.com/Itt06/dsh-locale-ja
```

The same install is available in the GUI under **Settings → Plugins**, and the installed row shows
up in **Plugin list** where it can be turned off or removed again.

Then pick the language (skip if the browser already asks for `ja`):

> **Settings → General → Language → 日本語**

The font stack applies immediately when the plugin activates; choosing a font yourself in Settings
still wins, because that lands as inline style on the root element.

## How it works

- The locale service ships `en` and `zh`. A *language pack* is the official extension point:
  `ctx.locale.addLanguage` registers the locale, and `ctx.locale.register(namespace, 'ja', dict)`
  adds one namespace dictionary as an owned effect. Lookup walks `ja → en`, so partial coverage is
  safe by construction.
- The official stylesheets name Chinese families (`PingFang SC`, `Hiragino Sans GB`,
  `Microsoft YaHei`). On a Linux desktop `fc-match "Microsoft YaHei"` answers `Noto Sans CJK SC`, so
  shared kanji render with Simplified-Chinese glyph shapes. This bundle sets `--dsw-font-family` and
  `--ds-font-family-code` instead, with Japanese families first.
- There is no official font-*family* setting in DSH (only size), which is why the font fix needs
  code at all. Everything else here is the official language-pack mechanism.

## Maintaining the translation after a DSH update

```bash
npm install                     # once: the extractor uses the TypeScript parser
npm run extract -- <path to the installed @deepseek-ai directory>
#   e.g. ~/.dsh/profiles/web/node_modules/@deepseek-ai
#        ~/.npm/_npx/<id>/node_modules/@deepseek-ai
git diff dictionaries/en.json   # new keys the runtime added
# translate the new keys in dictionaries/ja.json
npm run build && npm test
```

`npm run extract` without an argument resolves the runtime from the working directory, then from a
profile under `$DSH_HOME`, then from the newest npx cache entry.

## Notes

- The translated copy has not been reviewed on screen yet; wording fixes are a one-line change in
  `dictionaries/ja.json` plus `npm run build`.
- Units and product names stay as the source has them where that is conventional (`s`, `m`, `ms`,
  `tok`, `DeepSeek`, `MCP`, `API`).
