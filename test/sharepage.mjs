import { authHeaders } from "./_auth.mjs"
import { inflateRawSync } from "node:zlib"
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
  await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: buf, headers: AUTH })
  const done = await j("/api/upload/" + init.data.uploadId + "/complete", { method: "POST", body: "{}" })
  return done.data.nodeId
}
const tag = Date.now()

// --- file share: image preview ---
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
const imgId = await upload("预览图-" + tag + ".png", png)
const share = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId: imgId, ttlHours: 24 }) })
check("file share created", share.status === 200 && !!share.data.token, share.data)
const token = share.data.token

const page = await fetch(BASE + "/s/" + token)
const html = await page.text()
check("share page renders", page.status === 200, page.status)
check("image preview embedded", html.includes("p=" + imgId) && html.includes("inline=1") && html.includes("<img"), html.slice(0, 120))
check("download button present", html.includes("/download?p=" + imgId), "missing")
check("expiry shown", html.includes("有效期至"), "missing")

const inline = await fetch(BASE + "/s/" + token + "/download?p=" + imgId + "&inline=1")
check("inline serves image", inline.status === 200 && (inline.headers.get("content-disposition") || "").startsWith("inline"), inline.headers.get("content-disposition"))
await inline.arrayBuffer()
const attach = await fetch(BASE + "/s/" + token + "/download?p=" + imgId)
check("plain download is attachment", (attach.headers.get("content-disposition") || "").startsWith("attachment"), attach.headers.get("content-disposition"))
await attach.arrayBuffer()

// --- html never renders inline (same-origin XSS guard) ---
const evilId = await upload("evil-" + tag + ".html", Buffer.from("<script>alert(1)</script>"))
const evilShare = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId: evilId, ttlHours: 1 }) })
const evil = await fetch(BASE + "/s/" + evilShare.data.token + "/download?p=" + evilId + "&inline=1")
check("html forced to download", (evil.headers.get("content-disposition") || "").startsWith("attachment"), evil.headers.get("content-disposition"))
await evil.arrayBuffer()

// --- folder share ---
const folder = await j("/api/folders", { method: "POST", body: JSON.stringify({ name: "资料-" + tag }) })
const sub = await j("/api/folders", { method: "POST", body: JSON.stringify({ name: "子目录", parentId: folder.data.id }) })
const innerId = await upload("内部.txt", Buffer.from("hello inner"), sub.data.id)
const topId = await upload("顶层.txt", Buffer.from("hello top"), folder.data.id)

const folderShare = await j("/api/shares", { method: "POST", body: JSON.stringify({ nodeId: folder.data.id, ttlHours: 24 }) })
check("folder share created", folderShare.status === 200 && !!folderShare.data.token, folderShare.data)
const ftoken = folderShare.data.token

const folderPage = await (await fetch(BASE + "/s/" + ftoken)).text()
check("folder page lists children", folderPage.includes("顶层.txt") && folderPage.includes("子目录"), folderPage.slice(0, 200))
check("folder page offers zip", folderPage.includes("打包下载"), "missing")
check("folder page hides size of folders", folderPage.includes("打开"), "missing")

const subPage = await (await fetch(BASE + "/s/" + ftoken + "?p=" + sub.data.id)).text()
check("navigates into subfolder", subPage.includes("内部.txt"), subPage.slice(0, 200))
check("breadcrumb shows parent", subPage.includes("资料-" + tag), "missing")

// --- zip download ---
const zipRes = await fetch(BASE + "/s/" + ftoken + "/download?p=" + folder.data.id)
const zipBuf = Buffer.from(await zipRes.arrayBuffer())
check("zip content-type", zipRes.headers.get("content-type") === "application/zip", zipRes.headers.get("content-type"))
check("zip magic bytes", zipBuf.slice(0, 2).toString() === "PK", zipBuf.slice(0, 4).toString("hex"))
check("zip has entry count header", Number(zipRes.headers.get("x-entry-count")) === 2, zipRes.headers.get("x-entry-count"))

// parse the zip central directory to confirm names and that content inflates
function readZip(buf) {
  const out = []
  let i = 0
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue }
    const method = buf.readUInt16LE(i + 8)
    const csize = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8")
    const dataStart = i + 30 + nameLen + extraLen
    const data = buf.slice(dataStart, dataStart + csize)
    out.push({ name, content: method === 8 ? inflateRawSync(data).toString("utf8") : data.toString("utf8") })
    i = dataStart + csize
  }
  return out
}
const entries = readZip(zipBuf)
check("zip contains nested path", entries.some((e) => e.name === "子目录/内部.txt"), entries.map((e) => e.name))
check("zip content is correct", entries.find((e) => e.name === "顶层.txt")?.content === "hello top", entries.find((e) => e.name === "顶层.txt"))

// --- access control: nodes outside the shared tree must not leak ---
const outside = await upload("外部秘密-" + tag + ".txt", Buffer.from("secret"))
const leakPage = await fetch(BASE + "/s/" + ftoken + "?p=" + outside)
check("outside node refused on page", leakPage.status === 404, leakPage.status)
const leakDl = await fetch(BASE + "/s/" + ftoken + "/download?p=" + outside)
check("outside node refused on download", leakDl.status === 404, leakDl.status)
await leakDl.arrayBuffer()
const sibling = await fetch(BASE + "/s/" + token + "/download?p=" + folder.data.id)
check("other share cannot reach this folder", sibling.status === 404, sibling.status)
await sibling.arrayBuffer()

// --- revoked link ---
await j("/api/shares/" + ftoken, { method: "DELETE" })
const revoked = await fetch(BASE + "/s/" + ftoken)
const revokedBody = await revoked.text()
check("revoked link 404 page", revoked.status === 404 && revokedBody.includes("不存在"), revoked.status)

// cleanup
await j("/api/nodes/" + folder.data.id + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + imgId + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + evilId + "?purge=1", { method: "DELETE" })
await j("/api/nodes/" + outside + "?purge=1", { method: "DELETE" })

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
