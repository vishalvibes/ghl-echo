import { createDecipheriv, createHash } from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Decrypt a HighLevel Custom Page SSO payload using the format fixed by its
 * marketplace-app template: OpenSSL's legacy `Salted__` envelope with an
 * MD5-based EVP_BytesToKey derivation and AES-256-CBC encryption.
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
        .update(
          Buffer.concat([
            derived.subarray(-IV_SIZE),
            Buffer.from(env.GHL_SSO_KEY, 'utf8'),
            salt,
          ]),
        )
        .digest(),
    ])
  }

  const decipher = createDecipheriv(
    'aes-256-cbc',
    derived.subarray(0, KEY_SIZE),
    derived.subarray(KEY_SIZE, KEY_SIZE + IV_SIZE),
  )
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}
