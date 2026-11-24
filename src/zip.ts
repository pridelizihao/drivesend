import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import type { ServerResponse } from "node:http"
import { deflateRawSync } from "node:zlib"

/** Stored rather than deflated above this size: the file is streamed, not buffered. */
const STORE_THRESHOLD = 8 * 1024 * 1024

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function updateCrc(crc: number, buf: Uint8Array): number {
  let c = crc
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}

async function crcOfFile(file: string): Promise<{ crc: number; size: number }> {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff
    let size = 0
    const stream = createReadStream(file)
    stream.on("data", (chunk: Buffer) => {
      crc = updateCrc(crc, chunk)
      size += chunk.length
    })
    stream.on("error", reject)
    stream.on("end", () => resolve({ crc: (crc ^ 0xffffffff) >>> 0, size }))
  })
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  return { time, date: day }
}

function localHeader(name: Buffer, method: number, crc: number, csize: number, usize: number, dt: { time: number; date: number }): Buffer {
  const head = Buffer.alloc(30)
  head.writeUInt32LE(0x04034b50, 0)
  head.writeUInt16LE(20, 4)
  head.writeUInt16LE(0x0800, 6)   // UTF-8 file names
  head.writeUInt16LE(method, 8)
  head.writeUInt16LE(dt.time, 10)
  head.writeUInt16LE(dt.date, 12)
  head.writeUInt32LE(crc >>> 0, 14)
  head.writeUInt32LE(csize >>> 0, 18)
  head.writeUInt32LE(usize >>> 0, 22)
  head.writeUInt16LE(name.length, 26)
  head.writeUInt16LE(0, 28)
  return Buffer.concat([head, name])
}

export type ZipEntry = { path: string; file: string; size: number; mtime: number }

export type ZipResult = { entries: number; bytes: number }

/**
 * Streams a ZIP (deflate for small files, stored for large ones so memory stays flat).
 * Not ZIP64: the archive must stay under 4 GB and 65535 entries.
 */
export async function streamZip(res: ServerResponse, entries: ZipEntry[], onDone?: () => void): Promise<ZipResult> {
  const central: Buffer[] = []
  let offset = 0
  let total = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path.split("/").map((p) => p).join("/"), "utf8")
    const dt = dosDateTime(new Date(entry.mtime || Date.now()))
    let method = 8
    let crc = 0
    let csize = 0
    let payload: Buffer | null = null

    if (entry.size >= STORE_THRESHOLD) {
      method = 0
      const info = await crcOfFile(entry.file)
      crc = info.crc
      csize = info.size
    } else {
      const raw = await readFile(entry.file)
      crc = (updateCrc(0xffffffff, raw) ^ 0xffffffff) >>> 0
      const packed = deflateRawSync(raw, { level: 6 })
      if (packed.length >= raw.length) {
        method = 0
        payload = raw
        csize = raw.length
      } else {
        payload = packed
        csize = packed.length
      }
    }

    const header = localHeader(name, method, crc, csize, entry.size, dt)
    res.write(header)
    offset += header.length

    if (payload) {
      res.write(payload)
      offset += payload.length
    } else {
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(entry.file)
        stream.on("error", reject)
        stream.on("end", () => resolve())
        stream.pipe(res, { end: false })
      })
      offset += csize
    }
    total += entry.size

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(dt.time, 12)
    cd.writeUInt16LE(dt.date, 14)
    cd.writeUInt32LE(crc >>> 0, 16)
    cd.writeUInt32LE(csize >>> 0, 20)
    cd.writeUInt32LE(entry.size >>> 0, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset - header.length - csize, 42)
    central.push(Buffer.concat([cd, name]))
  }

  const centralBuf = Buffer.concat(central)
  const centralOffset = offset
  res.write(centralBuf)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)
  res.write(eocd)
  res.end()
  if (onDone) onDone()

  return { entries: entries.length, bytes: total }
}
