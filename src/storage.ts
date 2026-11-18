import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

/** Content-addressed layout: blobs/ab/cd/<sha256>. Sharding keeps directories small. */
export function blobPath(blobsDir: string, hash: string): string {
  return join(blobsDir, hash.slice(0, 2), hash.slice(2, 4), hash)
}

export async function ensureParent(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256")
    const stream = createReadStream(file)
    stream.on("data", (chunk) => h.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(h.digest("hex")))
  })
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

export async function removeQuiet(file: string): Promise<void> {
  await rm(file, { force: true })
}

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
}
