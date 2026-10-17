import { NextRequest, NextResponse } from "next/server";

import { authorize } from "@/automation/common";
import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import {
  AssetStorageError,
  readAssetStorageConfig,
  storeAsset,
} from "@/storage/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denial = authorizeUpload(request);
  if (denial) return denial;

  let config;
  try {
    config = readAssetStorageConfig();
  } catch (error) {
    return storageErrorResponse(error);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > config.maxUploadBytes + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json({ error: "Upload exceeds the configured size limit." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  try {
    const stored = await storeAsset(file, config);
    return NextResponse.json(
      { url: stored.url },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return storageErrorResponse(error);
  }
}

function authorizeUpload(request: NextRequest): NextResponse | null {
  if ((request.headers.get("authorization") ?? "").startsWith("Bearer ")) {
    return authorize(request);
  }
  const credentials = decodeCredentials(request.cookies.get(PLATFORM_KEY_COOKIE)?.value);
  if (!credentials) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin uploads are not allowed" }, { status: 403 });
  }
  return null;
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

function storageErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof AssetStorageError)) {
    console.error("[assets] upload failed", error);
    return NextResponse.json({ error: "Asset upload failed." }, { status: 500 });
  }
  const status =
    error.code === "unsupported_type"
      ? 415
      : error.code === "too_large"
        ? 413
        : error.code === "missing_configuration" || error.code === "invalid_configuration"
          ? 503
          : error.code === "storage_unavailable"
            ? 503
            : 500;
  if (status >= 500) console.error("[assets] upload failed", error.message);
  return NextResponse.json({ error: error.message }, { status });
}
