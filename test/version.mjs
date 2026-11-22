import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE || "http://127.0.0.1:8787"
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 200)) } }
async function j(p, init) {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
async function uploadFull(name, buf, extra) {
  const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify(Object.assign({ name, size: buf.length, hash: null }, extra || {})) })
  if (!init.data.uploadId) return { init }
  let off = 0
  while (off < buf.length) {
    const part = buf.subarray(off, Math.min(off + init.data.chunkSize, buf.length))
    await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=" + off, { method: "PUT", body: part, headers: AUTH })
    off += part.length
  }
  const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })
  return { init, done }
}

const v1 = Buffer.from("version one " + Date.now())
const first = await uploadFull("版本测试.txt", v1)
check("initial upload", first.done.status === 200, first.done.data)
const nodeId = first.done.data.nodeId

const v2 = Buffer.from("version two is longer than the first one " + Date.now())
const init2 = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "ignored.txt", size: v2.length, replaceNodeId: nodeId }) })
check("replace init accepted", init2.status === 200 && init2.data.replace === true, init2.data)
let off = 0
while (off < v2.length) {
  const part = v2.subarray(off, Math.min(off + init2.data.chunkSize, v2.length))
  await fetch(BASE + "/api/upload/" + init2.data.uploadId + "?offset=" + off, { method: "PUT", body: part, headers: AUTH })
  off += part.length
}
const replaced = await j("/api/upload/" + init2.data.uploadId + "/complete", { method: "POST", body: "{}" })
check("replace completes", replaced.status === 200 && replaced.data.replaced === true, replaced.data)
check("node id preserved", replaced.data.nodeId === nodeId, replaced.data)

const dl = await fetch(BASE + "/api/download/" + nodeId, { headers: AUTH })
const current = Buffer.from(await dl.arrayBuffer())
check("content is the new version", current.equals(v2), current.length + " vs " + v2.length)

const vers = await j("/api/nodes/" + nodeId + "/versions")
check("old version recorded", vers.status === 200 && vers.data.items.length === 1, vers.data)
check("version keeps old size", vers.data.items[0].size === v1.length, vers.data.items[0])

const list = await j("/api/files")
const row = list.data.items.find((i) => i.id === nodeId)
check("size updated in listing", row && row.size === v2.length, row)

const view = await fetch(BASE + "/view/" + nodeId, { headers: AUTH })
const html = await view.text()
check("viewer page serves", view.status === 200 && html.includes("替换为新版本"), view.status)
check("viewer embeds inline pdf/doc", html.includes("?inline=1"), html.includes("?inline=1"))

const missing = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "x.txt", size: 10, replaceNodeId: "00000000-0000-0000-0000-000000000000" }) })
check("unknown replace target rejected", missing.status === 404, missing.data)

await j("/api/nodes/" + nodeId, { method: "DELETE" })
console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
