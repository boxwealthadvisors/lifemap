// Small dependency-free TOTP (RFC 6238) helper: base32 secrets + HMAC-SHA1 HOTP, 30s steps, 6 digits.
import crypto from 'crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_ISSUER = 'LifeMap'

export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]+/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) throw new Error('Invalid base32 secret')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes))
}

export function hotp(secretBase32, counter, digits = TOTP_DIGITS) {
  const key = base32Decode(secretBase32)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export function totpAt(secretBase32, timeMs = Date.now()) {
  return hotp(secretBase32, Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS))
}

// Accepts the current 30s step plus `window` steps either side to tolerate clock drift.
export function verifyTotp(secretBase32, code, { window = 1, timeMs = Date.now() } = {}) {
  const clean = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean) || !secretBase32) return false
  let secret
  try {
    secret = String(secretBase32)
    base32Decode(secret)
  } catch {
    return false
  }
  const step = Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS)
  const given = Buffer.from(clean)
  let ok = false
  for (let i = -window; i <= window; i += 1) {
    const expected = Buffer.from(hotp(secret, step + i))
    if (crypto.timingSafeEqual(given, expected)) ok = true
  }
  return ok
}

export function otpauthUrl({ secret, account, issuer = TOTP_ISSUER }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---- at-rest protection for stored secrets (AES-256-GCM, key from TOTP_ENC_KEY or JWT_SECRET) ----

function encKey() {
  return crypto
    .createHash('sha256')
    .update(process.env.TOTP_ENC_KEY || process.env.JWT_SECRET || 'lifemap-totp')
    .digest()
}

export function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

// Returns the base32 secret, or null when it cannot be decrypted. Plain base32 values pass through.
export function decryptTotpSecret(stored) {
  if (!stored) return null
  const text = String(stored)
  if (!text.startsWith('enc:v1:')) return text
  try {
    const [, , iv, tag, ct] = text.split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
