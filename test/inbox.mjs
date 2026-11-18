const BASE = process.env.BASE || "http://127.0.0.1:8787"
const AUTH = process.env.DS_AUTH ? { authorization: "Bearer " + process.env.DS_AUTH } : {}
let pass = 0, fail = 0
function check(name, ok, extra) {
  if (ok) { pass++; console.log("PASS", name) } else { fail++; console.log("FAIL", name, JSON.stringify(extra ?? "").slice(0, 200)) }
}
async function j(path, init) {
  const opts = Object.assign({}, init || {})
  opts.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + path, opts)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}
const H = Object.assign({ "content-type": "application/json" }, AUTH)

const content = Buffer.from("inbox-payload-" + Math.random().toString(36) + "y".repeat(2000))
const init = await j("/api/upload/init", { method: "POST", headers: H, body: JSON.stringify({ name: "手机截图-" + Date.now() + ".png", size: content.byteLength, hash: null, parentId: "inbox" }) })
check("init to inbox", init.status === 200 && !!init.data.uploadId, init.data)

const put = await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: content, headers: AUTH })
check("chunk", put.status === 200, put.status)
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", headers: H, body: "{}" })
check("complete", done.status === 200 && !!done.data.nodeId, done.data)
const nodeId = done.data.nodeId

const inbox = await j("/api/inbox")
check("inbox lists item", inbox.status === 200 && inbox.data.items.some((i) => i.id === nodeId), inbox.data.items.length)
const item = inbox.data.items.find((i) => i.id === nodeId)
check("ttl set", !!item && item.expiresAt > Date.now() + 20 * 3600 * 1000, item && item.expiresAt)
check("ttl hours exposed", inbox.data.ttlHours === 24, inbox.data.ttlHours)

const state = await j("/api/state")
check("state counts inbox", state.data.inbox && state.data.inbox.count >= 1, state.data.inbox)

const files = await j("/api/files")
check("inbox hidden from drive", !files.data.items.some((i) => i.id === "inbox"), files.data.items.map((i) => i.name))

const burn = await fetch(BASE + "/api/download/" + nodeId + "?burn=1", { headers: AUTH })
const buf = Buffer.from(await burn.arrayBuffer())
check("burn download full", buf.equals(content), buf.length + "/" + content.length)

await new Promise((r) => setTimeout(r, 700))
const after = await j("/api/inbox")
check("burn removes item", !after.data.items.some((i) => i.id === nodeId), after.data.items.length)

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
