import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_ASSET_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const GENERATED_FILENAME = /^(?<id>[a-f0-9]{48})\.(?<extension>jpg|png|webp|gif|mp4|wav)$/;

type AssetType = {
  extension: "jpg" | "png" | "webp" | "gif" | "mp4" | "wav";
  contentType: string;
  matches: (bytes: Uint8Array) => boolean;
};

const TYPES = new Map<string, AssetType>([
  [
    "image/jpeg",
    {
      extension: "jpg",
      contentType: "image/jpeg",
      matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
    },
  ],
  [
    "image/png",
    {
      extension: "png",
      contentType: "image/png",
      matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  ],
  [
    "image/webp",
    {
      extension: "webp",
      contentType: "image/webp",
      matches: (bytes) => asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP"),
    },
  ],
  [
    "image/gif",
    {
      extension: "gif",
      contentType: "image/gif",
      matches: (bytes) => asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"),
    },
  ],
  [
    "video/mp4",
    {
      extension: "mp4",
      contentType: "video/mp4",
      matches: (bytes) => bytes.length >= 12 && asciiAt(bytes, 4, "ftyp"),
    },
  ],
  [
    "audio/wav",
    {
      extension: "wav",
      contentType: "audio/wav",
      matches: (bytes) => asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE"),
    },
  ],
  [
    "audio/x-wav",
    {
      extension: "wav",
      contentType: "audio/wav",
      matches: (bytes) => asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE"),
    },
  ],
]);

const TYPE_BY_EXTENSION = new Map<string, AssetType>(
  [...TYPES.values()].map((type) => [type.extension, type] as const),
);

export type AssetStorageErrorCode =
  | "invalid_filename"
  | "missing_configuration"
  | "invalid_configuration"
  | "permission_denied"
  | "storage_unavailable"
  | "unsupported_type"
  | "too_large";

export class AssetStorageError extends Error {
  constructor(
    public readonly code: AssetStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AssetStorageError";
  }
}

export type AssetStorageConfig = {
  storagePath: string;
  publicBaseUrl: string;
  maxUploadBytes: number;
};

export type StoredAsset = {
  filename: string;
  url: string;
  contentType: string;
  size: number;
};

export type ReadAsset = {
  bytes: Uint8Array;
  contentType: string;
  size: number;
};

export function readAssetStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): AssetStorageConfig {
  const storagePath = env.ASSET_STORAGE_PATH?.trim();
  const publicBaseUrl = env.ASSET_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!storagePath || !publicBaseUrl) {
    throw new AssetStorageError(
      "missing_configuration",
      "Asset storage is not configured. Set ASSET_STORAGE_PATH and ASSET_PUBLIC_BASE_URL.",
    );
  }
  if (!path.isAbsolute(storagePath)) {
    throw new AssetStorageError(
      "invalid_configuration",
      "ASSET_STORAGE_PATH must be an absolute filesystem path.",
    );
  }
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(publicBaseUrl);
  } catch {
    throw new AssetStorageError(
      "invalid_configuration",
      "ASSET_PUBLIC_BASE_URL must be an absolute HTTPS URL.",
    );
  }
  if (
    parsedBaseUrl.protocol !== "https:" ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw new AssetStorageError(
      "invalid_configuration",
      "ASSET_PUBLIC_BASE_URL must be an absolute HTTPS URL without credentials, query, or fragment.",
    );
  }

  const rawMax = env.ASSET_MAX_UPLOAD_BYTES?.trim();
  const maxUploadBytes = rawMax ? Number(rawMax) : DEFAULT_ASSET_MAX_UPLOAD_BYTES;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new AssetStorageError(
      "invalid_configuration",
      "ASSET_MAX_UPLOAD_BYTES must be a positive integer.",
    );
  }
  return {
    storagePath: path.resolve(storagePath),
    publicBaseUrl,
    maxUploadBytes,
  };
}

export async function storeAsset(
  file: Blob & { name?: string },
  config: AssetStorageConfig = readAssetStorageConfig(),
): Promise<StoredAsset> {
  if (file.size > config.maxUploadBytes) {
    throw new AssetStorageError(
      "too_large",
      `Upload exceeds the ${formatBytes(config.maxUploadBytes)} limit.`,
    );
  }
  const declaredType = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const assetType = TYPES.get(declaredType);
  if (!assetType) {
    throw new AssetStorageError("unsupported_type", "Unsupported media type.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!assetType.matches(bytes)) {
    throw new AssetStorageError(
      "unsupported_type",
      "The file contents do not match the declared media type.",
    );
  }

  await ensureStorageDirectory(config.storagePath);
  for (let attempt = 0; attempt < 5; attempt++) {
    const filename = `${randomBytes(24).toString("hex")}.${assetType.extension}`;
    const destination = safeAssetPath(config.storagePath, filename);
    try {
      const handle = await open(
        /* turbopackIgnore: true */ destination,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o640,
      );
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      return {
        filename,
        url: `${config.publicBaseUrl}/${filename}`,
        contentType: assetType.contentType,
        size: bytes.byteLength,
      };
    } catch (error) {
      if (nodeErrorCode(error) === "EEXIST") continue;
      throw mapFilesystemError(error);
    }
  }
  throw new AssetStorageError(
    "storage_unavailable",
    "Could not allocate a unique asset filename.",
  );
}

export async function readStoredAsset(
  filename: string,
  config: AssetStorageConfig = readAssetStorageConfig(),
): Promise<ReadAsset | null> {
  const match = GENERATED_FILENAME.exec(filename);
  if (!match?.groups?.extension) {
    throw new AssetStorageError("invalid_filename", "Invalid asset filename.");
  }
  const assetType = TYPE_BY_EXTENSION.get(match.groups.extension);
  if (!assetType) {
    throw new AssetStorageError("invalid_filename", "Invalid asset filename.");
  }
  const source = safeAssetPath(config.storagePath, filename);
  try {
    const metadata = await stat(source);
    if (!metadata.isFile()) return null;
    const bytes = await readFile(source);
    return { bytes, contentType: assetType.contentType, size: metadata.size };
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null;
    throw mapFilesystemError(error);
  }
}

function safeAssetPath(storagePath: string, filename: string): string {
  if (!GENERATED_FILENAME.test(filename)) {
    throw new AssetStorageError("invalid_filename", "Invalid asset filename.");
  }
  const root = path.resolve(storagePath);
  const candidate = path.resolve(root, filename);
  if (path.dirname(candidate) !== root) {
    throw new AssetStorageError("invalid_filename", "Invalid asset filename.");
  }
  return candidate;
}

async function ensureStorageDirectory(storagePath: string): Promise<void> {
  try {
    await mkdir(storagePath, { recursive: true, mode: 0o750 });
    const metadata = await stat(storagePath);
    if (!metadata.isDirectory()) {
      throw new AssetStorageError(
        "storage_unavailable",
        "Asset storage path is not a directory.",
      );
    }
  } catch (error) {
    if (error instanceof AssetStorageError) throw error;
    throw mapFilesystemError(error);
  }
}

function mapFilesystemError(error: unknown): AssetStorageError {
  const code = nodeErrorCode(error);
  if (code === "EACCES" || code === "EPERM") {
    return new AssetStorageError(
      "permission_denied",
      "Asset storage permission denied. Check the persistent volume ownership and permissions.",
      { cause: error },
    );
  }
  return new AssetStorageError(
    "storage_unavailable",
    "Asset storage path is unavailable.",
    { cause: error },
  );
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, signature: string): boolean {
  if (bytes.length < offset + signature.length) return false;
  return [...signature].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}
