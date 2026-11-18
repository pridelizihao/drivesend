import { createHash, randomBytes } from "node:crypto"
import { sha256Bytes, sha256FileHex } from "../web/sha256.js"

let bad = 0
function check(name, a, b) {
  if (a === b) console.log("PASS", name)
  else { bad++; console.log("FAIL", name, a, b) }
}

check("empty", sha256Bytes(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
check("abc", sha256Bytes(new Uint8Array([97, 98, 99])), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

for (const size of [1, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000, 65536, 1048577]) {
  const buf = randomBytes(size)
  check("size " + size, sha256Bytes(new Uint8Array(buf)), createHash("sha256").update(buf).digest("hex"))
}

const big = randomBytes(3 * 1024 * 1024 + 17)
const file = new File([big], "big.bin")
const viaFile = await sha256FileHex(file, 1024 * 1024)
check("file streaming 3MB", viaFile, createHash("sha256").update(big).digest("hex"))

console.log(bad === 0 ? "ALL OK" : "FAILURES " + bad)
process.exit(bad === 0 ? 0 : 1)
