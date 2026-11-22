import { sha256FileHex } from "./sha256.js"

const $ = (sel) => document.querySelector(sel)

const state = {
  view: "files",
  parent: null,
  breadcrumb: [],
  items: [],
  inbox: [],
  trash: [],
  selected: null,
  selection: new Set(),
  searching: false,
}

const deviceLabel = (() => {
  const ua = navigator.userAgent
  if (/Windows/.test(ua)) return "Windows"
  if (/Mac OS X/.test(ua)) return "macOS"
  if (/Android/.test(ua)) return "Android"
  if (/iPhone|iPad/.test(ua)) return "iOS"
  if (/Linux/.test(ua)) return "Linux"
  return "网页"
})()

function el(tag, attrs, kids) {
  const node = document.createElement(tag)
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (value === null || value === undefined) continue
      if (key === "class") node.className = value
      else if (key === "text") node.textContent = value
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value)
      else node.setAttribute(key, value)
    }
  }
  if (kids) for (const kid of kids) node.append(kid)
  return node
}

async function api(path, options) {
  const res = await fetch(path, options)
  let data = {}
  try { data = await res.json() } catch (err) { data = {} }
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status)
  return data
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
}

function humanSize(n) {
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return (i === 0 ? String(v) : v.toFixed(1)) + " " + units[i]
}

function ago(ts) {
  const d = Date.now() - ts
  if (d < 60000) return "刚刚"
  if (d < 3600000) return Math.floor(d / 60000) + " 分钟前"
  if (d < 86400000) return Math.floor(d / 3600000) + " 小时前"
  return new Date(ts).toLocaleDateString("zh-CN")
}

function icon(name, kind) {
  if (kind === "folder") return "📁"
  const ext = (name.split(".").pop() || "").toLowerCase()
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼"
  if (["mp4", "mov", "mkv", "avi"].includes(ext)) return "🎬"
  if (["mp3", "wav", "flac"].includes(ext)) return "🎵"
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦"
  if (ext === "pdf") return "📕"
  if (["doc", "docx"].includes(ext)) return "📘"
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗"
  return "📄"
}

const ICON_PATHS = {
  download: "M12 4v10m0 0l-4-4m4 4l4-4M5 19h14",
  downloadCheck: "M11 4v9m0 0l-3.5-3.5M11 13l3.5-3.5M4 19h6M15.5 18.2l1.9 1.9 3.6-4",
  share: "M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M5 13.5V18a2 2 0 002 2h10a2 2 0 002-2v-4.5",
  trash: "M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0110.7 4h2.6a1.2 1.2 0 011.2 1.2V7M6.5 7l.9 12.1A1.2 1.2 0 008.6 20h6.8a1.2 1.2 0 001.2-1.1L17.5 7",
  move: "M3.2 7.2a1.8 1.8 0 011.8-1.8h3.6l1.8 1.8h8.4a1.8 1.8 0 011.8 1.8v7.2a1.8 1.8 0 01-1.8 1.8H5a1.8 1.8 0 01-1.8-1.8V7.2zM12 10.6v4.6m0 0l-2-2m2 2l2-2",
  rename: "M4 20h4.2L19 9.2a2.1 2.1 0 00-3-3L5.2 17 4 20zM14.5 7.5l3 3",
  restore: "M4 12a8 8 0 108-8M4 12V6m0 6h6",
}

function opBtn(kind, title, onclick, variant) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "op" + (variant ? " " + variant : "")
  button.title = title
  button.setAttribute("aria-label", title)
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICON_PATHS[kind] + '"/></svg>'
  button.addEventListener("click", onclick)
  return button
}

