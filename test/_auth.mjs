// Shared login helper for the end-to-end suites.
// Uses DS_COOKIE if provided, otherwise creates the first account (setup) or logs in.
export async function authHeaders(base) {
  const user = process.env.DS_USER || "tester"
  const pass = process.env.DS_PASS || "tester-pass"
  const headers = { "content-type": "application/json" }
  if (process.env.DS_AUTH) {
    headers.authorization = "Bearer " + process.env.DS_AUTH
    return headers
  }
  // One session shared by every suite, so running them in sequence does not trip
  // the login throttle. Delete the file to force a fresh login.
  let cookie = process.env.DS_COOKIE || ""
  if (!cookie) {
    try {
      const fs = await import("node:fs")
      const file = new URL("./.session", import.meta.url)
      const saved = fs.readFileSync(file, "utf8").trim()
      if (saved && saved.split("=")[1]) {
        const probe = await fetch(base + "/api/auth/me", { headers: { cookie: saved } })
        const me = await probe.json()
        if (me.user) cookie = saved
      }
    } catch (err) { /* no cached session yet */ }
  }
  if (!cookie) {
    const me = await (await fetch(base + "/api/auth/me")).json()
    const path = me.setupRequired ? "/api/auth/setup" : "/api/auth/login"
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    })
    const set = res.headers.get("set-cookie")
    if (!set) throw new Error("login failed: " + res.status + " " + (await res.text()).slice(0, 120))
    cookie = set.split(";")[0]
  }
  headers.cookie = cookie
  try {
    const fs = await import("node:fs")
    fs.writeFileSync(new URL("./.session", import.meta.url), cookie)
  } catch (err) { /* caching the session is best-effort */ }
  return headers
}
