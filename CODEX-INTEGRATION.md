# OpenHiggsfield → Codex: Phase 1 (Automation API)

This adds **two** private endpoints. It does not create a Codex connector yet, and cannot generate without real Higgsfield API credentials/credits.

Coolify runtime-only environment variables (never commit secrets):

- `HF_API_BASE_URL`: correct HTTPS base URL from your Higgsfield developer account.
- `HF_API_KEY`: Higgsfield provider key formatted `id:secret` (same credential format used by the existing UI).
- `AUTOMATION_API_TOKEN`: independent random secret, at least 32 characters; generate locally with `openssl rand -hex 32`.
- `ASSET_STORAGE_PATH=/app/storage/assets`: filesystem path backed by a Coolify persistent volume.
- `ASSET_PUBLIC_BASE_URL=https://openhiggsfild.10xscale.agency/assets`: public HTTPS prefix returned after upload.
- Optional `ASSET_MAX_UPLOAD_BYTES`: positive byte limit; defaults to 50 MiB.
- `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.

`OPEN_HIGGSFIELD_READ_WRITE_TOKEN` is not required for normal asset uploads.

The existing UI can still use its separate browser cookie credentials. Automation routes never read that cookie or accept provider credentials from the request. They require `Authorization: Bearer <AUTOMATION_API_TOKEN>`.

## Upload a local reference asset

Automation may upload a supported local image, MP4 video, or WAV audio file to
the protected asset endpoint before creating an offline generation plan:

```bash
curl -sS -X POST 'https://openhiggsfild.10xscale.agency/api/assets' \
  -H "Authorization: Bearer $AUTOMATION_API_TOKEN" \
  -F 'file=@./product.png'
```

Response (201): `{ "url": "https://openhiggsfild.10xscale.agency/assets/<random>.png" }`.
The returned URL is publicly readable and can be placed unchanged in a
generation payload's `media` arrays. Uploading is not a paid generation.

In Coolify, add a persistent volume with container mount path:

```text
/app/storage/assets
```

The volume must persist across redeploys and container recreation. Ensure the
Node.js runtime user can read and write it.

## Submit (asynchronous)

Use a real catalog model and valid settings. Example for Kling 3 Turbo:

```bash
curl -sS -X POST 'https://openhiggsfild.10xscale.agency/api/automation/generate' \
  -H "Authorization: Bearer $AUTOMATION_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"kling-3-turbo","prompt":"Product video, realistic studio light, subtle camera move","settings":{"duration":5,"aspectRatio":"9:16","resolution":"720p"},"media":{}}'
```

Response (202): `{ "requestId": "<provider request id>", "status": "queued" }`.

## Poll status / fetch result

```bash
curl -sS 'https://openhiggsfild.10xscale.agency/api/automation/status/<requestId>' \
  -H "Authorization: Bearer $AUTOMATION_API_TOKEN"
```

The provider's status response may include `video.url` when complete; this is a provider-hosted URL, **not permanent VPS storage**. Persist it separately before expiration if needed. Poll with sensible delay, maximum attempts and an approval gate before each paid generation. Do not poll by starting a new generation.

## Next steps before public/production automation

Add reverse-proxy rate limits + request quota, cost controls, persistent job tracking, and an MCP server or Codex Skill that calls this authenticated REST API. Do not expose this bearer token in client-side browser code or a public Codex repository.
