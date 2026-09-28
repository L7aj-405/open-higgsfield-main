# OpenHiggsfield → Codex: Phase 1 (Automation API)

This adds **two** private endpoints. It does not create a Codex connector yet, and cannot generate without real Higgsfield API credentials/credits.

Coolify runtime-only environment variables (never commit secrets):

- `HF_API_BASE_URL`: correct HTTPS base URL from your Higgsfield developer account.
- `HF_API_KEY`: Higgsfield provider key formatted `id:secret` (same credential format used by the existing UI).
- `AUTOMATION_API_TOKEN`: independent random secret, at least 32 characters; generate locally with `openssl rand -hex 32`.
- `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.
- Optional existing `OPEN_HIGGSFIELD_READ_WRITE_TOKEN` is for Vercel Blob **not** the Higgsfield key.

The existing UI can still use its separate browser cookie credentials. Automation routes never read that cookie or accept provider credentials from the request. They require `Authorization: Bearer <AUTOMATION_API_TOKEN>`.

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

Add reverse-proxy rate limits + request quota, authentication for the original UI and existing blob route, cost controls, persistent job tracking and storage, and an MCP server or Codex Skill that calls this authenticated REST API. Do not expose this bearer token in client-side browser code or a public Codex repository.
