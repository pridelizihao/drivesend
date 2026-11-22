import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createReadStream } from "node:fs"
import { mkdir, open as openFd, readFile, rename, stat, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto"
import { openDb } from "./db.ts"
import { MIME, blobPath, ensureParent, fileExists, hashFile, removeQuiet } from "./storage.ts"

const ROOT = resolve(import.meta.dirname, "..")
const WEB = join(ROOT, "web")
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, "data")
const BLOBS = join(DATA, "blobs")
const TMP = join(DATA, "tmp")
const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? "127.0.0.1"
const CHUNK = 4 * 1024 * 1024
const INBOX = "inbox"
const INBOX_TTL_H = Number(process.env.INBOX_TTL_H ?? 24)
const INBOX_TTL = INBOX_TTL_H * 3600 * 1000
const TRASH_TTL_H = Number(process.env.TRASH_TTL_H ?? 720)
const TRASH_TTL = TRASH_TTL_H * 3600 * 1000
const TOKEN = process.env.DS_TOKEN ?? ""
const QUOTA_BYTES = Number(process.env.QUOTA_BYTES ?? 15 * 1024 * 1024 * 1024)
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30)
const RAW_BASE = process.env.BASE_PATH ?? ""
const BASE = RAW_BASE.endsWith("/") ? RAW_BASE.slice(0, RAW_BASE.length - 1) : RAW_BASE

await mkdir(BLOBS, { recursive: true })
await mkdir(TMP, { recursive: true })
const db = openDb(join(DATA, "drive.db"))
db.prepare("INSERT INTO nodes (id, parent_id, name, kind, blob_hash, size, mtime, deleted, created_at, expires_at) VALUES (?, NULL, ?, 'folder', NULL, 0, ?, 0, ?, NULL) ON CONFLICT(id) DO NOTHING").run(INBOX, "传输站", Date.now(), Date.now())

type Upload = {
  id: string
  name: string
  parentId: string | null
  size: number
  hash: string | null
  path: string
  received: number
}

const uploads = new Map<string, Upload>()
const subs = new Set<ServerResponse>()

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  })
  res.end(body)
}

function fail(res: ServerResponse, code: number, message: string): void {
  sendJson(res, code, { error: message })
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const parts: Buffer[] = []
    let total = 0
    req.on("data", (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
        rejectPromise(new Error("body too large"))
        req.destroy()
        return
      }
      parts.push(chunk)
    })
    req.on("end", () => resolvePromise(Buffer.concat(parts)))
    req.on("error", rejectPromise)
  })
}

async function readJson(req: IncomingMessage): Promise<any> {
  const buf = await readBody(req, 2 * 1024 * 1024)
  if (buf.length === 0) return {}
  try {
    return JSON.parse(buf.toString("utf8"))
  } catch {
    throw new Error("invalid json")
  }
}

function sanitizeName(raw: unknown): string {
  const name = String(raw ?? "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim()
  return name.slice(0, 200) || "未命名"
}

function uniqueName(parentId: string | null, name: string): string {
  const hit = db.prepare("SELECT 1 FROM nodes WHERE parent_id IS ? AND name = ? AND deleted = 0").get(parentId, name)
  if (!hit) return name
  const dot = name.lastIndexOf(".")
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  for (let i = 1; i < 999; i++) {
    const cand = base + " (" + i + ")" + ext
    const dup = db.prepare("SELECT 1 FROM nodes WHERE parent_id IS ? AND name = ? AND deleted = 0").get(parentId, cand)
    if (!dup) return cand
  }
  return base + " (" + Date.now() + ")" + ext
}

function createNode(kind: string, name: string, parentId: string | null, size: number, hash: string | null, expiresAt: number | null = null): string {
  const id = randomUUID()
  const ts = Date.now()
  db.prepare(
    "INSERT INTO nodes (id, parent_id, name, kind, blob_hash, size, mtime, deleted, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
  ).run(id, parentId, uniqueName(parentId, name), kind, hash, size, ts, ts, expiresAt)
  return id
}

function createFileNode(name: string, parentId: string | null, size: number, hash: string, expiresAt: number | null = null): string {
  const id = createNode("file", name, parentId, size, hash, expiresAt)
  db.prepare("INSERT INTO blobs (hash, size, refs, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(hash) DO NOTHING").run(hash, size, Date.now())
  db.prepare("UPDATE blobs SET refs = refs + 1 WHERE hash = ?").run(hash)
  return id
}

/** Soft delete: the subtree moves to the trash, content is retained. */
function deleteTree(id: string): void {
  const now = Date.now()
  const stack: string[] = [id]
  const touched: string[] = []
  let guard = 0
  while (stack.length > 0 && guard++ < 100000) {
    const current = stack.pop() as string
    db.prepare("UPDATE nodes SET deleted = 1, deleted_at = ? WHERE id = ? AND deleted = 0").run(now, current)
    touched.push(current)
    const children = db.prepare("SELECT id FROM nodes WHERE parent_id = ? AND deleted = 0").all(current) as any[]
    for (const child of children) stack.push(child.id)
  }
  for (const nodeId of touched) db.prepare("DELETE FROM shares WHERE node_id = ?").run(nodeId)
}

/** Hard delete: rows disappear and blob references are dropped. Used by purge and by 传输站 burn. */
function purgeTree(id: string): string[] {
  const hashes: string[] = []
  const stack: string[] = [id]
  let guard = 0
  while (stack.length > 0 && guard++ < 100000) {
    const current = stack.pop() as string
    const children = db.prepare("SELECT id FROM nodes WHERE parent_id = ?").all(current) as any[]
    for (const child of children) stack.push(child.id)
    const row = db.prepare("SELECT blob_hash FROM nodes WHERE id = ?").get(current) as any
    if (row && row.blob_hash) hashes.push(row.blob_hash)
    db.prepare("DELETE FROM shares WHERE node_id = ?").run(current)
    db.prepare("DELETE FROM nodes WHERE id = ?").run(current)
  }
  for (const hash of hashes) {
    db.prepare("UPDATE blobs SET refs = refs - 1 WHERE hash = ?").run(hash)
  }
  return hashes
}

async function collectGarbage(hashes: string[] | null): Promise<void> {
  try {
    const rows = hashes
      ? hashes.map((hash) => ({ hash }))
      : (db.prepare("SELECT hash FROM blobs WHERE refs <= 0 AND created_at < ?").all(Date.now() - 3600 * 1000) as any[])
    for (const row of rows) {
      const live = db.prepare("SELECT refs FROM blobs WHERE hash = ?").get(row.hash) as any
      if (live && live.refs > 0) continue
      await removeQuiet(blobPath(BLOBS, row.hash))
      db.prepare("DELETE FROM blobs WHERE hash = ?").run(row.hash)
    }
  } catch (err: any) {
    console.error("[gc]", err?.message)
  }
}

function subtreeIds(id: string): string[] {
  const out: string[] = []
  const stack: string[] = [id]
  let guard = 0
  while (stack.length > 0 && guard++ < 100000) {
    const current = stack.pop() as string
    out.push(current)
    const children = db.prepare("SELECT id FROM nodes WHERE parent_id = ?").all(current) as any[]
    for (const child of children) stack.push(child.id)
  }
  return out
}

function subscribe(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  })
  res.write(": connected\n\n")
  subs.add(res)
  req.on("close", () => {
    subs.delete(res)
  })
}

