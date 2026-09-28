import { NextRequest, NextResponse } from "next/server";
import { authorize, platformClient } from "@/automation/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denial = authorize(req);
  if (denial) return denial;
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  try {
    const status = await platformClient().status(id);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Status retrieval failed" }, { status: 502 });
  }
}
