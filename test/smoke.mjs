import { createHash } from "node:crypto"

const BASE = process.env.BASE || "http://127.0.0.1:8787"
let pass = 0
let fail = 0

function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name) } else { fail++; console.log("FAIL", name, extra ?? "") }
}

async function j(path, init) {
  const opts = Object.assign({}, init || {})
  opts.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + path, opts)
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

const body = JSON.stringify
const H = { "content-type": "application/json" }
const AUTH = process.env.DS_AUTH ? { authorization: "Bearer " + process.env.DS_AUTH } : {}

const content = Buffer.from("你好 DriveSend —— 同一条内核，两个面孔\n" + Math.random().toString(36) + "x".repeat(5000))
const hash = createHash("sha256").update(content).digest("hex")
const NAME = "测试-" + Date.now() + ".txt"

let init = await j("/api/upload/init", { method: "POST", headers: H, body: body({ name: NAME, size: content.byteLength, hash, parentId: null }) })
check("upload init", init.status === 200 && init.data.instant === false, init.data)

const uploadId = init.data.uploadId
const chunkSize = init.data.chunkSize
let offset = 0
while (offset < content.byteLength) {
  const slice = content.subarray(offset, Math.min(offset + chunkSize, content.byteLength))
  const res = await fetch(BASE + "/api/upload/" + uploadId + "?offset=" + offset, { method: "PUT", body: slice, headers: AUTH })
  const got = await res.json()
  check("chunk at " + offset, got.received === offset + slice.byteLength, got)
  offset += slice.byteLength
}

const done = await j("/api/upload/" + uploadId + "/complete", { method: "POST", headers: H, body: "{}" })
check("upload complete", done.status === 200 && done.data.hash === hash, done.data)
const nodeId = done.data.nodeId

const list = await j("/api/files")
check("list files", list.status === 200 && list.data.items.some((i) => i.id === nodeId && i.name === NAME), list.data)

const dl = await fetch(BASE + "/api/download/" + nodeId, { headers: AUTH })
const dlBuf = Buffer.from(await dl.arrayBuffer())
check("download roundtrip", dlBuf.equals(content), dlBuf.length + " vs " + content.length)
check("content-disposition", /filename\*=UTF-8''/.test(dl.headers.get("content-disposition") || ""), dl.headers.get("content-disposition"))

const partial = await fetch(BASE + "/api/download/" + nodeId, { headers: Object.assign({ range: "bytes=0-9" }, AUTH) })
const partBuf = Buffer.from(await partial.arrayBuffer())
check("range download", partial.status === 206 && partBuf.length === 10, partial.status)

const instant = await j("/api/upload/init", { method: "POST", headers: H, body: body({ name: "副本-" + Date.now() + ".txt", size: content.byteLength, hash, parentId: null }) })
check("instant upload (dedup)", instant.status === 200 && instant.data.instant === true, instant.data)

const folder = await j("/api/folders", { method: "POST", headers: H, body: body({ name: "项目资料", parentId: null }) })
check("create folder", folder.status === 200 && !!folder.data.id, folder.data)

const nested = await j("/api/files?parent=" + folder.data.id)
check("list empty folder", nested.status === 200 && nested.data.items.length === 0 && nested.data.breadcrumb.length === 1, nested.data)

const share = await j("/api/shares", { method: "POST", headers: H, body: body({ nodeId, ttlHours: 1 }) })
check("create share", share.status === 200 && !!share.data.token, share.data)
const token = share.data.token

const page = await fetch(BASE + "/s/" + token)
const pageHtml = await page.text()
check("share landing", page.status === 200 && pageHtml.includes(NAME), page.status)

const shared = await fetch(BASE + "/s/" + token + "/download")
const sharedBuf = Buffer.from(await shared.arrayBuffer())
check("share download", sharedBuf.equals(content), sharedBuf.length)

const badShare = await fetch(BASE + "/s/nonexistent-token")
check("bad share 404", badShare.status === 404, badShare.status)

const stateRes = await j("/api/state")
check("state stats", stateRes.status === 200 && stateRes.data.stats.logicalBytes >= content.byteLength, stateRes.data.stats)
check("state inbox counter", typeof stateRes.data.inbox.count === "number", stateRes.data.inbox)

const del = await j("/api/nodes/" + nodeId, { method: "DELETE" })
check("delete node", del.status === 200, del.data)
const after = await j("/api/files")
check("deleted gone", !after.data.items.some((i) => i.id === nodeId), after.data.items.map((i) => i.name))

const shares = await j("/api/shares")
check("share removed with node", !shares.data.items.some((s) => s.token === token), shares.data.items.length)

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
