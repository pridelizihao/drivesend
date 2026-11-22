import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE || "http://127.0.0.1:8789"
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 160)) } }
async function j(p, init) {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
const H = Object.assign({ "content-type": "application/json" }, AUTH)

const tag = Date.now()
const outer = await j("/api/folders", { method: "POST", headers: H, body: JSON.stringify({ name: "外层-" + tag }) })
const inner = await j("/api/folders", { method: "POST", headers: H, body: JSON.stringify({ name: "内层-" + tag, parentId: outer.data.id }) })
const content = Buffer.from("nested-delete-" + tag + "q".repeat(1000))
const init = await j("/api/upload/init", { method: "POST", headers: H, body: JSON.stringify({ name: "深层文件.txt", size: content.length, hash: null, parentId: inner.data.id }) })
await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: content, headers: AUTH })
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", headers: H, body: "{}" })
check("nested upload", done.status === 200, done.data)
const fileId = done.data.nodeId

const before = await j("/api/state")
check("file counted before delete", before.data.stats.files >= 1, before.data.stats)

await j("/api/nodes/" + outer.data.id, { method: "DELETE" })

const after = await j("/api/state")
check("no file leaks in stats", after.data.stats.files === before.data.stats.files - 1, { before: before.data.stats.files, after: after.data.stats.files })
check("content retained in trash", after.data.stats.trashBytes >= content.length, after.data.stats)
check("disk not freed before purge", after.data.stats.physicalBytes >= content.length, after.data.stats)

const orphan = await j("/api/download/" + fileId)
check("child no longer downloadable", orphan.status === 404, orphan.status)

const purge = await fetch(BASE + "/api/nodes/" + outer.data.id + "?purge=1", { method: "DELETE", headers: AUTH })
check("purge accepted", purge.status === 200, purge.status)
const purged = await j("/api/state")
check("disk freed after purge", purged.data.stats.physicalBytes === before.data.stats.physicalBytes - content.length, { before: before.data.stats.physicalBytes, after: purged.data.stats.physicalBytes })

const root = await j("/api/files")
check("root clean", !root.data.items.some((i) => i.name === "外层-" + tag), root.data.items.map((i) => i.name))

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
