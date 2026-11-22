import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 200)) } }
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
async function upload(name, buf, parentId) {
  const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name, size: buf.length, hash: null, parentId: parentId || null }) })
  const id = init.data.uploadId
  await fetch(BASE + "/api/upload/" + id + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
  const done = await j("/api/upload/" + id + "/complete", { method: "POST", body: "{}" })
  return { id, done, init }
}

const tag = String.now || Date.now()

// ---- pagination ----
const folder = await j("/api/folders", { method: "POST", body: JSON.stringify({ name: "分页-" + tag }) })
const ids = []
for (let i = 0; i < 5; i++) {
  const r = await upload("p" + i + "-" + tag + ".txt", Buffer.from("x" + i + tag), folder.data.id)
  ids.push(r.done.data.nodeId)
}
const page1 = await j("/api/files?parent=" + folder.data.id + "&limit=2")
check("paging limit respected", page1.data.items.length === 2, page1.data.items.length)
check("paging reports total", page1.data.total === 5, page1.data.total)
check("paging reports hasMore", page1.data.hasMore === true, page1.data.hasMore)
const page2 = await j("/api/files?parent=" + folder.data.id + "&limit=2&offset=2")
check("paging offset works", page2.data.items.length === 2 && page2.data.items[0].id !== page1.data.items[0].id, page2.data.items.length)
const page3 = await j("/api/files?parent=" + folder.data.id + "&limit=2&offset=4")
check("last page hasMore false", page3.data.items.length === 1 && page3.data.hasMore === false, page3.data)

// ---- search: fts for >=3 chars, LIKE fallback for shorter ----
const longName = "深度学习笔记-" + tag + ".txt"
const up1 = await upload(longName, Buffer.from("a"), null)
const ftsHit = await j("/api/search?q=" + encodeURIComponent("深度学习"))
check("fts finds chinese substring", ftsHit.data.items.some((i) => i.name === longName), ftsHit.data.items.map((i) => i.name))
const latinHit = await j("/api/search?q=" + encodeURIComponent("笔记-" + tag))
check("search finds latin part", latinHit.data.items.some((i) => i.name === longName), latinHit.data.items.length)
const shortQ = await j("/api/search?q=" + encodeURIComponent("笔记"))
check("2-char query falls back to LIKE", shortQ.data.items.some((i) => i.name === longName), shortQ.data.items.length)

// ---- fts follows renames and deletes ----
const renamed = "期刊论文-" + tag + ".txt"
await j("/api/nodes/" + up1.done.data.nodeId + "/rename", { method: "POST", body: JSON.stringify({ name: renamed }) })
const afterRename = await j("/api/search?q=" + encodeURIComponent("期刊论文"))
check("fts index follows rename", afterRename.data.items.some((i) => i.name === renamed), afterRename.data.items.map((i) => i.name))
const oldNameGone = await j("/api/search?q=" + encodeURIComponent("深度学习笔记"))
check("old name no longer matches", !oldNameGone.data.items.some((i) => i.id === up1.done.data.nodeId), oldNameGone.data.items.length)

// ---- upload session survives a restart (persisted row) ----
const big = Buffer.from("resume-me-" + tag + "-".repeat(10))
const sess = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "resume-" + tag + ".bin", size: big.length, hash: null }) })
check("upload session created", sess.status === 200 && !!sess.data.uploadId, sess.data)
const probe = await j("/api/upload/" + sess.data.uploadId)
check("session readable by id", probe.status === 200 && probe.data.size === big.length, probe.data)
const half = Math.floor(big.length / 2)
await fetch(BASE + "/api/upload/" + sess.data.uploadId + "?offset=0", { method: "PUT", body: big.subarray(0, half), headers: AUTH })
const mid = await j("/api/upload/" + sess.data.uploadId)
check("progress is durable", mid.data.received === half, mid.data)
await fetch(BASE + "/api/upload/" + sess.data.uploadId + "?offset=" + half, { method: "PUT", body: big.subarray(half), headers: AUTH })
const fin = await j("/api/upload/" + sess.data.uploadId + "/complete", { method: "POST", body: "{}" })
check("resumed upload completes", fin.status === 200, fin.data)
const gone = await j("/api/upload/" + sess.data.uploadId)
check("session removed after complete", gone.status === 404, gone.status)

// ---- atomicity: a failed replace must not corrupt the node ----
const before = await j("/api/nodes/" + fin.data.nodeId + "/versions")
const quotaFail = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "x.bin", size: 999999999999, replaceNodeId: fin.data.nodeId }) })
check("oversized replace rejected", quotaFail.status === 413, quotaFail.status)
const after = await j("/api/nodes/" + fin.data.nodeId + "/versions")
check("failed replace left no version row", after.data.items.length === before.data.items.length, after.data.items.length)

// cleanup
await j("/api/nodes/" + folder.data.id + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + fin.data.nodeId + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + up1.done.data.nodeId + "?purge=1", { method: "DELETE" })

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
