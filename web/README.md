# Tubitle website

A product website and private English learning library built from the supplied ShipAny TanStack template. This app lives in `web/` inside the Tubitle implementation worktree. The original template directory is unchanged.

## Included

- English and Chinese product pages with an interactive subtitle and dictionary preview.
- Free and Pro plan descriptions. Free subtitles have a planned daily limit of 500 sentences; Pro pricing and higher allowances are not yet set. Purchasing is disabled.
- Real email/password registration, sign-in, sign-out and persistent sessions through Better Auth.
- SQLite-backed personal learning records: words, sentences, context, translations, notes, YouTube video IDs and timestamps.
- Search, kind/status filters, pagination, mastery changes, source-video links, deletion and JSON export.
- Authenticated APIs with ownership checks, payload validation, same-origin writes and retry deduplication.
- Automatic Chrome extension sync through the current website login session, account-bound retry queues, and full analysis viewing. No connection codes, manual backfill or manual record creation.
- Saved-record metadata appears in the existing admin user timeline.

Subtitle quota enforcement, website PDF creation, dictation, shadowing and recurring reports are not implemented in this website release. Platform subtitle translation now uses the website's manually selected provider; custom extension translation and PDF providers remain separate. Account AI analysis uses the website provider and server-enforced daily limits (Free 3 / Pro 100).

## Platform subtitle translation

Open `/zh/admin/settings` → **字幕翻译** (English: **Subtitle Translation**). Configure the credentials for the providers you want to use, choose the active provider, test a short translation, then save. Tests use the unsaved form and can incur upstream charges. The active provider's required fields are checked before saving; connectivity and translation quality are checked by the Test button.

Supported providers are SiliconFlow Chat Completions (model ID required), Alibaba Cloud Machine Translation General Edition (`TranslateGeneral`, not Bailian), Microsoft Translator v3 (resource key and region where required), and the existing self-hosted service (`GET /health`, `POST /v1/translate`). For self-hosted services, enter the root URL without `/v1`; remote services should use HTTPS and an access key. Configure only trusted endpoints. Changing a saved endpoint requires re-entering its associated saved credentials.

Platform translation is **disabled until explicitly configured** and requires website sign-in. The extension's Tubitle mode calls `/api/extension/translation` using the existing website session; upstream credentials stay on the server. Custom API mode continues to call the user's provider directly. Build release extensions with `TUBITLE_SITE_URL=https://your-site.example`; platform mode no longer uses `TUBITLE_TRANSLATION_URL`.

Saving a provider selection applies to newly started requests without redeployment. Requests already running can finish on their captured configuration; displayed/preloaded subtitles are not forcibly refreshed. Discovery returns an opaque configuration/model revision and the authenticated account ID. Translation requests must include that revision; a switch before execution returns HTTP 409 instead of caching a new provider's result under an old identity. The extension's translation caches are separated by account and revision. Switching back to an identical configuration can reuse its previous cached translations. Self-hosted model changes are detected through `/health` and guarded by `expectedModel`.

There is **no automatic fallback or multi-provider fan-out**. The API accepts at most 1,200 UTF-16 code units of text and uses a shared 12-second upstream budget per request. It checks session ownership, origin and input shape, and applies burst-friendly, per-isolate traffic smoothing. Daily subtitle plan quotas, distributed capacity limits and provider usage accounting are not implemented; before a public paid rollout, add the intended account quotas and edge limits. Set `CONFIG_ENCRYPTION_KEY` in the server/Worker environment to enable the existing encrypted credential storage; without it, the configuration system stores secrets in plaintext. Admin responses always mask credential fields.

Web and the gateway support the Cloudflare build (`pnpm cf:build`); the current model inference remains on the VPS. A Worker's `localhost` cannot reach a developer computer or the VPS. Use an accessible HTTPS self-hosted endpoint, and configure a persistent database and server secrets for production. This change does not deploy the application or migrate inference.

Validation: `pnpm test:translation`, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm cf:build`; extension: `npm test --workspace extension`, `npm run typecheck --workspace extension`, `npm run build --workspace extension`. Translation tests mock upstream APIs; real credentials and an actual-video browser check are still needed for each enabled provider.

## Local development

Use Node.js 22.12+ or 24 and pnpm 12. From this directory:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.development
# Set AUTH_SECRET to a random value, e.g. openssl rand -base64 48.
# Optionally set CONFIG_ENCRYPTION_KEY to openssl rand -hex 32.
pnpm db:setup
pnpm db:push
pnpm rbac:init
pnpm dev
```

The implementation workspace already has an ignored local environment file and an initialized SQLite database. Do not overwrite them when resuming local work. Open `http://127.0.0.1:3100/zh` for Chinese or `/` for English. Create your own account at `/zh/sign-up`.

The administration UI is at `/admin`. No default administrator credentials are installed. Use `pnpm rbac:assign` with your registered account when you need an administrator; see the script's help before assigning. OAuth, email delivery, payment and AI providers remain configurable through the template's admin settings. Production deployment needs its own URL, secrets, durable database, backup strategy and provider setup.

## Validation

```bash
pnpm exec tsc --noEmit
pnpm test:learning
pnpm build
```

Learning tests use an isolated temporary SQLite database. The three schema templates retain the custom learning table when `prebuild` generates `schema.ts`. Production migrations must be generated and reviewed before being applied. The Inlang message-format plugin is vendored from the official package so translation compilation does not depend on CDN access.

See [the API contract](docs/learning-api.md), [design decisions](DESIGN.md) and [template upgrade notes](UPGRADING.md). The underlying template license is retained in `LICENSE`.