async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (err) {
    // fall through
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.style.position = "fixed"
    area.style.top = "-1000px"
    area.style.opacity = "0"
    document.body.append(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch (err) {
    return false
  }
}

function toast(text, isError) {
  const node = el("div", { class: "toast" + (isError ? " err" : ""), text })
  $("#toasts").append(node)
  setTimeout(() => node.remove(), 5000)
}

function openModal(titleText, render) {
  const backdrop = el("div", { class: "modal-backdrop" })
  const card = el("div", { class: "modal" }, [el("div", { class: "modal-title", text: titleText })])
  const body = el("div", { class: "modal-body" })
  card.append(body)
  backdrop.append(card)
  document.body.append(backdrop)
  const onKey = (event) => { if (event.key === "Escape") close() }
  function close() {
    backdrop.remove()
    document.removeEventListener("keydown", onKey)
  }
  document.addEventListener("keydown", onKey)
  backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) close() })
  render(body, close)
  return close
}

function promptModal(titleText, defaultValue, placeholder, onOk) {
  openModal(titleText, (body, close) => {
    const input = el("input", { class: "field", value: defaultValue, placeholder })
    const submit = () => {
      const text = input.value.trim()
      if (!text) return
      close()
      onOk(text)
    }
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit() })
    body.append(input)
    body.append(el("div", { class: "modal-actions" }, [
      el("button", { class: "btn ghost", text: "取消", onclick: close }),
      el("button", { class: "btn", text: "确定", onclick: submit }),
    ]))
    setTimeout(() => { input.focus(); input.select() }, 40)
  })
}

function confirmModal(titleText, message, onOk) {
  openModal(titleText, (body, close) => {
    body.append(el("div", { class: "modal-text", text: message }))
    body.append(el("div", { class: "modal-actions" }, [
      el("button", { class: "btn ghost", text: "取消", onclick: close }),
      el("button", { class: "btn danger", text: "删除", onclick: () => { close(); onOk() } }),
    ]))
  })
}

function openShare(item) {
  openModal("分享「" + item.name + "」", (body, close) => {
    const choices = [["1 小时", 1], ["24 小时", 24], ["7 天", 168], ["永久", 0]]
    const remembered = Number(localStorage.getItem("ds.shareTtl"))
    let selected = choices.some((c) => c[1] === remembered) ? remembered : 24
    const seg = el("div", { class: "seg" })
    for (const [label, hours] of choices) {
      const button = el("button", {
        class: "seg-item" + (hours === selected ? " is-on" : ""),
        text: label,
        onclick: () => {
          selected = hours
          for (const other of seg.children) other.classList.toggle("is-on", other === button)
        },
      })
      seg.append(button)
    }
    const result = el("div", { class: "share-result" })
    const primary = el("button", { class: "btn", text: "创建链接" })
    primary.addEventListener("click", async () => {
      try {
        localStorage.setItem("ds.shareTtl", String(selected))
        const data = await post("api/shares", { nodeId: item.id, ttlHours: selected })
        const url = location.origin + data.url
        const copied = await copyText(url)
        result.append(el("div", { class: "share-url", text: url }))
        result.append(el("div", { class: "hint", text: copied ? "已复制到剪贴板" : "复制失败，可以手动选中上方的链接" }))
        primary.textContent = "完成"
        primary.onclick = close
        toast("分享链接已生成")
        refreshState()
      } catch (err) {
        toast(err.message, true)
      }
    })
    body.append(el("div", { class: "hint", text: "链接有效期" }))
    body.append(seg)
    body.append(result)
    body.append(el("div", { class: "modal-actions" }, [
      el("button", { class: "btn ghost", text: "取消", onclick: close }),
      primary,
    ]))
  })
}

