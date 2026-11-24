# Online dictionary selection

Implemented 2026-11-24. The extension Settings → Online dictionaries section supports independent Bing, Youdao and Open English WordNet checkboxes, including an empty selection. Existing installations retain WordNet as their default. Settings schema version: 12.

The lookup panel displays sources separately. Unsupported languages do not trigger requests; source failures have retry controls and do not suppress other sources or offline dictionaries. Successful online results have a bounded 30-minute memory cache. Existing WordNet history caching and licensing remain intact.

## Language routing

- WordNet: English only.
- Bing: English and Chinese.
- Youdao: English, Chinese, Japanese, Korean, French. Other languages are not advertised as supported.
- Lookup language follows the target language in extension settings, including live settings changes. The panel has no separate language selector. Regional variants such as zh-TW are normalized to their language family for dictionary routing.
- Japanese/Chinese/Thai overlay text uses Intl.Segmenter. Case and combining marks are preserved for online queries.
- Dictionaries retain their own definition languages (often Chinese for Bing/Youdao); this feature does not translate dictionary definitions into the subtitle target language.

## Implementation reference

KISS Translator source inspected at commit `8696ab9e9b2f6f4d90960e7c1d3c1bf0aa989a20`; see [dictionary research](kiss-translator-dictionary-research.md).

Bing uses its dictionary HTML endpoint; Youdao uses a bodyless GET to its web dictionary JSON endpoint. Neither requires a user API key. Requests omit cookies, have timeouts, reject redirects, and require optional host permission when enabling Bing/Youdao. Bing HTML is parsed in an inert template and rendered as React text, never attached as remote markup. These website endpoints can change or throttle; successful checks are not a guarantee of unlimited availability.

## Validation

- `npm run typecheck`, `npm test` (42 files, 296 tests), `npm run build`, `git diff --check`: passed.
- Actual public interface queries: Youdao `learn`/en (1 sense), `bonjour`/fr (1), `こんにちは`/ja (1), `안녕`/ko (3), `学习`/zh (2); WordNet `learn`/en (6).
- Bing `learn`: HTTP 200. Its actual returned HTML was parsed in Chrome using the production parser: lemma `learn`, 2 senses, English/Chinese example sentences.
- Chrome HTTP preview of the production settings UI: enabled all three checkboxes, reloaded and confirmed the selection remained saved. Preview storage is isolated localStorage; extension permission prompts and installed-extension storage were not exercised.
- Settings screenshot: `/private/tmp/tubitle-online-dictionary-settings.png`.

Reproduce public probes without extra dependencies:

```sh
node --input-type=module -e 'import{build}from"esbuild";await build({entryPoints:["scripts/probe-online-dictionaries.mts"],bundle:true,platform:"node",format:"esm",outfile:"/tmp/tubitle-dict-probe.mjs"})'
node /tmp/tubitle-dict-probe.mjs
```

The probe logs result counts and saves Bing HTML only under `/private/tmp`. Do not commit full third-party dictionary responses.

## Installed extension follow-up

Reload the unpacked extension from `extension/dist`, refresh YouTube, enable the desired dictionaries in settings, accept their host permission requests and double-click a subtitle word. Verify that changing the target language in settings updates dictionary routing. Direct extension-page automation was unavailable; the UI validation above is an isolated HTTP preview, not a claim of installed-extension end-to-end verification.

## Youdao Chrome Origin regression (2026-11-24)

Root cause: the original POST adds Chrome's extension Origin header; Youdao rejects `Origin: chrome-extension://…` with HTTP 403 and `Invalid CORS request`. Reproduced with a public `learn` query carrying the extension Origin. The same endpoint accepts GET without that POST Origin, so the production request now uses GET with URLSearchParams, omitted cookies, no body or custom headers, and the same host permissions. No Origin spoofing or header-rewrite permissions were added.

Regression test in `extension/src/shared/online-dictionaries.test.ts` emulates the observed POST rejection, asserts successful parsed definitions and verifies GET query parameters and omitted body. Observed red before implementation (1 failed, 6 passed), green after (7 passed). All 296 tests, typecheck, build and whitespace checks passed. The updated production request passed actual English, French, Japanese, Korean and Chinese public sample queries. Source sweep found one production Youdao dictionary network request; Bing is already GET and WordNet is unchanged. No other Youdao production request sites exist.

Installed-extension follow-up still requires reload/refresh: this repair has not been directly verified inside the user's installed extension. The earlier isolated UI preview does not exercise Chrome extension request headers.
