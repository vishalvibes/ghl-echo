import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * AES-256-GCM for OAuth tokens at rest. GHL access tokens grant read access
 * to every conversation in a customer's account — a database dump must not
 * be enough to use them.
 *
 * Format: base64(iv || ciphertext || authTag), iv 12 bytes, tag 16 bytes.
 */

const IV_LENGTH = 12
const TAG_LENGTH = 16

function key(): Buffer {
  return Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex')
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64')
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64')
  if (raw.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Encrypted token too short — wrong format or truncated')
  }
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(raw.length - TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Decrypts a GHL Custom Page SSO payload: OpenSSL's legacy "Salted__" format
 * (CryptoJS.AES.encrypt(json, sharedSecretPassphrase) on GHL's side) —
 * MD5-based EVP_BytesToKey deriving a 32-byte key + 16-byte IV from the
 * shared secret and an 8-byte salt embedded in the ciphertext, then
 * AES-256-CBC. This matches GHL's own marketplace-app-template exactly;
 * it is not our own encryption scheme, so the format is fixed by them.
 */
export function decryptSsoPayload(base64Payload: string): unknown {
  const KEY_SIZE = 32
  const IV_SIZE = 16
  const SALT_SIZE = 8

  const raw = Buffer.from(base64Payload, 'base64')
  const salt = raw.subarray(SALT_SIZE, IV_SIZE)
  const ciphertext = raw.subarray(IV_SIZE)

  let derived = Buffer.alloc(0)
  while (derived.length < KEY_SIZE + IV_SIZE) {
    derived = Buffer.concat([
      derived,
      createHash('md5')
        .update(Buffer.concat([derived.subarray(-IV_SIZE), Buffer.from(env.GHL_SSO_KEY, 'utf8'), salt]))
        .digest(),
    ])
  }

  const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, KEY_SIZE), derived.subarray(KEY_SIZE, KEY_SIZE + IV_SIZE))
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}
