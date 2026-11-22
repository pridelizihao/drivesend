const BASE = process.env.BASE || "http://127.0.0.1:8792"
let pass = 0, fail = 0
const check = (n, ok, extra) => { if (ok) { pass++; console.log("PASS", n) } else { fail++; console.log("FAIL", n, JSON.stringify(extra ?? "").slice(0, 200)) } }

let cookie = ""
async function req(path, init) {
  const opts = Object.assign({}, init || {})
  opts.headers = Object.assign({ "content-type": "application/json" }, (init && init.headers) || {})
  if (cookie) opts.headers.cookie = cookie
  const res = await fetch(BASE + path, opts)
  const set = res.headers.get("set-cookie")
  if (set) cookie = set.split(";")[0]
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

let me = await req("/api/auth/me")
check("setup required on empty instance", me.data.setupRequired === true, me.data)
check("api blocked before setup", (await req("/api/files")).status === 401)
check("static page blocked before setup", (await req("/")).status === 401)

const short = await req("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "a", password: "123" }) })
check("rejects short credentials", short.status === 400, short.data)

const setup = await req("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "lizihao", password: "s3cret-pass" }) })
check("setup creates account", setup.status === 200 && setup.data.ok === true, setup.data)
check("session cookie issued", cookie.startsWith("ds_session="), cookie)

check("api allowed with session", (await req("/api/files")).status === 200)
me = await req("/api/auth/me")
check("me reports user", me.data.user && me.data.user.username === "lizihao", me.data)
check("setup no longer required", me.data.setupRequired === false, me.data.setupRequired)

const dup = await req("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: "other", password: "other-pass" }) })
check("second setup rejected", dup.status === 400, dup.data)

const saved = cookie
cookie = ""
check("anonymous blocked", (await req("/api/files")).status === 401)
const bad = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "lizihao", password: "wrong" }) })
check("wrong password rejected", bad.status === 401, bad.data)
const good = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "lizihao", password: "s3cret-pass" }) })
check("correct password accepted", good.status === 200 && good.data.ok === true, good.data)
check("listing works after login", (await req("/api/files")).status === 200)

const st = await req("/api/state")
check("state exposes quota", st.data.storage && st.data.storage.quotaBytes > 0, st.data.storage)

// quota: instance was started with a small limit
const big = Buffer.alloc(Number(process.env.BIG || 3 * 1024 * 1024), 65)
const init = await req("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "big.bin", size: big.length, hash: null, parentId: null }) })
check("over-quota upload refused", init.status === 413, init.data)

const small = Buffer.from("small file content")
const ok = await req("/api/upload/init", { method: "POST", body: JSON.stringify({ name: "small.txt", size: small.length, hash: null, parentId: null }) })
check("under-quota upload allowed", ok.status === 200 && !!ok.data.uploadId, ok.data)
await fetch(BASE + "/api/upload/" + ok.data.uploadId + "?offset=0", { method: "PUT", body: small, headers: { cookie: saved } })
const done = await req("/api/upload/" + ok.data.uploadId + "/complete", { method: "POST", body: "{}" })
check("upload completes", done.status === 200, done.data)

const after = await req("/api/state")
check("usage reflects upload", after.data.storage.usedBytes >= small.length, after.data.storage)

const out = await req("/api/auth/logout", { method: "POST", body: "{}" })
check("logout ok", out.status === 200, out.data)
check("session invalidated", (await req("/api/files")).status === 401)

console.log("---")
console.log("pass=" + pass + " fail=" + fail)
process.exit(fail === 0 ? 0 : 1)
