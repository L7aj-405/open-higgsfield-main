import { NextResponse } from "next/server";

import {
  AssetStorageError,
  readAssetStorageConfig,
  readStoredAsset,
} from "@/storage/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ filename: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  let config;
  try {
    config = readAssetStorageConfig();
    const { filename } = await context.params;
    const asset = await readStoredAsset(filename, config);
    if (!asset) return new NextResponse(null, { status: 404 });
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(asset.size),
        "Content-Type": asset.contentType,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AssetStorageError) {
      if (error.code === "invalid_filename") return new NextResponse(null, { status: 404 });
      const status = error.code === "permission_denied" ? 500 : 503;
      console.error("[assets] retrieval failed", error.message);
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[assets] retrieval failed", error);
    return NextResponse.json({ error: "Asset retrieval failed." }, { status: 500 });
  }
}
