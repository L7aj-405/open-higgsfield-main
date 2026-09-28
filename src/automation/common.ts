
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getModel, parseSettings } from "@/generation/catalog";
import type { GenerationPlane, MediaRole } from "@/generation/catalog/types";
import { createPlatformClient } from "@/generation/platform";
import { toPlatform } from "@/generation/to-platform";

export const runtime = "nodejs";

function equalSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function authorize(req: NextRequest): NextResponse | null {
  const expected = process.env.AUTOMATION_API_TOKEN;
  if (!expected || expected.length < 32) {
    return NextResponse.json({ error: "Automation not configured" }, { status: 503 });
  }
  const authorization = req.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!presented || !equalSecret(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function platformClient() {
  const apiKey = process.env.HF_API_KEY;
  const baseUrl = process.env.HF_API_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("Provider not configured");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("Provider URL must be HTTPS");
  return createPlatformClient({ apiKey, baseUrl });
}

const roles: MediaRole[] = ["start", "end", "reference", "video", "audio"];

export function parseVideoInput(data: unknown): GenerationPlane {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected JSON object");
  const body = data as Record<string, unknown>;
  if (typeof body.model !== "string") throw new Error("Missing model");
  const model = getModel(body.model);
  if (model.surface !== "video") throw new Error("Choose a video model");
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 12000) {
    throw new Error("Prompt must be between 1 and 12000 characters");
  }
  const rawMedia = body.media ?? {};
  if (!rawMedia || typeof rawMedia !== "object" || Array.isArray(rawMedia)) throw new Error("Invalid media");
  const source = rawMedia as Record<string, unknown>;
  if (Object.keys(source).some((role) => !roles.includes(role as MediaRole))) throw new Error("Invalid media role");
  const media: GenerationPlane["media"] = {};
  for (const role of roles) {
    const items = source[role] ?? [];
    if (!Array.isArray(items) || items.length > (model.roles[role] ?? 0)) throw new Error(`Invalid ${role} media count`);
    media[role] = items.map((value, index) => {
      if (typeof value !== "string" || value.length > 4096) throw new Error(`Invalid ${role} URL`);
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Media URLs must use HTTPS");
      return { id: `${role}-${index}`, url: value, role };
    });
  }
  const settings = body.settings ?? {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Invalid settings");
  return {
    model: model.id,
    prompt: { text: body.prompt.trim() },
    media,
    settings: parseSettings(model, settings as Record<string, unknown>),
  };
}

export function mapVideo(input: GenerationPlane) {
  return toPlatform(input);
}