let sharesRenderId = 0
async function loadShares() {
  const renderId = ++sharesRenderId
  let data
  try {
    data = await api("api/shares")
  } catch (err) {
    toast(err.message, true)
    return
  }
  if (renderId !== sharesRenderId) return
  const box = $("#crumbs")
  box.innerHTML = ""
  box.append(el("span", { text: "分享链接" }))
  const list = $("#list")
  list.innerHTML = ""
  if (!data.items.length) {
    list.append(el("div", { class: "empty" }, [
      el("div", { text: "还没有分享链接。" }),
      el("div", { class: "rail-hint", text: "在文件行上点分享按钮即可生成，链接可以设有效期或永久。" }),
    ]))
    return
  }
  for (const share of data.items) {
    const state2 = share.expired ? "已过期" : (share.expiresAt ? new Date(share.expiresAt).toLocaleString("zh-CN") : "永久有效")
    const row = el("div", { class: "row" }, [
      el("div", { class: "icon", text: icon(share.name) }),
      el("div", { class: "name", text: share.name }),
      el("div", { class: "size", text: state2 }),
      el("div", { class: "time", text: "下载 " + share.downloads + " 次" }),
      el("div", { class: "ops" }),
    ])
    const ops = row.querySelector(".ops")
    ops.append(opBtn("share", "复制链接", async () => {
      const ok = await copyText(location.origin + share.url)
      toast(ok ? "已复制" : "复制失败，请手动选中")
    }))
    ops.append(opBtn("trash", "撤销链接", async () => {
      try {
        await api("api/shares/" + share.token, { method: "DELETE" })
        loadShares()
      } catch (err) {
        toast(err.message, true)
      }
    }, "danger"))
    list.append(row)
  }
}

let draggedNode = null

async function moveNode(nodeId, targetId, nodeName) {
  try {
    const res = await post("api/nodes/" + nodeId + "/move", { parentId: targetId })
    toast(res.unchanged ? "已经在这里了" : ("已移动「" + nodeName + "」" + (res.name && res.name !== nodeName ? "，重命名为 " + res.name : "")))
    loadFiles(state.parent)
  } catch (err) {
    toast(err.message, true)
  }
}

function openRename(item) {
  promptModal("重命名", item.name, "新名称", async (name) => {
    try {
      const res = await post("api/nodes/" + item.id + "/rename", { name })
      toast(res.name === name ? "已重命名" : "已重命名为 " + res.name)
      if (state.view === "files") loadFiles(state.parent)
      else if (state.view === "inbox") loadInbox()
    } catch (err) {
      toast(err.message, true)
    }
  })
}

async function openPair() {
  let data
  try {
    data = await api("api/pair-url")
  } catch (err) {
    toast(err.message, true)
    return
  }
  openModal("手机扫码打开", (body, close) => {
    if (!window.qrcode) {
      body.append(el("div", { class: "hint", text: "二维码组件没有加载，请刷新页面重试" }))
      return
    }
    const generator = window.qrcode(0, "M")
    generator.addData(data.url)
    generator.make()
    const box = el("div", { class: "qr" })
    box.innerHTML = generator.createSvgTag({ cellSize: 8, margin: 16 })
    body.append(box)
    body.append(el("div", { class: "share-url", text: data.url }))
    body.append(el("div", { class: "hint", text: "用手机相机或微信扫一下，会自动登录并进入传输站。" }))
    body.append(el("div", { class: "modal-actions" }, [
      el("button", { class: "btn", text: "完成", onclick: close }),
    ]))
  })
}

function openMove(item, currentParent) {
  openMoveFor([item.id], item.name, currentParent, () => loadFiles(state.parent))
}

