import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const context = new AsyncLocalStorage()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function withUserStorage(user, directory, callback) {
  return context.run({ user, directory: path.join(directory, createHash('sha256').update(user).digest('hex')) }, callback)
}
export function storageDirectory(kind) {
  if (!['policy-data', 'policy-reports', 'charts', 'evaluations'].includes(kind)) throw new Error('不支持的存储类型')
  return path.join(context.getStore()?.directory ?? root, kind)
}
export async function atomicWrite(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, filename)
}
