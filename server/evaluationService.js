import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const evaluationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../evaluations')

export async function saveEvaluation(payload) {
  await mkdir(evaluationDir, { recursive: true })
  const filePath = path.join(evaluationDir, 'latest.json')
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return { filePath, relativePath: 'evaluations/latest.json', bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8') }
}
