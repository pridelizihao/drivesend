import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const AUTH = await authHeaders(BASE)
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
// upload an initial file
const v1 = Buffer.from("original content " + Date.now())
const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "doc.pdf", size: v1.length, hash: null, parentId: null }) })
await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: v1, headers: AUTH })
const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })
const id = done.data.nodeId

const page = await (await fetch(BASE + "/view/" + id, { headers: AUTH })).text()
const checks = {
  "picker is a button": page.includes('id="uploadBtn"'),
  "input not using hidden attr": !/id="file"[^>]* hidden/.test(page),
  "click handler wired": page.includes("document.getElementById('file').click()"),
  "progress label present": page.includes("上传中 "),
  "reloads after replace": page.includes("?inline=1&t="),
}
let bad = 0
for (const [k, ok] of Object.entries(checks)) { console.log((ok ? "PASS " : "FAIL ") + k); if (!ok) bad++ }
console.log("replace endpoint:", (await j("/api/nodes/" + id + "/versions")).status === 200 ? "PASS" : "FAIL")
process.exit(bad === 0 ? 0 : 1)