function broadcast(event: string, data: unknown): void {
  const payload = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"
  for (const client of subs) client.write(payload)
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")
  return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(name)
}

/**
 * Types we are willing to render inline (in the same origin as the app).
 * SVG and HTML are excluded on purpose: they can execute script and would get
 * access to the session cookie. Everything else falls back to a download.
 */
function previewableType(type: string): boolean {
  if (type.startsWith("image/")) return !type.includes("svg")
  if (type === "application/pdf") return true
  if (type.startsWith("video/")) return true
  if (type.startsWith("audio/")) return true
  if (type === "application/json; charset=utf-8") return true
  if (type.startsWith("text/") && !type.includes("html")) return true
  return false
}

async function streamFile(req: IncomingMessage, res: ServerResponse, file: string, name: string, inline = false): Promise<void> {
  const info = await stat(file)
  const type = MIME[extname(name).toLowerCase()] ?? "application/octet-stream"
  const range = req.headers.range
  const allowInline = inline && previewableType(type)
  const base: Record<string, string | number> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "content-disposition": allowInline ? contentDisposition(name).replace(/^attachment/, "inline") : contentDisposition(name),
    "cache-control": "private, max-age=0",
    "x-content-type-options": "nosniff",
  }
  if (allowInline && !type.startsWith("text/")) base["content-security-policy"] = "sandbox"
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1
      if (start <= end && start < info.size) {
        res.writeHead(206, { ...base, "content-range": "bytes " + start + "-" + end + "/" + info.size, "content-length": end - start + 1 } as any)
        createReadStream(file, { start, end }).pipe(res)
        return
      }
    }
    res.writeHead(416, { "content-range": "bytes */" + info.size })
    res.end()
    return
  }
  res.writeHead(200, { ...base, "content-length": info.size } as any)
  createReadStream(file).pipe(res)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function humanSize(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024
    i++
  }
  return (i === 0 ? String(v) : v.toFixed(1)) + " " + units[i]
}