function openMoveFor(ids, displayName, currentParent, onDone) {
  const blocked = new Set(ids)
  openModal("移动「" + displayName + "」" + (ids.length > 1 ? " 等 " + ids.length + " 项" : ""), (body, close) => {
    let target = currentParent
    const crumbs = el("div", { class: "crumbs" })
    const picker = el("div", { class: "picker" })
    const confirm = el("button", { class: "btn", text: "移到这里" })
    confirm.addEventListener("click", async () => {
      close()
      let moved = 0
      for (const id of ids) {
        try {
          await post("api/nodes/" + id + "/move", { parentId: target })
          moved++
        } catch (err) {
          toast(err.message, true)
        }
      }
      if (moved > 0) toast("已移动 " + moved + " 项")
      if (onDone) onDone()
      else loadFiles(state.parent)
    })
    async function render() {
      let data
      try {
        data = await api("api/files" + (target ? "?parent=" + encodeURIComponent(target) : ""))
      } catch (err) {
        toast(err.message, true)
        return
      }
      crumbs.innerHTML = ""
      crumbs.append(el("button", { text: "全部文件", onclick: () => { target = null; render() } }))
      for (const crumb of data.breadcrumb) {
        crumbs.append(el("span", { class: "sep", text: "/" }))
        crumbs.append(el("button", { text: crumb.name, onclick: () => { target = crumb.id; render() } }))
      }
      picker.innerHTML = ""
      const folders = data.items.filter((entry) => entry.kind === "folder" && !blocked.has(entry.id))
      if (!folders.length) picker.append(el("div", { class: "hint", text: "这里没有子文件夹" }))
      for (const folder of folders) {
        picker.append(el("button", {
          class: "picker-item",
          text: "📁  " + folder.name,
          onclick: () => { target = folder.id; render() },
        }))
      }
      confirm.disabled = (data.parent ?? null) === (currentParent ?? null)
    }
    body.append(crumbs, picker, el("div", { class: "modal-actions" }, [
      el("button", { class: "btn ghost", text: "取消", onclick: close }),
      confirm,
    ]))
    render()
  })
}

function updateBatchBar() {
  const bar = $("#batchBar")
  const count = state.selection.size
  bar.hidden = count === 0
  $("#batchCount").textContent = "已选 " + count + " 项"
  for (const row of document.querySelectorAll(".row")) {
    const box = row.querySelector(".pick")
    if (box) box.checked = state.selection.has(row.dataset.id)
    row.classList.toggle("is-selected", state.selection.has(row.dataset.id))
  }
}

function clearSelection() {
  state.selection.clear()
  updateBatchBar()
}

function makeCheckbox(item) {
  const wrap = el("label", { class: "pick-wrap" })
  const box = el("input", { type: "checkbox", class: "pick" })
  box.addEventListener("change", () => {
    if (box.checked) state.selection.add(item.id)
    else state.selection.delete(item.id)
    updateBatchBar()
  })
  wrap.append(box)
  return wrap
}

async function batchDelete() {
  const ids = Array.from(state.selection)
  if (!ids.length) return
  confirmModal("删除 " + ids.length + " 项", "这些内容会进入回收站，可以恢复。", async () => {
    let ok = 0
    for (const id of ids) {
      try { await api("api/nodes/" + id, { method: "DELETE" }); ok++ } catch (err) { /* keep going */ }
    }
    clearSelection()
    toast("已移入回收站 " + ok + " 项")
    loadFiles(state.parent)
    refreshState()
  })
}

async function batchMove() {
  const ids = Array.from(state.selection)
  if (!ids.length) return
  const first = state.items.find((i) => i.id === ids[0]) || { id: ids[0], name: ids.length + " 项" }
  openMoveFor(ids, first.name, state.parent, () => {
    clearSelection()
    loadFiles(state.parent)
  })
}

