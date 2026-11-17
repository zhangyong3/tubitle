# Extension interface translations

Each JSON catalog maps the existing Simplified Chinese source message to its localized text. Simplified Chinese uses the source message directly. Keep the same keys and `{0}`, `{1}` placeholders in every catalog; translate whole messages instead of joining sentence fragments.

- `i18n.ts` resolves the browser language, restores `settings.uiLanguage`, and notifies open interfaces when Chrome storage changes.
- React surfaces subscribe through `useI18n()`. DOM surfaces explicitly refresh their own labels. Content scripts must not change the YouTube document’s language or direction.
- Interface language is independent of `targetLanguage`, which controls subtitle translation. Keep subtitles, dictionary definitions, video titles and generated analysis untouched.
- Status and error state retains Chinese source messages so existing messages can be redisplayed after a language change. Known formatted status messages are matched to catalog templates.
- `extension/public/_locales` contains browser-managed name and description translations. Chrome chooses these from the browser language.

Run `npm test` to check catalog coverage, placeholders, settings migration, language switching and rendered settings markup. Browser screenshots are still needed to verify actual typography and wrapping.