function sharePage(name: string, size: number, token: string, expiresAt: number | null): string {
  const exp = expiresAt ? new Date(expiresAt).toLocaleString("zh-CN") : "永久有效"
  const lines = [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>" + escapeHtml(name) + " · DriveSend</title>",
    "<style>",
    "html,body{height:100%}",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}",
    "body::before{content:'';position:fixed;inset:-25vmax;z-index:-1;background:radial-gradient(38vmax 38vmax at 10% 8%,rgba(122,178,255,.55),transparent 62%),radial-gradient(32vmax 32vmax at 88% 2%,rgba(255,176,212,.5),transparent 60%),radial-gradient(40vmax 40vmax at 78% 88%,rgba(150,226,208,.5),transparent 62%);filter:blur(40px) saturate(120%)}",
    ".card{width:min(520px,90vw);background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);border:1px solid rgba(255,255,255,.9);border-radius:22px;padding:30px;box-shadow:0 18px 50px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.04)}",
    ".kicker{color:#86868b;font-size:11px;letter-spacing:.14em;text-transform:uppercase}",
    "h1{font-size:21px;margin:10px 0 6px;word-break:break-all;letter-spacing:-.015em}",
    ".meta{color:#6e6e73;font-size:13px;margin-bottom:22px}",
    "a.btn{display:block;text-align:center;padding:13px;border-radius:980px;background:linear-gradient(180deg,#0a84ff,#0071e3);color:#fff;text-decoration:none;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.24)}",
    "a.btn:hover{filter:brightness(1.06)}",
    "</style>",
    "<div class=\"card\">",
    "<div class=\"kicker\">DriveSend 分享</div>",
    "<h1>" + escapeHtml(name) + "</h1>",
    "<div class=\"meta\">" + humanSize(size) + " · " + exp + "</div>",
    "<a class=\"btn\" href=\"" + BASE + "/s/" + token + "/download\">下载</a>",
    "</div>",
  ]
  return lines.join("\n")
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  const file = resolve(WEB, rel)
  if (!file.startsWith(WEB)) {
    fail(res, 403, "forbidden")
    return
  }
  if (!(await fileExists(file))) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
    res.end("404")
    return
  }
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream"
  const body = await readFile(file)
  res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "no-cache" })
  res.end(body)
}

function stats() {
  const physical = (db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM blobs WHERE refs > 0").get() as any).s as number
  const logical = (db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM nodes WHERE deleted = 0 AND kind = 'file'").get() as any).s as number
  const files = (db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE deleted = 0 AND kind = 'file'").get() as any).c as number
  const blobs = (db.prepare("SELECT COUNT(*) AS c FROM blobs WHERE refs > 0").get() as any).c as number
  const trashBytes = (db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM nodes WHERE deleted = 1 AND kind = 'file'").get() as any).s as number
  const trashFiles = (db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE deleted = 1 AND kind = 'file'").get() as any).c as number
  return { physicalBytes: physical, logicalBytes: logical, files, blobs, trashBytes, trashFiles, savedBytes: Math.max(0, logical - physical) }
}

function inboxSummary() {
  const row = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS s FROM nodes WHERE parent_id = ? AND deleted = 0 AND kind = 'file'").get(INBOX) as any
  return { count: row.c as number, bytes: row.s as number }
}

function loginPage(): string {
  const lines = [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>DriveSend · 登录</title>",
    "<style>",
    "html,body{height:100%}",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}",
    "body::before{content:'';position:fixed;inset:-25vmax;z-index:-1;background:radial-gradient(38vmax 38vmax at 10% 8%,rgba(122,178,255,.55),transparent 62%),radial-gradient(32vmax 32vmax at 88% 2%,rgba(255,176,212,.5),transparent 60%),radial-gradient(40vmax 40vmax at 78% 88%,rgba(150,226,208,.5),transparent 62%);filter:blur(40px) saturate(120%)}",
    ".card{width:min(380px,90vw);background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);border:1px solid rgba(255,255,255,.9);border-radius:22px;padding:28px;box-shadow:0 18px 50px rgba(0,0,0,.1)}",
    "h1{font-size:19px;margin:0 0 6px;letter-spacing:-.015em}",
    "p{color:#6e6e73;font-size:13px;margin:0 0 18px}",
    "input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.9);color:#1d1d1f;font-size:14px;outline:none}",
    "input:focus{border-color:rgba(0,113,227,.6);box-shadow:0 0 0 4px rgba(0,113,227,.12)}",
    "input+input{margin-top:10px}",
    ".err{color:#d70015;font-size:12px;min-height:16px;margin-top:8px}",
    "button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:980px;background:linear-gradient(180deg,#0a84ff,#0071e3);color:#fff;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.24)}",
    "</style>",
    "<form class=\"card\" id=\"f\">",
    "<h1>DriveSend</h1>",
    "<p id=\"hint\">登录以继续</p>",
    "<input id=\"u\" name=\"username\" placeholder=\"用户名\" autocomplete=\"username\" autofocus>",
    "<input id=\"p\" name=\"password\" type=\"password\" placeholder=\"密码\" autocomplete=\"current-password\">",
    "<input id=\"p2\" type=\"password\" placeholder=\"再输入一次密码\" hidden>",
    "<div id=\"err\" class=\"err\"></div>",
    "<button id=\"go\">登录</button>",
    "</form>",
    "<script>",
    "const BASE=" + JSON.stringify(BASE) + ";",
    "let setup=false;",
    "fetch(BASE+'/api/auth/me',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{",
    "  if(d.setupRequired){setup=true;document.getElementById('hint').textContent='第一次使用，创建一个账户';document.getElementById('go').textContent='创建账户';document.getElementById('p').setAttribute('autocomplete','new-password');document.getElementById('p2').hidden=false;}",
    "}).catch(()=>{});",
    "document.getElementById('f').addEventListener('submit',async(e)=>{",
    "  e.preventDefault();",
    "  const u=document.getElementById('u').value.trim();",
    "  const p=document.getElementById('p').value;",
    "  const p2=document.getElementById('p2').value;",
    "  const err=document.getElementById('err');",
    "  err.textContent='';",
    "  if(setup&&p!==p2){err.textContent='两次输入的密码不一致';return;}",
    "  const url=BASE+(setup?'/api/auth/setup':'/api/auth/login');",
    "  const res=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,password:p})});",
    "  if(res.ok){location.href=BASE+'/';return;}",
    "  let msg='登录失败';try{const d=await res.json();if(d.error)msg=d.error;}catch(_){}err.textContent=msg;",
    "});",
    "</script>",
  ]
  return lines.join("\n")
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex")
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), "hex")
  const target = Buffer.from(expected, "hex")
  if (actual.length !== target.length) return false
  return timingSafeEqual(actual, target)
}

function userCount(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM users").get() as any).c as number
}

function sessionUser(req: IncomingMessage): any | null {
  const token = readCookie(req, "ds_session")
  if (!token) return null
  const row = db.prepare(
    "SELECT s.token, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token) as any
  if (!row) return null
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token)
    return null
  }
  return row
}

function createSession(userId: string): string {
  const token = randomBytes(24).toString("base64url")
  const now = Date.now()
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    token, userId, now, now + SESSION_DAYS * 86400000
  )
  return token
}

