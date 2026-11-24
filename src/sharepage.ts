const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

const CSS = [
  "html,body{margin:0;min-height:100%;}",
  "body{background:#f5f5f7;color:#1d1d1f;font-family:" + FONT + ";-webkit-font-smoothing:antialiased}",
  "body::before{content:'';position:fixed;inset:-25vmax;z-index:-1;background:radial-gradient(38vmax 38vmax at 10% 8%,rgba(122,178,255,.5),transparent 62%),radial-gradient(32vmax 32vmax at 88% 4%,rgba(255,176,212,.45),transparent 60%),radial-gradient(38vmax 38vmax at 80% 90%,rgba(150,226,208,.45),transparent 62%);filter:blur(42px) saturate(120%)}",
  ".wrap{max-width:min(1040px,94vw);margin:0 auto;padding:28px 0 60px}",
  ".card{background:rgba(255,255,255,.74);-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);border:1px solid rgba(255,255,255,.9);border-radius:22px;box-shadow:0 18px 50px rgba(0,0,0,.09);overflow:hidden}",
  ".head{padding:22px 26px;border-bottom:1px solid rgba(0,0,0,.06)}",
  ".kicker{color:#86868b;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:8px}",
  "h1{font-size:21px;margin:0 0 6px;word-break:break-all;letter-spacing:-.015em;line-height:1.3}",
  ".meta{color:#6e6e73;font-size:13px}",
  ".crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:12px 20px;font-size:13px;border-bottom:1px solid rgba(0,0,0,.06);background:rgba(255,255,255,.4)}",
  ".crumbs a{color:#6e6e73;text-decoration:none;padding:3px 7px;border-radius:7px}",
  ".crumbs a:hover{background:rgba(0,0,0,.05);color:#1d1d1f}",
  ".crumbs span.sep{opacity:.35}",
  ".crumbs span.cur{color:#1d1d1f;font-weight:600;padding:3px 7px}",
  ".list{display:block}",
  ".row{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(0,0,0,.05);text-decoration:none;color:inherit}",
  ".row:last-child{border-bottom:0}",
  ".row:hover{background:rgba(255,255,255,.7)}",
  ".row .ic{width:26px;text-align:center;font-size:17px;flex:0 0 auto}",
  ".row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}",
  ".row .sz{color:#86868b;font-size:12px;flex:0 0 auto}",
  ".row .go{color:#0071e3;font-size:12px;flex:0 0 auto}",
  ".foot{padding:16px 20px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}",
  ".hint{color:#86868b;font-size:12px}",
  ".btn{display:inline-flex;align-items:center;gap:7px;padding:11px 22px;border-radius:980px;background:linear-gradient(180deg,#0a84ff,#0071e3);color:#fff;text-decoration:none;font-weight:600;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.24)}",
  ".btn:hover{filter:brightness(1.06)}",
  ".preview{padding:16px;background:rgba(0,0,0,.03);display:grid;place-items:center;min-height:180px}",
  ".preview img{max-width:100%;max-height:74vh;border-radius:12px;display:block}",
  ".preview video{max-width:100%;max-height:74vh;border-radius:12px;display:block;background:#000}",
  ".preview audio{width:100%}",
  ".preview iframe{width:100%;height:74vh;border:0;border-radius:12px;background:#fff}",
  ".preview pre{margin:0;width:100%;max-height:64vh;overflow:auto;text-align:left;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:#3a3a3c}",
  ".nopreview{display:flex;flex-direction:column;align-items:center;gap:10px;color:#86868b;font-size:13px;padding:30px 0}",
  ".nopreview .big{font-size:46px}",
  ".expired{max-width:min(460px,92vw);margin:18vh auto;background:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.9);border-radius:22px;padding:34px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.09)}",
  ".expired h1{font-size:18px;margin:0 0 8px}",
  ".expired p{color:#6e6e73;font-size:13px;margin:0}",
  "@media (max-width:640px){.head{padding:18px 18px}.row{padding:12px 16px}.foot{padding:14px 16px}.wrap{padding:16px 0 40px}}",
].join("\n")

export type ShareNode = { id: string; name: string; kind: string; size: number; blob_hash: string | null }
export type Crumb = { id: string; name: string }

/**
 * Every link on this page must carry the deployment prefix. When the app is
 * mounted under BASE_PATH (e.g. /drive) an absolute "/s/..." would escape to the
 * web root and land on whatever other site lives there.
 */
function shareUrl(base: string, token: string, suffix = ""): string {
  return base + "/s/" + token + suffix
}

export function previewKind(name: string): "image" | "pdf" | "video" | "audio" | "text" | null {
  const ext = (name.split(".").pop() || "").toLowerCase()
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) return "image"
  if (ext === "pdf") return "pdf"
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video"
  if (["mp3", "wav", "flac", "m4a", "ogg", "aac"].includes(ext)) return "audio"
  if (["txt", "md", "json", "log", "csv", "yml", "yaml", "ini", "conf", "sh", "py", "js", "ts", "css", "xml"].includes(ext)) return "text"
  return null
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function human(n: number): string {
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return (i === 0 ? String(v) : v.toFixed(1)) + " " + units[i]
}

