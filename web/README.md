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

Subtitle quota enforcement, website PDF creation, dictation, shadowing and recurring reports are not implemented in this website release. Extension translation/PDF providers remain separate. Account AI analysis uses the website provider and server-enforced daily limits (Free 3 / Pro 100).

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
