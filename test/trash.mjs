import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE || "http://127.0.0.1:8790"
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 200)) } }
async function j(p, init) {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
const H = Object.assign({ "content-type": "application/json" }, AUTH)
const tag = Date.now()

async function upload(name, buf, parentId) {
  const init = await j("/api/upload/init", { method: "POST", headers: H, body: JSON.stringify({ name, size: buf.length, hash: null, parentId: parentId || null }) })
  await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
  return j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", headers: H, body: "{}" })
}

const folder = await j("/api/folders", { method: "POST", headers: H, body: JSON.stringify({ name: "待删文件夹-" + tag }) })
const buf = Buffer.from("trash-test-" + tag + "z".repeat(900))
const up = await upload("回收测试.txt", buf, folder.data.id)
check("upload into folder", up.status === 200, up.data)

await j("/api/nodes/" + folder.data.id, { method: "DELETE" })
let trash = await j("/api/trash")
check("folder appears in trash", trash.data.items.some((i) => i.id === folder.data.id), trash.data.items.map((i) => i.name))
check("nested file not listed separately", !trash.data.items.some((i) => i.name === "回收测试.txt"), trash.data.items.length)
check("trash lists purge window", typeof trash.data.purgeInDays === "number" && trash.data.purgeInDays > 0, trash.data.purgeInDays)

const stateAfterDelete = await j("/api/state")
check("deleted content still occupies disk", stateAfterDelete.data.stats.trashBytes >= buf.length, stateAfterDelete.data.stats)

const restored = await j("/api/nodes/" + folder.data.id + "/restore", { method: "POST", headers: H, body: "{}" })
check("restore ok", restored.status === 200, restored.data)
const listing = await j("/api/files")
check("folder back at root", listing.data.items.some((i) => i.id === folder.data.id), listing.data.items.map((i) => i.name))
const inner = await j("/api/files?parent=" + folder.data.id)
check("nested file restored too", inner.data.items.some((i) => i.name === "回收测试.txt"), inner.data.items.map((i) => i.name))
const dl = await fetch(BASE + "/api/download/" + up.data.nodeId, { headers: AUTH })
check("restored file still downloadable", dl.status === 200 && (await dl.arrayBuffer()).byteLength === buf.length, dl.status)

await j("/api/nodes/" + folder.data.id, { method: "DELETE" })
const purged = await j("/api/nodes/" + folder.data.id, { method: "DELETE" } + "")
const purgeCall = await fetch(BASE + "/api/nodes/" + folder.data.id + "?purge=1", { method: "DELETE", headers: AUTH })
check("purge ok", purgeCall.status === 200, purgeCall.status)
trash = await j("/api/trash")
check("gone from trash after purge", !trash.data.items.some((i) => i.id === folder.data.id), trash.data.items.length)
const gone = await fetch(BASE + "/api/download/" + up.data.nodeId, { headers: AUTH })
check("content gone after purge", gone.status === 404 || gone.status === 410, gone.status)

const searchName = "搜索目标-" + tag + ".txt"
const s = await upload(searchName, Buffer.from("findme" + tag))
const found = await j("/api/search?q=" + encodeURIComponent("搜索目标-" + tag))
check("search finds file", found.data.items.some((i) => i.id === s.data.nodeId), found.data.items.length)
check("search reports path", typeof found.data.items[0]?.path === "string", found.data.items[0])
const empty = await j("/api/search?q=")
check("empty query returns empty", empty.data.items.length === 0, empty.data.items.length)
const wildcard = await j("/api/search?q=" + encodeURIComponent("%"))
check("wildcards are escaped", wildcard.data.items.every((i) => i.name.includes("%")), wildcard.data.items.length)

await j("/api/nodes/" + s.data.nodeId, { method: "DELETE" })

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