async function loadTrash() {
  const renderId = ++trashRenderId
  let data
  try {
    data = await api("api/trash")
  } catch (err) {
    toast(err.message, true)
    return
  }
  if (renderId !== trashRenderId) return
  const box = $("#crumbs")
  box.innerHTML = ""
  box.append(el("span", { text: "回收站" }))
  const list = $("#list")
  list.innerHTML = ""
  state.trash = data.items
  if (!data.items.length) {
    list.append(el("div", { class: "empty", text: "回收站是空的。" }))
    return
  }
  for (const item of data.items) {
    const row = el("div", { class: "row" }, [
      el("div", { class: "icon", text: icon(item.name, item.kind) }),
      el("div", { class: "name", text: item.name }),
      el("div", { class: "size", text: item.kind === "folder" ? "—" : humanSize(item.size) }),
      el("div", { class: "time", text: ago(item.deletedAt) + "删除" }),
      el("div", { class: "ops" }),
    ])
    const ops = row.querySelector(".ops")
    ops.append(opBtn("restore", "恢复", () => restoreNode(item)))
    ops.append(opBtn("trash", "彻底删除", () => purgeNode(item), "danger"))
    list.append(row)
  }
  list.append(el("div", { class: "trash-foot" }, [
    el("span", { class: "hint", text: "回收站中的内容保留 " + data.purgeInDays + " 天后自动清除" }),
    el("button", {
      class: "btn ghost small danger-text", text: "清空回收站",
      onclick: () => confirmModal("清空回收站", "所有内容将被永久删除，无法恢复。", async () => {
        try {
          const res = await api("api/trash", { method: "DELETE" })
          toast("已永久删除 " + res.removed + " 项")
          loadTrash()
          refreshState()
        } catch (err) { toast(err.message, true) }
      }),
    }),
  ]))
}

async function restoreNode(item) {
  try {
    const res = await post("api/nodes/" + item.id + "/restore", {})
    toast(res.movedToRoot ? "已恢复到根目录（原位置已不存在）" : "已恢复")
    loadTrash()
    refreshState()
  } catch (err) {
    toast(err.message, true)
  }
}

async function purgeNode(item) {
  confirmModal("彻底删除", "「" + item.name + "」将被永久删除，无法恢复。", async () => {
    try {
      await api("api/nodes/" + item.id + "?purge=1", { method: "DELETE" })
      loadTrash()
      refreshState()
    } catch (err) { toast(err.message, true) }
  })
}

let trashRenderId = 0
let searchRenderId = 0
async function loadSearch(query) {
  const renderId = ++searchRenderId
  let data
  try {
    data = await api("api/search?q=" + encodeURIComponent(query))
  } catch (err) {
    toast(err.message, true)
    return
  }
  if (renderId !== searchRenderId) return
  const box = $("#crumbs")
  box.innerHTML = ""
  box.append(el("span", { text: "搜索「" + data.query + "」 · " + data.items.length + " 个结果" }))
  const list = $("#list")
  list.innerHTML = ""
  if (!data.items.length) {
    list.append(el("div", { class: "empty", text: "没有找到匹配的文件。" }))
    return
  }
  for (const item of data.items) {
    const isFolder = item.kind === "folder"
    const row = el("div", { class: "row" }, [
      el("div", { class: "icon", text: icon(item.name, item.kind) }),
      el("div", {
        class: "name" + (isFolder ? " folder" : ""),
        text: item.name,
        onclick: () => { $("#searchInput").value = ""; exitSearch(); isFolder ? loadFiles(item.id) : loadFiles(item.parentId) },
      }),
      el("div", { class: "size", text: isFolder ? "—" : humanSize(item.size) }),
      el("div", { class: "time", text: item.path || "根目录" }),
      el("div", { class: "ops" }),
    ])
    const ops = row.querySelector(".ops")
    if (!isFolder) ops.append(opBtn("download", "下载", () => { window.location.href = "api/download/" + item.id }))
    ops.append(opBtn("move", "所在位置", () => { $("#searchInput").value = ""; exitSearch(); loadFiles(item.parentId) }))
    list.append(row)
  }
}

function exitSearch() {
  state.searching = false
  $("#searchInput").blur()
}

function setView(view) {
  state.view = view
  for (const btn of document.querySelectorAll(".nav-item")) {
    btn.classList.toggle("is-active", btn.dataset.view === view)
  }
  $("#newFolder").style.display = view === "inbox" || view === "trash" || view === "shares" ? "none" : ""
  $("#qrBtn").hidden = view !== "inbox"
  $("#pick").style.display = view === "trash" || view === "shares" ? "none" : ""
  clearSelection()
  if (view === "files") loadFiles(state.parent)
  if (view === "inbox") loadInbox()
  if (view === "shares") loadShares()
  if (view === "trash") loadTrash()
}

