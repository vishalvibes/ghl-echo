import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
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
