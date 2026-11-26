# Dictionary fallback and saved lookup content

Implemented 2026-11-25.

## Fallback

The selected lookup language remains the target language in settings. Each online source first uses that language if supported, otherwise English. A supported-language result with no senses is retried in English. A network/service error remains an error rather than being misreported as a missing entry. The result records its actual language, and the external source link uses that actual language.

Youdao `actually` with target `zh` was verified against the live service: English fallback returned one sense with Chinese definitions. WordNet with target `zh` directly queried English and returned four senses. The low-level unsupported-language guard remains in place; the new wrapper chooses the supported language before calling it.

## Saved content

Successful results are stored on the exact local dictionary-history record ID. Provider results merge into that record, so one source does not replace another. Late results cannot modify a newer lookup with a different record ID. Online snapshots retain up to six senses, three definitions and one example per sense, with bounded text lengths. Offline definitions are sanitized and saved as a plain-text excerpt (up to 8,000 characters); raw MDX HTML, executable markup, CSS and media are not uploaded.

The existing learning-record analysis field carries a versioned `tubitle-dictionaries-v1:` JSON snapshot for word records. This avoids a database migration. Total payload stays below its 50,000-character API limit. The website validates this data before rendering it as React text, groups by dictionary, and preserves WordNet attribution and licenses. Old records without snapshots retain the existing WordNet lookup view; past Youdao/offline content cannot be reconstructed retroactively.

The extension queue merges richer updates under the initial clientRecordId. A completed upload removes only the exact payload acknowledged, so a dictionary result received during that upload remains queued. The website enriches only an owned, undeleted word record with matching key/text, without replacing personal notes/status or creating a second record. Empty retry payloads do not clear saved dictionary content. Anonymous sync behavior remains local; connected accounts use the established automatic learning sync.

## Interface

Online dictionary website links are icon-only in the top right of each dictionary section, with a tooltip and accessible name. The same production component/styles were checked in an isolated Chrome HTTP preview with fixed public sample responses. Screenshot: `/private/tmp/tubitle-dictionary-icons.png`. The preview does not validate the installed extension's host permissions or its live website session.

## Validation

- Extension typecheck, build and 306 tests passed.
- Website learning-service tests cover content enrichment, record identity, note preservation, empty retries, snapshot validation and text-safe rendering.
- Website production build and message verification passed.
- Live Youdao and WordNet English fallback probes passed for `actually` with selected Chinese.

Reload the unpacked extension and refresh YouTube to use the new requests and persistence. Run the updated website to render saved dictionary snapshots. Newly completed queries carry snapshots; old cloud records have no original snapshot unless they are queried again through the updated extension.
