import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE || "http://127.0.0.1:8787"
const H = await authHeaders(BASE)
async function upload(name, buf) {
  const init = await (await fetch(BASE + "/api/upload/init", { method: "POST", headers: H, body: JSON.stringify({ name, size: buf.length, hash: null, parentId: null }) })).json()
  await fetch(BASE + "/api/upload/" + init.uploadId + "?offset=0", { method: "PUT", body: buf, headers: H })
  return (await (await fetch(BASE + "/api/upload/" + init.uploadId + "/complete", { method: "POST", headers: H, body: "{}" })).json()).nodeId
}
const png = Buffer.from("89504e470d0a1a0a", "hex")
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const html = Buffer.from("<html><body><script>alert(1)</script></body></html>")
const txt = Buffer.from("hello preview")

for (const [name, buf, expectInline] of [["a.png", png, true], ["b.svg", svg, false], ["c.html", html, false], ["d.txt", txt, true], ["e.pdf", Buffer.from("%PDF-1.4"), true]]) {
  const id = await upload(name, buf)
  const res = await fetch(BASE + "/api/download/" + id + "?inline=1", { headers: H })
  const disp = res.headers.get("content-disposition") || ""
  const isInline = disp.startsWith("inline")
  const csp = res.headers.get("content-security-policy")
  const nosniff = res.headers.get("x-content-type-options")
  const ok = isInline === expectInline && nosniff === "nosniff"
  console.log((ok ? "PASS " : "FAIL ") + name.padEnd(7) + " inline=" + isInline + " csp=" + (csp || "-") + " type=" + res.headers.get("content-type"))
  await res.arrayBuffer()
}

const id = await upload("f.txt", txt)
const normal = await fetch(BASE + "/api/download/" + id, { headers: H })
console.log((normal.headers.get("content-disposition") || "").startsWith("attachment") ? "PASS default stays attachment" : "FAIL default disposition changed")
await normal.arrayBuffer()
