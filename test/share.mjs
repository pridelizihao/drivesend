import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 160)) } }
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
const buf = Buffer.from("share-dedupe " + Date.now())
const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "分享测试.txt", size: buf.length, hash: null }) })
await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })
const nodeId = done.data.nodeId

const a = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId, ttlHours: 24 }) })
const b = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId, ttlHours: 24 }) })
check("second identical request reuses the link", b.data.token === a.data.token, { a: a.data.token, b: b.data.token })
check("reuse is flagged", b.data.reused === true, b.data)

const list = await j("/api/shares")
const mine = list.data.items.filter((s) => s.name === "分享测试.txt")
check("only one link listed", mine.length === 1, mine.length)

const c = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId, ttlHours: 1 }) })
check("different lifetime still creates a new link", c.data.token !== a.data.token, c.data)

await j("/api/nodes/" + nodeId, { method: "DELETE" })
console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
