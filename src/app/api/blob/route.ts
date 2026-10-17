import type { NextRequest } from "next/server";

import { POST as uploadAsset } from "@/app/api/assets/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compatibility alias for callers already posting multipart files here. */
export async function POST(request: NextRequest) {
  const response = await uploadAsset(request);
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/assets>; rel="successor-version"');
  return response;
}