function icon(name: string, kind: string): string {
  if (kind === "folder") return "📁"
  const ext = (name.split(".").pop() || "").toLowerCase()
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"].includes(ext)) return "🖼"
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "🎬"
  if (["mp3", "wav", "flac", "m4a", "ogg", "aac"].includes(ext)) return "🎵"
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦"
  if (ext === "pdf") return "📕"
  if (["doc", "docx"].includes(ext)) return "📘"
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗"
  return "📄"
}

function previewHtml(base: string, token: string, node: ShareNode): string {
  const kind = previewKind(node.name)
  const src = shareUrl(base, token, "/download?p=" + node.id + "&inline=1")
  if (kind === "image") return "<img src=\"" + esc(src) + "\" alt=\"" + esc(node.name) + "\">"
  if (kind === "pdf") return "<iframe src=\"" + esc(src) + "\" title=\"" + esc(node.name) + "\"></iframe>"
  if (kind === "video") return "<video controls playsinline preload=\"metadata\" src=\"" + esc(src) + "\"></video>"
  if (kind === "audio") return "<audio controls preload=\"metadata\" src=\"" + esc(src) + "\"></audio>"
  if (kind === "text") {
    return "<pre id=\"txt\">加载中…</pre><script>fetch(" + JSON.stringify(src) + ").then(r=>r.text()).then(t=>{document.getElementById('txt').textContent=t.slice(0,524288)}).catch(()=>{document.getElementById('txt').textContent='加载失败'})</script>"
  }
  return "<div class=\"nopreview\"><div class=\"big\">" + icon(node.name, node.kind) + "</div><div>这种格式无法在线预览，下载后打开</div></div>"
}

export function renderSharePage(opts: {
  base: string
  token: string
  expiresAt: number | null
  node: ShareNode
  crumbs: Crumb[]
  children: Array<{ id: string; name: string; kind: string; size: number }>
  totalBytes?: number
}): string {
  const { base, token, expiresAt, node, crumbs, children } = opts
  const exp = expiresAt ? "有效期至 " + new Date(expiresAt).toLocaleString("zh-CN") : "永久有效"
  const isFolder = node.kind === "folder"
  const downloadHref = shareUrl(base, token, "/download?p=" + node.id)
  const rootHref = shareUrl(base, token)

  const crumbBar = () => {
    if (crumbs.length === 0) return []
    const out: string[] = ["<div class=\"crumbs\">", "<a href=\"" + esc(rootHref) + "\">全部文件</a>"]
    for (const crumb of crumbs) {
      out.push("<span class=\"sep\">/</span>")
      out.push(crumb.id === node.id
        ? "<span class=\"cur\">" + esc(crumb.name) + "</span>"
        : "<a href=\"" + esc(shareUrl(base, token, "?p=" + crumb.id)) + "\">" + esc(crumb.name) + "</a>")
    }
    out.push("</div>")
    return out
  }

  const parts: string[] = [
    "<!doctype html>",
    "<html lang=\"zh-CN\"><head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta name=\"robots\" content=\"noindex,nofollow\">",
    "<title>" + esc(node.name) + " · DriveSend 分享</title>",
    "<style>" + CSS + "</style>",
    "</head><body><div class=\"wrap\">",
    "<div class=\"card\">",
    "<div class=\"head\">",
    "<div class=\"kicker\">DriveSend 分享</div>",
    "<h1>" + esc(node.name) + "</h1>",
    "<div class=\"meta\">" + (isFolder ? children.length + " 项 · " + human(opts.totalBytes || 0) + " · " : human(node.size) + " · ") + exp + "</div>",
    "</div>",
  ]

  parts.push(...crumbBar())

  if (isFolder) {
    parts.push("<div class=\"list\">")
    if (children.length === 0) {
      parts.push("<div class=\"row\"><span class=\"nm hint\">这个文件夹是空的</span></div>")
    }
    for (const child of children) {
      const href = shareUrl(base, token, "?p=" + child.id)
      parts.push(
        "<a class=\"row\" href=\"" + esc(href) + "\">" +
        "<span class=\"ic\">" + icon(child.name, child.kind) + "</span>" +
        "<span class=\"nm\">" + esc(child.name) + "</span>" +
        "<span class=\"sz\">" + (child.kind === "folder" ? "" : human(child.size)) + "</span>" +
        "<span class=\"go\">" + (child.kind === "folder" ? "打开" : "查看") + "</span>" +
        "</a>"
      )
    }
    parts.push("</div>")
    parts.push("<div class=\"foot\">")
    parts.push("<span class=\"hint\">文件夹会打包成 zip 下载</span>")
    parts.push("<a class=\"btn\" href=\"" + esc(downloadHref) + "\">打包下载</a>")
    parts.push("</div>")
  } else {
    parts.push("<div class=\"preview\">" + previewHtml(base, token, node) + "</div>")
    parts.push("<div class=\"foot\">")
    parts.push("<span class=\"hint\">" + human(node.size) + "</span>")
    parts.push("<a class=\"btn\" href=\"" + esc(downloadHref) + "\">下载</a>")
    parts.push("</div>")
  }

  parts.push("</div></div></body></html>")
  return parts.join("\n")
}

export function renderShareError(message: string): string {
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>" + esc(message) + " · DriveSend</title>",
    "<style>" + CSS + "</style></head><body>",
    "<div class=\"expired\"><h1>" + esc(message) + "</h1><p>链接可能已被撤销，或已超过有效期。</p></div>",
    "</body></html>",
  ].join("\n")
}
