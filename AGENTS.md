# AGENTS.md — dsh-locale-ja engineering notes

> 日本語の概要: 公式GUIの英語文言を抽出して日本語辞書を作り、単一ファイルのクライアント
> プラグインとして配布するリポジトリです。DSH更新時は「抽出→未訳キーを翻訳→生成→検証」の順で
> 回してください。キーとプレースホルダは `en.json` が正で、`npm test` がそれを強制します。

Audience: an AI agent maintaining the Japanese language pack. `README.md` explains usage; this file
is the pipeline contract.

## Files

| File | Role |
|---|---|
| `dictionaries/en.json` | English copy extracted from a DSH runtime — the key/placeholder authority. |
| `dictionaries/baseline.json` | Which runtime version `en.json` came from (currently `0.2.1-rc.2`). |
| `dictionaries/ja.json` | The Japanese translation; same namespaces and keys. |
| `lib/client.js` | **Generated**. Registers `ja` per namespace and applies the font stack. Never edit by hand. |
| `scripts/extract-dsh-dictionaries.mjs` | Re-extracts `en.json` from an installed runtime. |
| `scripts/generate-locale-ja.mjs` | Validates `ja.json` against `en.json` and emits `lib/client.js`. |
| `scripts/check.mjs` | Dependency-free verification (see below). |

## Pipeline after a DSH update

```bash
npm install                                        # typescript, used by the extractor
npm run extract -- ~/.dsh/profiles/web/node_modules/@deepseek-ai   # or an npx cache path
git diff dictionaries/en.json                      # keys the runtime added or reworded
# translate the new keys in dictionaries/ja.json
npm run build && npm test
git add -A && git commit -m "…" && git push
```

`npm run extract` without an argument resolves the runtime from the working directory, then from a
profile under `$DSH_HOME`, then from the newest npx cache entry — and prints the version it chose.
**Always check that version**: extracting from an older runtime silently drops namespaces the
translation already covers, and the generator will then fail on "key is not in the extracted English
copy" (which is the intended alarm, not a bug).

## Rules the scripts enforce

- Keys and placeholders must match `en.json` exactly; placeholders are compared as sorted sets, so a
  natural reordering such as `{maximum} 回中 {retry} 回` is accepted.
- Empty source values stay empty (`chat.message.stepProcess.sharedPrefix`); every other value must
  be non-empty.
- Unknown namespaces/keys are errors: the pack must not invent keys the runtime cannot ask for.
- `npm test` also verifies the bundle shape (`id: 'dsh-locale-ja'`, `addLanguage({ id: 'ja' … })`,
  `ctx.locale.register(namespace, 'ja', …)`, both font tokens), that the module requires **no**
  platform module, complete `en` coverage, and staleness via the sha256 the generator embeds.

## Mechanics worth remembering

- The locale service ships `en` and `zh` only. A language pack registers the locale
  (`ctx.locale.addLanguage`) and each namespace per locale (`ctx.locale.register(ns, 'ja', dict)`),
  which is the form that does **not** require a `zh` dictionary. Lookup walks `ja → en`, so partial
  coverage degrades gracefully.
- The client half is a single self-contained file because plugin client modules resolve only the
  frozen platform modules (`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-*`,
  `@deepseek-ai/cordis`) and cannot use relative imports. That is why the dictionaries are inlined.
- The font fix exists because the official stylesheets name Chinese families (`PingFang SC`,
  `Hiragino Sans GB`, `Microsoft YaHei`) and a Linux fontconfig resolves `Microsoft YaHei` to
  `Noto Sans CJK SC`, giving shared kanji Chinese glyph shapes. The pack sets
  `--dsw-font-family` / `--ds-font-family-code`; a font chosen in Settings still wins, because that
  lands as inline style on the root element.
- Adding a language pack's own copy to **another** plugin: register that plugin's namespace as
  `('ja', dict)` too; a `ja` dictionary in the object form is impossible (that form requires both
  shipped locales), and registering a `ja` dictionary before the locale exists must not break the
  plugin — wrap it as `dsh-dashboard` does.

## Translation conventions (keep them consistent)

- Buttons/labels/menu items: short nouns or 「〜する」 forms, no です・ます; sentences, notices and
  errors: natural です・ます.
- Product names, model ids, identifiers, commands, paths, env vars and units stay as the source has
  them (`DeepSeek`, `MCP`, `API`, `pnpm`, `{seconds}s`, `tok`).
- Glossary used throughout: Settings=設定, Agent=エージェント, Session=セッション,
  Workspace=ワークスペース, Provider=プロバイダー, Model=モデル, Tool=ツール, Approval=承認,
  Permission=権限, Deliverable=成果物, Subagent=サブエージェント, Plan=プラン, Goal=ゴール,
  Job=ジョブ, Plugin=プラグイン, Skill=スキル, Workflow=ワークフロー, Schedule=スケジュール,
  Diff=差分, Token=トークン, Context=コンテキスト, Snapshot=スナップショット, Cancel=キャンセル,
  Save=保存, Delete=削除, Edit=編集, Copy=コピー, Retry=再試行, Default=既定, Custom=カスタム.