function authEnabled(): boolean {
  return TOKEN !== "" || userCount() > 0
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function throttled(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return false
  }
  entry.count += 1
  return entry.count > 10
}

function usedBytes(): number {
  return (db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM nodes WHERE kind = 'file'").get() as any).s as number
}

function readCookie(req: IncomingMessage, key: string): string | null {
  const raw = String(req.headers.cookie ?? "")
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=")
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === key) return part.slice(idx + 1).trim()
  }
  return null
}

function authed(req: IncomingMessage, url: URL): boolean {
  if (sessionUser(req)) return true
  if (!TOKEN) return false
  if (String(req.headers.authorization ?? "") === "Bearer " + TOKEN) return true
  if (readCookie(req, "ds_token") === TOKEN) return true
  if (url.searchParams.get("token") === TOKEN) return true
  return false
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost")
  const path = url.pathname
  const method = req.method ?? "GET"

  if (method === "POST" && path === "/api/auth/setup") {
    if (userCount() > 0) return fail(res, 400, "账户已存在")
    const body = await readJson(req)
    const username = String(body.username ?? "").trim()
    const password = String(body.password ?? "")
    if (username.length < 2) return fail(res, 400, "用户名至少 2 个字符")
    if (password.length < 6) return fail(res, 400, "密码至少 6 位")
    const salt = randomBytes(16).toString("hex")
    const id = randomUUID()
    db.prepare("INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id, username, hashPassword(password, salt), salt, Date.now()
    )
    const session = createSession(id)
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "ds_session=" + session + "; Path=" + (BASE === "" ? "/" : BASE + "/") + "; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400,
    })
    res.end(JSON.stringify({ ok: true, user: { id, username } }))
    return
  }

  if (method === "POST" && path === "/api/auth/login") {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "local").split(",")[0].trim()
    if (throttled(ip)) return fail(res, 429, "尝试次数过多，请稍后再试")
    const body = await readJson(req)
    const username = String(body.username ?? "").trim()
    const password = String(body.password ?? "")
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any
    if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
      return fail(res, 401, "用户名或密码不正确")
    }
    db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(Date.now(), user.id)
    const session = createSession(user.id)
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "ds_session=" + session + "; Path=" + (BASE === "" ? "/" : BASE + "/") + "; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400,
    })
    res.end(JSON.stringify({ ok: true, user: { id: user.id, username: user.username } }))
    return
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const token = readCookie(req, "ds_session")
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token)
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "ds_session=; Path=" + (BASE === "" ? "/" : BASE + "/") + "; HttpOnly; SameSite=Lax; Max-Age=0",
    })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (method === "GET" && path === "/api/auth/me") {
    const user = sessionUser(req)
    return sendJson(res, 200, {
      user: user ? { id: user.id, username: user.username } : null,
      setupRequired: userCount() === 0,
      authEnabled: authEnabled(),
    })
  }

  if (authEnabled()) {
    const supplied = url.searchParams.get("token")
    if (supplied && TOKEN && supplied === TOKEN) {
      res.writeHead(302, {
        "set-cookie": "ds_token=" + TOKEN + "; Path=" + (BASE === "" ? "/" : BASE + "/") + "; HttpOnly; SameSite=Lax; Max-Age=2592000",
        location: BASE + "/",
      })
      res.end()
      return
    }
    // The bearer/cookie token is the break-glass key: it works even before the
    // first account exists, so locking yourself out is recoverable.
    const tokenOk = TOKEN !== "" && (
      String(req.headers.authorization ?? "") === "Bearer " + TOKEN || readCookie(req, "ds_token") === TOKEN
    )
    if (!tokenOk && userCount() === 0 && !path.startsWith("/s/")) {
      if (path.startsWith("/api/")) return fail(res, 401, "请先创建账户")
      res.writeHead(401, { "content-type": "text/html; charset=utf-8" })
      res.end(loginPage())
      return
    }
    if (!path.startsWith("/s/") && !authed(req, url)) {
      if (path.startsWith("/api/")) return fail(res, 401, "unauthorized")
      res.writeHead(401, { "content-type": "text/html; charset=utf-8" })
      res.end(loginPage())
      return
    }
  }

  if (method === "GET" && path.startsWith("/api/events")) {
    subscribe(req, res)
    return
  }

  if (method === "GET" && path === "/api/state") {
    const user = sessionUser(req)
    return sendJson(res, 200, {
      stats: stats(),
      inbox: inboxSummary(),
      storage: { usedBytes: usedBytes(), quotaBytes: QUOTA_BYTES },
      user: user ? { username: user.username } : null,
    })
  }

  if (method === "GET" && path === "/api/files") {
    const parent = url.searchParams.get("parent") || null
    if (parent) {
      const exists = db.prepare("SELECT 1 FROM nodes WHERE id = ? AND deleted = 0").get(parent)
      if (!exists) return fail(res, 404, "folder not found")
    }
    const rows = db.prepare("SELECT id, name, kind, size, blob_hash, mtime FROM nodes WHERE parent_id IS ? AND deleted = 0 AND id <> 'inbox' ORDER BY (kind = 'folder') DESC, name COLLATE NOCASE ASC").all(parent) as any[]
    const crumbs: Array<{ id: string; name: string }> = []
    let cur = parent
    let guard = 0
    while (cur && guard++ < 64) {
      const row = db.prepare("SELECT id, parent_id, name FROM nodes WHERE id = ?").get(cur) as any
      if (!row) break
      crumbs.unshift({ id: row.id, name: row.name })
      cur = row.parent_id
    }
    return sendJson(res, 200, {
      parent,
      breadcrumb: crumbs,
      items: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, size: r.size, hash: r.blob_hash, mtime: r.mtime })),
    })
  }

  if (method === "POST" && path === "/api/folders") {
    const body = await readJson(req)
    const id = createNode("folder", sanitizeName(body.name), body.parentId || null, 0, null)
    return sendJson(res, 200, { id })
  }

  if (method === "POST" && path === "/api/upload/init") {
    const body = await readJson(req)
    const name = sanitizeName(body.name)
    const size = Number(body.size ?? 0)
    const hash = typeof body.hash === "string" && /^[a-f0-9]{64}$/.test(body.hash) ? body.hash : null
    const parentId = body.parentId || null
    const expiresAt = parentId === INBOX ? Date.now() + INBOX_TTL : null
    const alreadyStored = hash ? (db.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(hash) !== undefined && await fileExists(blobPath(BLOBS, hash as string))) : false
    if (!alreadyStored && usedBytes() + size > QUOTA_BYTES) {
      return fail(res, 413, "空间不足，仅剩 " + humanSize(Math.max(0, QUOTA_BYTES - usedBytes())))
    }
    if (hash) {
      const blob = db.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(hash)
      if (blob && (await fileExists(blobPath(BLOBS, hash)))) {
        if (parentId === INBOX) {
          const existing = db.prepare("SELECT id FROM nodes WHERE parent_id = ? AND blob_hash = ? AND deleted = 0 AND kind = 'file'").get(INBOX, hash) as any
          if (existing) {
            db.prepare("UPDATE nodes SET mtime = ?, expires_at = ? WHERE id = ?").run(Date.now(), Date.now() + INBOX_TTL, existing.id)
            broadcast("inbox", { name, size })
            return sendJson(res, 200, { instant: true, nodeId: existing.id, duplicated: true })
          }
        }
        const nodeId = createFileNode(name, parentId, size, hash, expiresAt)
        if (parentId === INBOX) broadcast("inbox", { name, size })
        else broadcast("files", { nodeId })
        return sendJson(res, 200, { instant: true, nodeId })
      }
    }
    const id = randomUUID()
    const upload: Upload = { id, name, parentId, size, hash, path: join(TMP, id + ".part"), received: 0 }
    uploads.set(id, upload)
    return sendJson(res, 200, { instant: false, uploadId: id, chunkSize: CHUNK })
  }

  const chunkMatch = /^\/api\/upload\/([0-9a-f-]+)$/.exec(path)
  if (chunkMatch && (method === "PUT" || method === "GET")) {
    const upload = uploads.get(chunkMatch[1])
    if (!upload) return fail(res, 404, "upload not found")
    if (method === "GET") return sendJson(res, 200, { received: upload.received, size: upload.size })
    const offset = Number(url.searchParams.get("offset") ?? 0)
    const buf = await readBody(req, CHUNK + 1024)
    if (buf.length === 0) return sendJson(res, 200, { received: upload.received })
    if (offset + buf.length > upload.size + 1024) return fail(res, 400, "chunk exceeds declared size")
    const fh = await openFd(upload.path, "a+")
    try {
      await fh.write(buf, 0, buf.length, offset)
    } finally {
      await fh.close()
    }
    upload.received = Math.max(upload.received, offset + buf.length)
    return sendJson(res, 200, { received: upload.received })
  }

  const completeMatch = /^\/api\/upload\/([0-9a-f-]+)\/complete$/.exec(path)
  if (completeMatch && method === "POST") {
    const upload = uploads.get(completeMatch[1])
    if (!upload) return fail(res, 404, "upload not found")
    uploads.delete(upload.id)
    if (upload.size === 0 && !(await fileExists(upload.path))) await writeFile(upload.path, Buffer.alloc(0))
    const info = await stat(upload.path)
    if (upload.size > 0 && info.size !== upload.size) {
      await removeQuiet(upload.path)
      return fail(res, 400, "size mismatch: sent " + info.size + " expected " + upload.size)
    }
    const actual = await hashFile(upload.path)
    if (upload.hash && upload.hash !== actual) {
      await removeQuiet(upload.path)
      return fail(res, 400, "hash mismatch")
    }
    const target = blobPath(BLOBS, actual)
    await ensureParent(target)
    if (await fileExists(target)) {
      await removeQuiet(upload.path)
    } else {
      await rename(upload.path, target)
    }
    if (usedBytes() + info.size > QUOTA_BYTES) {
      await removeQuiet(upload.path)
      return fail(res, 413, "空间不足")
    }
    const toInbox = upload.parentId === INBOX
    if (toInbox) {
      const existing = db.prepare("SELECT id FROM nodes WHERE parent_id = ? AND blob_hash = ? AND deleted = 0 AND kind = 'file'").get(INBOX, actual) as any
      if (existing) {
        db.prepare("UPDATE nodes SET mtime = ?, expires_at = ? WHERE id = ?").run(Date.now(), Date.now() + INBOX_TTL, existing.id)
        broadcast("inbox", { name: upload.name, size: info.size })
        return sendJson(res, 200, { nodeId: existing.id, hash: actual, size: info.size, instant: false, duplicated: true })
      }
    }
    const nodeId = createFileNode(upload.name, upload.parentId, info.size, actual, toInbox ? Date.now() + INBOX_TTL : null)
    if (toInbox) broadcast("inbox", { name: upload.name, size: info.size })
    else broadcast("files", { nodeId })
    return sendJson(res, 200, { nodeId, hash: actual, size: info.size, instant: false })
  }

  if (method === "GET" && path === "/api/pair-url") {
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim() || "http"
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim()
    const suffix = TOKEN ? "/?token=" + encodeURIComponent(TOKEN) : "/"
    return sendJson(res, 200, { url: proto + "://" + host + BASE + suffix })
  }

  const renameMatch = /^\/api\/nodes\/([0-9a-f-]+)\/rename$/.exec(path)
  if (renameMatch && method === "POST") {
    const body = await readJson(req)
    const node = db.prepare("SELECT id, name, parent_id FROM nodes WHERE id = ? AND deleted = 0").get(renameMatch[1]) as any
    if (!node) return fail(res, 404, "not found")
    if (node.id === INBOX) return fail(res, 400, "传输站不能改名")
    const name = sanitizeName(body.name)
    if (name === node.name) return sendJson(res, 200, { ok: true, name })
    const finalName = uniqueName(node.parent_id, name)
    db.prepare("UPDATE nodes SET name = ?, mtime = ? WHERE id = ?").run(finalName, Date.now(), node.id)
    broadcast("files", { renamed: node.id })
    return sendJson(res, 200, { ok: true, name: finalName })
  }

  const moveMatch = /^\/api\/nodes\/([0-9a-f-]+)\/move$/.exec(path)
  if (moveMatch && method === "POST") {
    const body = await readJson(req)
    const target = body.parentId || null
    const node = db.prepare("SELECT id, name, parent_id FROM nodes WHERE id = ? AND deleted = 0").get(moveMatch[1]) as any
    if (!node) return fail(res, 404, "not found")
    if (target === INBOX) return fail(res, 400, "不能移动到传输站")
    if (target) {
      const parent = db.prepare("SELECT id, kind FROM nodes WHERE id = ? AND deleted = 0").get(target) as any
      if (!parent || parent.kind !== "folder") return fail(res, 400, "目标不是文件夹")
      let cursor: string | null = target
      let guard = 0
      while (cursor && guard++ < 200) {
        if (cursor === node.id) return fail(res, 400, "不能移动到自己或自己的子文件夹")
        const row = db.prepare("SELECT parent_id FROM nodes WHERE id = ?").get(cursor) as any
        cursor = row ? row.parent_id : null
      }
    }
    if ((node.parent_id ?? null) === target) return sendJson(res, 200, { ok: true, name: node.name, unchanged: true })
    const name = uniqueName(target, node.name)
    db.prepare("UPDATE nodes SET parent_id = ?, name = ?, mtime = ? WHERE id = ?").run(target, name, Date.now(), node.id)
    broadcast("files", { moved: node.id })
    return sendJson(res, 200, { ok: true, name })
  }

  const deleteMatch = /^\/api\/nodes\/([0-9a-f-]+)$/.exec(path)
  if (deleteMatch && method === "DELETE") {
    if (deleteMatch[1] === INBOX) return fail(res, 400, "不能删除传输站")
    if (url.searchParams.get("purge") === "1") {
      const node = db.prepare("SELECT id FROM nodes WHERE id = ?").get(deleteMatch[1]) as any
      if (!node) return fail(res, 404, "not found")
      const hashes = purgeTree(node.id)
      await collectGarbage(hashes)
      broadcast("files", { deleted: node.id })
      return sendJson(res, 200, { ok: true, purged: true })
    }
    const node = db.prepare("SELECT 1 FROM nodes WHERE id = ? AND deleted = 0").get(deleteMatch[1])
    if (!node) return fail(res, 404, "not found")
    deleteTree(deleteMatch[1])
    broadcast("files", { deleted: deleteMatch[1] })
    return sendJson(res, 200, { ok: true })
  }

  const restoreMatch = /^\/api\/nodes\/([0-9a-f-]+)\/restore$/.exec(path)
  if (restoreMatch && method === "POST") {
    const node = db.prepare("SELECT id, name, parent_id, deleted FROM nodes WHERE id = ?").get(restoreMatch[1]) as any
    if (!node) return fail(res, 404, "not found")
    if (node.id === INBOX) return fail(res, 400, "传输站不能恢复")
    let parent = node.parent_id ?? null
    if (parent) {
      const row = db.prepare("SELECT id, deleted FROM nodes WHERE id = ?").get(parent) as any
      if (!row || row.deleted === 1) parent = null
    }
    const name = uniqueName(parent, node.name)
    const ids = subtreeIds(node.id)
    const stamp = Date.now()
    for (const id of ids) {
      db.prepare("UPDATE nodes SET deleted = 0, deleted_at = NULL WHERE id = ?").run(id)
    }
    db.prepare("UPDATE nodes SET parent_id = ?, name = ?, mtime = ? WHERE id = ?").run(parent, name, stamp, node.id)
    broadcast("files", { restored: node.id })
    return sendJson(res, 200, { ok: true, name, movedToRoot: (node.parent_id ?? null) !== parent })
  }

  if (method === "GET" && path === "/api/trash") {
    const rows = db.prepare(
      "SELECT n.id, n.name, n.kind, n.size, n.deleted_at, n.parent_id FROM nodes n WHERE n.deleted = 1 AND n.id <> ? " +
      "AND (n.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM nodes p WHERE p.id = n.parent_id AND p.deleted = 1)) " +
      "ORDER BY n.deleted_at DESC LIMIT 200"
    ).all(INBOX) as any[]
    const now = Date.now()
    return sendJson(res, 200, {
      items: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, size: r.size, deletedAt: r.deleted_at, purgeAt: r.deleted_at + TRASH_TTL })),
      purgeInDays: Math.round(TRASH_TTL / 86400000),
      now,
    })
  }

  if (method === "DELETE" && path === "/api/trash") {
    const rows = db.prepare(
      "SELECT n.id FROM nodes n WHERE n.deleted = 1 AND n.id <> ? " +
      "AND (n.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM nodes p WHERE p.id = n.parent_id AND p.deleted = 1))"
    ).all(INBOX) as any[]
    const hashes: string[] = []
    for (const row of rows) hashes.push(...purgeTree(row.id))
    await collectGarbage(hashes)
    broadcast("files", { emptied: true })
    return sendJson(res, 200, { ok: true, removed: rows.length })
  }

  if (method === "GET" && path === "/api/search") {
    const raw = (url.searchParams.get("q") ?? "").trim()
    if (!raw) return sendJson(res, 200, { items: [], query: "" })
    const like = "%" + raw.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%"
    const rows = db.prepare(
      "SELECT id, name, kind, size, parent_id, mtime FROM nodes WHERE deleted = 0 AND id <> ? AND name LIKE ? ESCAPE '\\' ORDER BY mtime DESC LIMIT 100"
    ).all(INBOX, like) as any[]
    const items = rows.map((r) => {
      const path: string[] = []
      let cur = r.parent_id
      let guard = 0
      while (cur && guard++ < 64) {
        const row = db.prepare("SELECT id, name, parent_id FROM nodes WHERE id = ?").get(cur) as any
        if (!row) break
        path.unshift(row.name)
        cur = row.parent_id
      }
      return { id: r.id, name: r.name, kind: r.kind, size: r.size, parentId: r.parent_id, mtime: r.mtime, path: path.join(" / ") }
    })
    return sendJson(res, 200, { items, query: raw })
  }

  if (method === "GET" && path === "/api/inbox") {
    const rows = db.prepare("SELECT id, name, size, mtime, expires_at FROM nodes WHERE parent_id = ? AND deleted = 0 AND kind = 'file' ORDER BY mtime DESC LIMIT 100").all(INBOX) as any[]
    return sendJson(res, 200, {
      items: rows.map((r) => ({ id: r.id, name: r.name, size: r.size, at: r.mtime, expiresAt: r.expires_at })),
      ttlHours: INBOX_TTL_H,
    })
  }

  const downloadMatch = /^\/api\/download\/([0-9a-f-]+)$/.exec(path)
  if (downloadMatch && method === "GET") {
    const row = db.prepare("SELECT id, name, blob_hash FROM nodes WHERE id = ? AND deleted = 0 AND kind = 'file'").get(downloadMatch[1]) as any
    if (!row || !row.blob_hash) return fail(res, 404, "not found")
    const file = blobPath(BLOBS, row.blob_hash)
    if (!(await fileExists(file))) return fail(res, 410, "blob missing")
    if (url.searchParams.get("burn") === "1") {
      res.on("finish", () => {
        const hashes = purgeTree(row.id)
        collectGarbage(hashes)
        broadcast("files", { deleted: row.id })
      })
    }
    const inline = url.searchParams.get("inline") === "1"
    return streamFile(req, res, file, row.name, inline)
  }

  if (method === "POST" && path === "/api/shares") {
    const body = await readJson(req)
    const node = db.prepare("SELECT id, kind FROM nodes WHERE id = ? AND deleted = 0").get(body.nodeId) as any
    if (!node) return fail(res, 404, "not found")
    if (node.kind !== "file") return fail(res, 400, "only files can be shared for now")
    const hours = Number(body.ttlHours ?? 0)
    const expiresAt = hours > 0 ? Date.now() + hours * 3600 * 1000 : null
    const token = randomBytes(12).toString("base64url")
    db.prepare("INSERT INTO shares (token, node_id, expires_at, created_at, downloads) VALUES (?, ?, ?, ?, 0)").run(token, node.id, expiresAt, Date.now())
    return sendJson(res, 200, { token, expiresAt, url: BASE + "/s/" + token })
  }

  if (method === "GET" && path === "/api/shares") {
    const rows = db.prepare("SELECT s.token, s.expires_at, s.created_at, s.downloads, n.name, n.size FROM shares s JOIN nodes n ON n.id = s.node_id WHERE n.deleted = 0 ORDER BY s.created_at DESC LIMIT 100").all() as any[]
    return sendJson(res, 200, {
      items: rows.map((r) => ({ token: r.token, name: r.name, size: r.size, expiresAt: r.expires_at, createdAt: r.created_at, downloads: r.downloads, url: BASE + "/s/" + r.token, expired: r.expires_at !== null && r.expires_at < Date.now() })),
    })
  }

  const shareDel = /^\/api\/shares\/([A-Za-z0-9_-]+)$/.exec(path)
  if (shareDel && method === "DELETE") {
    db.prepare("DELETE FROM shares WHERE token = ?").run(shareDel[1])
    return sendJson(res, 200, { ok: true })
  }

  const pubMatch = /^\/s\/([A-Za-z0-9_-]+)(\/download)?$/.exec(path)
  if (pubMatch && method === "GET") {
    const row = db.prepare("SELECT s.token, s.expires_at, s.node_id, n.name, n.size, n.blob_hash FROM shares s JOIN nodes n ON n.id = s.node_id WHERE s.token = ? AND n.deleted = 0").get(pubMatch[1]) as any
    if (!row) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" })
      res.end("<!doctype html><meta charset=utf-8><body style=\"background:#f5f5f7;color:#6e6e73;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0\">链接不存在或已被删除</body>")
      return
    }
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      res.writeHead(410, { "content-type": "text/html; charset=utf-8" })
      res.end("<!doctype html><meta charset=utf-8><body style=\"background:#f5f5f7;color:#6e6e73;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0\">链接已过期</body>")
      return
    }
    if (pubMatch[2]) {
      db.prepare("UPDATE shares SET downloads = downloads + 1 WHERE token = ?").run(row.token)
      const file = blobPath(BLOBS, row.blob_hash)
      if (!(await fileExists(file))) return fail(res, 410, "blob missing")
      return streamFile(req, res, file, row.name)
    }
    const html = sharePage(row.name, row.size, row.token, row.expires_at)
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) })
    res.end(html)
    return
  }

  if (method === "GET") return serveStatic(req, res, path)
  return fail(res, 404, "not found")
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  handle(req, res)
    .catch((err: any) => {
      if (!res.headersSent) fail(res, 500, err?.message ?? "internal error")
      else res.end()
      console.error("[error]", req.method, req.url, err?.message)
    })
    .finally(() => {
      const status = res.statusCode
      console.log(req.method, req.url, status, Date.now() - started + "ms")
    })
})

setInterval(async () => {
  for (const res of subs) res.write(": ping\n\n")
  const now = Date.now()
  await collectGarbage(null)
  db.prepare("DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?").run(now)
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now)
  const expired = db.prepare("SELECT id FROM nodes WHERE expires_at IS NOT NULL AND expires_at < ? AND deleted = 0").all(now) as any[]
  const expiredHashes: string[] = []
  for (const row of expired) expiredHashes.push(...purgeTree(row.id))
  if (expiredHashes.length > 0) await collectGarbage(expiredHashes)
  const stale = db.prepare("SELECT id FROM nodes WHERE deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ? AND id <> ?").all(now - TRASH_TTL, INBOX) as any[]
  const staleHashes: string[] = []
  for (const row of stale) staleHashes.push(...purgeTree(row.id))
  if (staleHashes.length > 0) await collectGarbage(staleHashes)
}, 30000).unref()

server.listen(PORT, HOST, () => {
  console.log("DriveSend listening on http://" + HOST + ":" + PORT)
  console.log("data dir: " + DATA)
})
