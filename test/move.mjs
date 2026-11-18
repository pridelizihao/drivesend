const BASE = process.env.BASE || "http://127.0.0.1:8787"
const AUTH = process.env.DS_AUTH ? { authorization: "Bearer " + process.env.DS_AUTH } : {}
const H = Object.assign({ "content-type": "application/json" }, AUTH)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 160)) } }
async function j(p, init) {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
const tag = Date.now()
const mkFolder = async (name, parentId) => (await j("/api/folders", { method: "POST", headers: H, body: JSON.stringify({ name, parentId: parentId || null }) })).data.id
const A = await mkFolder("移动测试A-" + tag)
const B = await mkFolder("移动测试B-" + tag)

const content = Buffer.from("move-check-" + tag)
const init = await j("/api/upload/init", { method: "POST", headers: H, body: JSON.stringify({ name: "mv-" + tag + ".txt", size: content.length, hash: null, parentId: null }) })
await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: content, headers: AUTH })
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", headers: H, body: "{}" })
const fileId = done.data.nodeId

let r = await j("/api/nodes/" + fileId + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: A }) })
check("move file into folder", r.status === 200, r.data)
let listing = await j("/api/files?parent=" + A)
check("file now inside A", listing.data.items.some((i) => i.id === fileId), listing.data.items.map((i) => i.name))

r = await j("/api/nodes/" + A + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: B }) })
check("move folder A into B", r.status === 200, r.data)

r = await j("/api/nodes/" + B + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: A }) })
check("refuse cycle B->A", r.status === 400, r.data)

r = await j("/api/nodes/" + A + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: A }) })
check("refuse self move", r.status === 400, r.data)

r = await j("/api/nodes/" + fileId + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: "inbox" }) })
check("refuse move into inbox", r.status === 400, r.data)

r = await j("/api/nodes/" + fileId + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: B }) })
check("move file to B root", r.status === 200, r.data)

r = await j("/api/nodes/" + fileId + "/move", { method: "POST", headers: H, body: JSON.stringify({ parentId: B }) })
check("move to same place is no-op", r.status === 200 && r.data.unchanged === true, r.data)

await j("/api/nodes/" + B, { method: "DELETE" })
const after = await j("/api/files")
check("cleanup removed tree", !after.data.items.some((i) => i.id === B), after.data.items.map((i) => i.name))

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
