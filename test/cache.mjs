import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const AUTH = await authHeaders(BASE)
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 160)) } }

const buf = Buffer.from("etag-test " + Date.now())
const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "e.txt", size: buf.length, hash: null }) })
await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })
const id = done.data.nodeId

const first = await fetch(BASE + "/api/download/" + id + "?inline=1", { headers: AUTH })
const etag = first.headers.get("etag")
check("etag present", !!etag, etag)
await first.arrayBuffer()

const second = await fetch(BASE + "/api/download/" + id + "?inline=1", { headers: Object.assign({ "if-none-match": etag }, AUTH) })
check("revalidation returns 304", second.status === 304, second.status)

const rangeRes = await fetch(BASE + "/api/download/" + id + "?inline=1", { headers: Object.assign({ range: "bytes=0-4" }, AUTH) })
check("range still works", rangeRes.status === 206, rangeRes.status)
await rangeRes.arrayBuffer()

const viewer = await (await fetch(BASE + "/view/" + id, { headers: AUTH })).text()
check("back button closes tab", viewer.includes("window.close()") && viewer.includes('id="backBtn"'), "missing")
check("no plain return link", !viewer.includes("‹ 返回</a>"), "old link still there")

await j("/api/nodes/" + id, { method: "DELETE" })
console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
