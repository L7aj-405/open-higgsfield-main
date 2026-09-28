import { NextRequest, NextResponse } from "next/server";
import { authorize, mapVideo, parseVideoInput, platformClient } from "@/automation/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denial = authorize(req);
  if (denial) return denial;
  if (Number(req.headers.get("content-length") ?? 0) > 65536) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let parsed;
  try {
    parsed = parseVideoInput(await req.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
  try {
    const { path, body } = mapVideo(parsed);
    const job = await platformClient().submit(path, body);
    return NextResponse.json({ requestId: job.requestId, status: job.status }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Generation submission failed; check private server logs/provider configuration" }, { status: 502 });
  }
}