let filesRenderId = 0
async function loadFiles(parent) {
  const renderId = ++filesRenderId
  try {
    const data = await api("api/files" + (parent ? "?parent=" + encodeURIComponent(parent) : ""))
    if (renderId !== filesRenderId) return
    state.parent = data.parent
    state.breadcrumb = data.breadcrumb
    state.items = data.items
    state.selected = null
    state.searching = false
    renderCrumbs()
    renderFiles()
    updateBatchBar()
  } catch (err) {
    toast(err.message, true)
  }
}

function renderCrumbs() {
  const box = $("#crumbs")
  box.innerHTML = ""
  box.append(el("button", { text: "全部文件", onclick: () => loadFiles(null) }))
  for (const crumb of state.breadcrumb) {
    box.append(el("span", { class: "sep", text: "/" }))
    box.append(el("button", { text: crumb.name, onclick: () => loadFiles(crumb.id) }))
  }
}

function renderFiles() {
  const list = $("#list")
  list.innerHTML = ""
  if (!state.items.length) {
    list.append(el("div", { class: "empty", text: "这里还是空的 —— 把文件拖进来试试" }))
    return
  }
  for (const item of state.items) {
    const isFolder = item.kind === "folder"
    const row = el("div", { class: "row", "data-id": item.id }, [
      makeCheckbox(item),
      el("div", { class: "icon", text: icon(item.name, item.kind) }),
      el("div", {
        class: "name" + (isFolder ? " folder" : ""),
        text: item.name,
        onclick: () => {
          if (isFolder) loadFiles(item.id)
          else selectRow(item, row)
        },
      }),
      el("div", { class: "size", text: isFolder ? "—" : humanSize(item.size) }),
      el("div", { class: "time", text: ago(item.mtime) }),
      el("div", { class: "ops" }),
    ])
    const ops = row.querySelector(".ops")
    if (!isFolder) {
      ops.append(opBtn("download", "下载", () => { window.location.href = "api/download/" + item.id }))
      ops.append(opBtn("share", "分享链接", () => openShare(item)))
    }
    ops.append(opBtn("move", "移动到…", () => openMove(item, state.parent)))
    ops.append(opBtn("rename", "重命名", () => openRename(item)))

    row.draggable = true
    row.addEventListener("dragstart", (event) => {
      draggedNode = item
      if (event.dataTransfer) {
        event.dataTransfer.setData("text/plain", item.id)
        event.dataTransfer.effectAllowed = "move"
      }
    })
    row.addEventListener("dragend", () => { draggedNode = null })
    if (isFolder) {
      row.addEventListener("dragover", (event) => {
        if (!draggedNode || draggedNode.id === item.id) return
        event.preventDefault()
        event.stopPropagation()
        row.classList.add("drop-target")
      })
      row.addEventListener("dragleave", () => row.classList.remove("drop-target"))
      row.addEventListener("drop", (event) => {
        if (!draggedNode) return
        event.preventDefault()
        event.stopPropagation()
        row.classList.remove("drop-target")
        const source = draggedNode
        draggedNode = null
        moveNode(source.id, item.id, source.name)
      })
    }
    ops.append(opBtn("trash", "删除", () => {
      confirmModal("删除文件", "「" + item.name + "」将被删除，无法恢复。", async () => {
        try {
          await api("api/nodes/" + item.id, { method: "DELETE" })
          loadFiles(state.parent)
          refreshState()
        } catch (err) {
          toast(err.message, true)
        }
      })
    }, "danger"))
    list.append(row)
  }
}

function selectRow(item, row) {
  state.selected = item
  for (const other of document.querySelectorAll(".row")) other.classList.remove("is-selected")
  row.classList.add("is-selected")
}

