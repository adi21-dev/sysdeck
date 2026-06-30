import crypto from "crypto"

function base32decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const cleaned = s.replace(/=+$/, "").replace(/\s/g, "")
  let bits = ""
  for (const c of cleaned.toUpperCase()) {
    const idx = alphabet.indexOf(c)
    if (idx < 0) continue
    bits += idx.toString(2).padStart(5, "0")
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function generateTotp(secretB32: string): string {
  const secret = base32decode(secretB32)
  const counter = Math.floor(Date.now() / 30000)
  const buf = Buffer.alloc(8)
  buf.writeBigUint64BE(BigInt(counter))
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(code % 1000000).padStart(6, "0")
}
