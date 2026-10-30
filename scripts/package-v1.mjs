import { readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const snapshotRoot = path.join(root, 'versions/v1')
const manifest = JSON.parse(await readFile(path.join(snapshotRoot, 'SNAPSHOT.json'), 'utf8'))
for (const entry of manifest.files) {
  const digest = createHash('sha256').update(await readFile(path.join(snapshotRoot, entry.file))).digest('hex')
  if (digest !== entry.sha256) throw new Error(`v1 快照发生变化：${entry.file}`)
}
await mkdir(path.join(root, 'releases'), { recursive: true })
const archive = path.join(root, 'releases/salescope-ai-v1.tar.gz')
execFileSync('tar', ['-czf', archive, '-C', snapshotRoot, ...manifest.files.map((entry) => entry.file), 'SNAPSHOT.json'])
console.log(`v1 程序包已生成：${archive}`)
