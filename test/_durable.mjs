import { authHeaders } from "./_auth.mjs"
const BASE = process.env.BASE
const AUTH = await authHeaders(BASE)
const j = async (p, init) => {
  const o = Object.assign({}, init || {}); o.headers = Object.assign({}, AUTH, (init && init.headers) || {})
  const res = await fetch(BASE + p, o); const t = await res.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  return { status: res.status, data: d }
}
const PHASE = process.env.PHASE
if (PHASE === "start") {
  const payload = Buffer.from("durable-upload-" + Date.now() + "-".repeat(400))
  const init = await j("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "dur.bin", size: payload.length, hash: null }) })
  const half = Math.floor(payload.length / 2)
  await fetch(BASE + "/api/upload/" + init.data.uploadId + "?offset=0", { method: "PUT", body: payload.subarray(0, half), headers: AUTH })
  console.log("ID=" + init.data.uploadId, "SIZE=" + payload.length, "HALF=" + half)
} else {
  const id = process.env.UPID
  const state = await j("/api/upload/" + id)
  console.log("AFTER_RESTART received=" + state.data.received)
  const total = state.data.size
  const rest = Buffer.alloc(total - state.data.received, 120)
  await fetch(BASE + "/api/upload/" + id + "?offset=" + state.data.received, { method: "PUT", body: rest, headers: AUTH })
  const done = await j("/api/upload/" + id + "/complete", { method: "POST", body: "{}" })
  console.log("COMPLETE", done.status, done.data.error || "ok")
  if (done.data.nodeId) await j("/api/nodes/" + done.data.nodeId + "?purge=1", { method: "DELETE" })
}
