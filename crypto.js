import crypto from "crypto"
import dotenv from "dotenv"
dotenv.config()

const algorithm = "aes-256-ctr"

export const encrypt = (text) => {
  if (!text) return null
  const key = Buffer.from(process.env.CRYPT_KEY.padEnd(32).slice(0, 32))
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()])
  return {
    iv: iv.toString("hex"),
    content: encrypted.toString("hex"),
  }
}

export const decrypt = (hash) => {
  if (!hash) return null
  const key = Buffer.from(process.env.CRYPT_KEY.padEnd(32).slice(0, 32))
  const decipher = crypto.createDecipheriv(
    algorithm,
    key,
    Buffer.from(hash.iv, "hex")
  )
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(hash.content, "hex")),
    decipher.final(),
  ])
  return decrypted.toString()
}