let inboxRenderId = 0
async function loadInbox() {
  const renderId = ++inboxRenderId
  let data
  try {
    data = await api("api/inbox")
  } catch (err) {
    toast(err.message, true)
    return
  }
  if (renderId !== inboxRenderId) return
  const box = $("#crumbs")
  box.innerHTML = ""
  box.append(el("span", { text: "传输站" }))
  const list = $("#list")
  list.innerHTML = ""
  state.inbox = data.items
  if (!data.items.length) {
    list.append(el("div", { class: "empty" }, [
      el("div", { text: "这里空着。手机上打开这个页面，选个文件传上来。" }),
      el("div", { class: "rail-hint", text: "其他设备会立刻收到通知；超过 " + data.ttlHours + " 小时自动清理。" }),
    ]))
    return
  }
  for (const item of data.items) {
    const left = item.expiresAt ? Math.max(0, Math.round((item.expiresAt - Date.now()) / 3600000)) : null
    const row = el("div", { class: "row" }, [
      el("div", { class: "icon", text: icon(item.name) }),
      el("div", { class: "name", text: item.name }),
      el("div", { class: "size", text: humanSize(item.size) }),
      el("div", { class: "time", text: left === null ? ago(item.at) : "剩 " + left + " 小时" }),
      el("div", { class: "ops" }),
    ])
    const ops = row.querySelector(".ops")
    ops.style.opacity = "1"
    ops.append(opBtn("download", "保存", () => { window.location.href = "api/download/" + item.id }))
    ops.append(opBtn("downloadCheck", "保存并删除", () => {
      window.location.href = "api/download/" + item.id + "?burn=1"
      setTimeout(() => { if (state.view === "inbox") loadInbox() }, 2000)
    }))
    ops.append(opBtn("trash", "删除", () => {
      confirmModal("丢弃这个文件", "「" + item.name + "」将从传输站移除。", async () => {
        try {
          await api("api/nodes/" + item.id, { method: "DELETE" })
          loadInbox()
          refreshState()
        } catch (err) {
          toast(err.message, true)
        }
      })
    }, "danger"))
    list.append(row)
  }
}

async function sha256Of(file) {
  if (file.size > 256 * 1024 * 1024) return null
  if (window.isSecureContext && window.crypto && window.crypto.subtle) {
    try {
      const buf = await file.arrayBuffer()
      const digest = await crypto.subtle.digest("SHA-256", buf)
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
    } catch (err) {
      // fall through to the portable implementation
    }
  }
  return sha256FileHex(file)
}

function jobCard(name) {
  const bar = el("i", {})
  const label = el("span", { text: "0%" })
  const card = el("div", { class: "job" }, [
    el("div", { class: "t" }, [el("span", { text: name }), label]),
    el("div", { class: "bar" }, [bar]),
  ])
  $("#queue").append(card)
  return {
    progress(ratio) {
      bar.style.width = Math.round(ratio * 100) + "%"
      label.textContent = Math.round(ratio * 100) + "%"
    },
    done(text) {
      label.textContent = text || "完成"
      setTimeout(() => card.remove(), 1600)
    },
    fail(text) {
      label.textContent = text || "失败"
      card.style.borderColor = "rgba(255,59,48,.4)"
      setTimeout(() => card.remove(), 5000)
    },
  }
}

async function uploadFile(file, parentId) {
  const card = jobCard(file.name)
  try {
    const hash = await sha256Of(file)
    const init = await post("api/upload/init", { name: file.name, size: file.size, hash, parentId })
    if (init.instant) {
      card.progress(1)
      card.done(init.duplicated ? "已在传输站" : "秒传")
      return
    }
    const chunkSize = init.chunkSize || 4194304
    let offset = 0
    while (offset < file.size) {
      const part = file.slice(offset, Math.min(offset + chunkSize, file.size))
      const buf = await part.arrayBuffer()
      const res = await fetch("api/upload/" + init.uploadId + "?offset=" + offset, { method: "PUT", body: buf })
      if (!res.ok) throw new Error("chunk failed: HTTP " + res.status)
      offset += buf.byteLength
      card.progress(offset / file.size)
    }
    const done = await post("api/upload/" + init.uploadId + "/complete", {})
    card.done()
    return done
  } catch (err) {
    card.fail("失败")
    toast(file.name + "：" + err.message, true)
    throw err
  }
}

