import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const PREFIX = process.env.PREFIX || "/drive"
const AUTH = await authHeaders(BASE)
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 300)) } }
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
async function upload(name, buf, parentId) {
  const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name, size: buf.length, hash: null, parentId: parentId || null }) })
  await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
  return (await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })).data.nodeId
}
function internalLinks(html) {
  const out = []
  const re = /(?:href|src)="([^"]+)"/g
  let m
  while ((m = re.exec(html))) out.push(m[1])
  return out.filter((u) => u.startsWith("/") && !u.startsWith("//"))
}

const tag = Date.now()
const fileId = await upload("子路径测试-" + tag + ".txt", Buffer.from("subpath " + tag))
const folder = await j("/api/folders", { method: "POST", body: JSON.stringify({ name: "子路径目录-" + tag }) })
await upload("里面.txt", Buffer.from("inner"), folder.data.id)

const fileShare = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId: fileId, ttlHours: 24 }) })
const folderShare = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId: folder.data.id, ttlHours: 24 }) })

const filePage = await (await fetch(BASE + "/s/" + fileShare.data.token)).text()
const folderPage = await (await fetch(BASE + "/s/" + folderShare.data.token)).text()

for (const [label, html] of [["file share", filePage], ["folder share", folderPage]]) {
  const links = internalLinks(html)
  const bad = links.filter((u) => !u.startsWith(PREFIX + "/"))
  check(label + ": every internal link keeps the prefix", bad.length === 0, bad.slice(0, 5))
  check(label + ": no bare /s/ link", !links.some((u) => u.startsWith("/s/")), links.filter((u) => u.startsWith("/s/")).slice(0, 3))
  // The inline URL is an attribute for media and a JS string for text, so assert on
  // the raw markup rather than only on href/src attributes.
  if (label === "file share") {
    check(label + ": inline preview carries the prefix", html.includes(PREFIX + "/s/") && html.includes("inline=1"), html.slice(0, 200))
    check(label + ": no absolute inline URL", !html.includes(String.fromCharCode(34) + "/s/"), "found bare /s/")
  }
}

// subfolder navigation must stay inside the prefix too
const subHref = internalLinks(folderPage).find((u) => u.includes("?p="))
check("folder row link found", !!subHref, internalLinks(folderPage).slice(0, 5))
if (subHref) {
  const subHtml = await (await fetch("http://" + new URL(BASE).host + subHref)).text()
  check("subfolder page keeps prefix", internalLinks(subHtml).every((u) => u.startsWith(PREFIX + "/")), internalLinks(subHtml).filter((u) => !u.startsWith(PREFIX + "/")).slice(0, 4))
}

// the viewer page and login page must respect it as well
const viewer = await (await fetch(BASE + "/view/" + fileId, { headers: AUTH })).text()
check("viewer page keeps prefix", internalLinks(viewer).every((u) => u.startsWith(PREFIX + "/")), internalLinks(viewer).filter((u) => !u.startsWith(PREFIX + "/")).slice(0, 4))

const shell = await (await fetch(BASE + "/")).text()
check("app shell uses relative asset paths", !internalLinks(shell).some((u) => u.startsWith("/")), internalLinks(shell).slice(0, 4))

// error page also renders from the server (no broken links)
const missing = await fetch(BASE + "/s/definitely-not-a-token")
const missingHtml = await missing.text()
check("missing share renders styled page", missing.status === 404 && missingHtml.includes("链接不存在"), missing.status)

await j("/api/nodes/" + folder.data.id + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + fileId + "?purge=1", { method: "DELETE" })
console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
