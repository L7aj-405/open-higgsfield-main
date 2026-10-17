import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/assets/route";
import { GET } from "@/app/assets/[filename]/route";
import {
  AssetStorageError,
  type AssetStorageConfig,
  storeAsset,
} from "@/storage/assets";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

describe.sequential("persistent asset storage", () => {
  let storagePath: string;
  let config: AssetStorageConfig;

  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(tmpdir(), "openhiggsfield-assets-"));
    config = {
      storagePath,
      publicBaseUrl: "https://assets.example.test/assets",
      maxUploadBytes: 1024,
    };
    process.env.ASSET_STORAGE_PATH = storagePath;
    process.env.ASSET_PUBLIC_BASE_URL = config.publicBaseUrl;
    process.env.ASSET_MAX_UPLOAD_BYTES = String(config.maxUploadBytes);
    process.env.AUTOMATION_API_TOKEN = "a".repeat(32);
  });

  afterEach(async () => {
    delete process.env.ASSET_STORAGE_PATH;
    delete process.env.ASSET_PUBLIC_BASE_URL;
    delete process.env.ASSET_MAX_UPLOAD_BYTES;
    delete process.env.AUTOMATION_API_TOKEN;
    const resolved = path.resolve(storagePath);
    if (resolved.startsWith(path.resolve(tmpdir()) + path.sep)) {
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it("uploads an image and returns its public HTTPS URL", async () => {
    const form = new FormData();
    form.set("file", new File([PNG_BYTES], "product.png", { type: "image/png" }));
    const request = new NextRequest("https://app.example.test/api/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string };
    expect(body.url).toMatch(
      /^https:\/\/assets\.example\.test\/assets\/[a-f0-9]{48}\.png$/,
    );
    const filename = new URL(body.url).pathname.split("/").pop()!;
    expect(new Uint8Array(await readFile(path.join(storagePath, filename)))).toEqual(PNG_BYTES);
  });

  it("accepts the existing UI credential cookie only from the same origin", async () => {
    const form = new FormData();
    form.set("file", new File([PNG_BYTES], "product.png", { type: "image/png" }));
    const request = new NextRequest("https://app.example.test/api/assets", {
      method: "POST",
      headers: {
        cookie: `api_key=${encodeURIComponent(JSON.stringify({ apiKey: "id:secret" }))}`,
        host: "app.example.test",
        origin: "https://app.example.test",
      },
      body: form,
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });

  it("rejects an unsupported MIME type", async () => {
    await expect(
      storeAsset(new File(["alert(1)"], "payload.js", { type: "text/javascript" }), config),
    ).rejects.toMatchObject({ code: "unsupported_type" } satisfies Partial<AssetStorageError>);
  });

  it("rejects an oversized file", async () => {
    const smallLimit = { ...config, maxUploadBytes: PNG_BYTES.length - 1 };
    await expect(
      storeAsset(new File([PNG_BYTES], "product.png", { type: "image/png" }), smallLimit),
    ).rejects.toMatchObject({ code: "too_large" } satisfies Partial<AssetStorageError>);
  });

  it("ignores path traversal in the original filename", async () => {
    const stored = await storeAsset(
      new File([PNG_BYTES], "../../outside.png", { type: "image/png" }),
      config,
    );
    expect(stored.filename).toMatch(/^[a-f0-9]{48}\.png$/);
    expect(stored.filename).not.toContain("outside");
    expect(path.dirname(path.join(storagePath, stored.filename))).toBe(path.resolve(storagePath));

    const response = await GET(new Request("https://app.example.test/assets/outside.png"), {
      params: Promise.resolve({ filename: "../../outside.png" }),
    });
    expect(response.status).toBe(404);
  });

  it("serves a public asset with immutable cache and safe content headers", async () => {
    const stored = await storeAsset(
      new File([PNG_BYTES], "product.png", { type: "image/png" }),
      config,
    );
    const response = await GET(new Request(stored.url), {
      params: Promise.resolve({ filename: stored.filename }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("generates a unique filename for every upload", async () => {
    const first = await storeAsset(
      new File([PNG_BYTES], "same.png", { type: "image/png" }),
      config,
    );
    const second = await storeAsset(
      new File([PNG_BYTES], "same.png", { type: "image/png" }),
      config,
    );
    expect(first.filename).not.toBe(second.filename);
  });
});