async function uploadMany(files) {
  const target = state.view === "inbox" ? "inbox" : state.parent
  for (const file of files) {
    try {
      await uploadFile(file, target)
    } catch (err) {
      // already surfaced by uploadFile
    }
  }
  if (state.view === "inbox") loadInbox()
  else if (state.view === "files") loadFiles(state.parent)
  refreshState()
}

async function refreshState() {
  try {
    const data = await api("api/state")
    const badge = $("#inboxBadge")
    badge.hidden = data.inbox.count === 0
    badge.textContent = String(data.inbox.count)
    $("#usage").textContent = humanSize(data.stats.logicalBytes)
    $("#saved").textContent = "实际占用 " + humanSize(data.stats.physicalBytes) +
      (data.stats.savedBytes > 0 ? " · 去重省下 " + humanSize(data.stats.savedBytes) : "")
    const conn = $("#conn")
    conn.textContent = "已连接"
    conn.className = "pill on"
  } catch (err) {
    const conn = $("#conn")
    conn.textContent = "离线"
    conn.className = "pill off"
  }
}

function connectEvents() {
  const es = new EventSource("api/events")
  es.onopen = () => {
    const conn = $("#conn")
    conn.textContent = "已连接"
    conn.className = "pill on"
  }
  es.onerror = () => {
    const conn = $("#conn")
    conn.textContent = "重连中"
    conn.className = "pill off"
  }
  es.addEventListener("inbox", (event) => {
    const data = JSON.parse(event.data)
    toast("传输站收到：" + data.name)
    if (state.view === "inbox") loadInbox()
    refreshState()
  })
  es.addEventListener("files", () => {
    if (state.view === "files") loadFiles(state.parent)
    refreshState()
  })
}

$("#deviceName").textContent = deviceLabel
$("#pick").addEventListener("click", () => $("#fileInput").click())
$("#fileInput").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || [])
  event.target.value = ""
  if (files.length) uploadMany(files)
})
$("#qrBtn").addEventListener("click", () => openPair())
$("#newFolder").addEventListener("click", () => {
  promptModal("新建文件夹", "新建文件夹", "文件夹名称", async (name) => {
    try {
      await post("api/folders", { name, parentId: state.parent })
      loadFiles(state.parent)
    } catch (err) {
      toast(err.message, true)
    }
  })
})
for (const btn of document.querySelectorAll(".nav-item")) {
  btn.addEventListener("click", () => setView(btn.dataset.view))
}

let searchTimer = 0
$("#searchInput").addEventListener("input", (event) => {
  const value = event.target.value.trim()
  clearTimeout(searchTimer)
  if (!value) {
    exitSearch()
    setView(state.view === "trash" ? "trash" : "files")
    return
  }
  searchTimer = setTimeout(() => {
    state.searching = true
    $("#newFolder").style.display = "none"
    loadSearch(value)
  }, 220)
})
$("#searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.target.value = ""
    exitSearch()
    setView("files")
  }
})

$("#batchDelete").addEventListener("click", () => batchDelete())
$("#batchMove").addEventListener("click", () => batchMove())
$("#batchClear").addEventListener("click", () => clearSelection())

let dragDepth = 0
window.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer) return
  if (draggedNode) return
  dragDepth++
  document.body.classList.add("dragging")
})
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) document.body.classList.remove("dragging")
})
window.addEventListener("dragover", (event) => event.preventDefault())
window.addEventListener("drop", (event) => {
  event.preventDefault()
  dragDepth = 0
  document.body.classList.remove("dragging")
  if (draggedNode) { draggedNode = null; return }
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) uploadMany(files)
})

connectEvents()
refreshState()
loadFiles(null)
setInterval(refreshState, 20000)
