# Learning record API

Records come from signed-in video word lookups and completed sentence analyses. The manual form and `POST /api/learning` have been removed.

## Website library

All endpoints require the current user's Better Auth session cookie. Ownership comes from the session. Responses use `{ code, message, data }`, except the JSON export. Records are private and not cached.

- `GET /api/learning?search=show&kind=word&status=new&page=1`: 20 records per page, newest first; filters optional. Includes filtered total and account summary.
- `PATCH /api/learning`: `{ "id": "record-id", "status": "mastered" }`. Status is `new`, `learning` or `mastered`. Foreign records return 404.
- `DELETE /api/learning?id=record-id`: removes content and retains a minimal retry tombstone.
- `GET /api/learning/export`: active records as JSON, not PDF.

Writes require same-origin JSON and authentication. No endpoint accepts a client-supplied owner. Video destinations are constructed from validated IDs.

## Automatic extension sync

The extension uses `credentials: include` with the live website session, not Bearer credentials. The connection-code endpoint/service, manual connect/disconnect and history backfill have been deleted. Sign in in the same Chrome profile; logout/expiry stops uploads. Build the extension with `TUBITLE_SITE_URL=https://your-domain.example` for deployment (default loopback preview). The generated manifest grants that exact website host permission; end users do not configure a URL.

Every extension request requires `X-Tubitle-Extension: 1` and a website or Chrome extension Origin. No CORS permission is granted to outside websites. `POST` additionally requires `X-Tubitle-Account` matching the live session user, preventing a pending queue belonging to A from being saved under a newly signed-in B. Account IDs never grant authentication.

- `GET /api/extension/learning`: authenticated `{userId, name}` for queue ownership.
- `POST /api/extension/learning`: strict learning input, required stable `clientRecordId`, `kind` word/sentence, `text` up to 2,000 characters, optional context/translation/note up to 4,000 each, analysis up to 50,000, validated YouTube `videoId` or empty source, video title, integer `startSeconds` and optional later `endSeconds`. Body cap 256 KiB. Returns acknowledgement only; cannot read/edit/delete library records. Deleted retries are acknowledged without restoring content.

Anonymous queries remain local and are never backfilled. Pending signed-in records retain their owner, retry every minute/startup (up to 1,000 records, 20 per flush with 250 ms gaps). Logout or account switch clears the old pending queue; local history stays. Offline uploads retain their stable IDs. Old manual credentials and queues are discarded on extension upgrade. No MDX content, dictionary source, provider keys, incomplete analyses or full viewing history are uploaded.

## Account AI analysis

`POST /api/extension/analysis` uses the same session and headers. Strict JSON `{ "sentence": "...", "requestId": "UUID" }`, max 2,000 characters. The server determines the plan: Free 3 / Pro 100 per Beijing day. `GET` returns plan, limit, used, remaining and resetsAt. Successful POST data has `choices[0].message.content`. Errors may include `data.reason`: `LOGIN_REQUIRED` (401), `QUOTA_EXHAUSTED` (403), or request conflict (409). Failed providers return 503 and release the slot. Completed same-day retries return cached output; pending duplicates cannot call the provider again. Failed requests need a fresh UUID. Provider configuration and plan never come from the client.
