export async function uploadMedia(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/assets", {
    method: "POST",
    body: form,
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
    url?: unknown;
  } | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Asset upload failed.";
    throw new Error(message);
  }
  if (typeof payload?.url !== "string" || !payload.url.startsWith("https://")) {
    throw new Error("Upload completed without a valid HTTPS asset URL.");
  }
  return { url: payload.url };
}
