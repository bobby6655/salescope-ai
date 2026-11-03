import { storageDirectory, atomicWrite, storageIdentity } from './storageContext.js'
import { execFile } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { parseCsv } from '../src/datasetEngine.js'

export const policyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function readPolicyWorkbook(bytes, name) {
  if (/\.csv$/i.test(name)) return { name, sheet: 'CSV', rows: parseCsv(bytes.toString('utf8')).rows }
  if (!/\.xlsx$/i.test(name)) throw new Error('政策数据支持 .xlsx 或 UTF-8 CSV')
  const output = await new Promise((resolve, reject) => {
    const child = execFile('python3', [path.join(policyRoot, 'scripts/read-xlsx.py')], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => error ? reject(new Error(`Excel读取失败：${stderr.trim() || error.message}`)) : resolve(stdout))
    child.stdin.end(bytes)
  })
  const sheet = JSON.parse(output).sheets.find((item) => item.rows.length > 1)
  if (!sheet) throw new Error('Excel 没有含数据的工作表')
  const headers = sheet.rows[0].map((value) => String(value ?? '').trim())
  if (headers.some((value) => !value) || new Set(headers).size !== headers.length) throw new Error('Excel表头为空或重复')
  return { name, sheet: sheet.name, rows: sheet.rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null]))) }
}

export async function savePolicyInput(input) {
  await atomicWrite(path.join(storageDirectory('policy-data'), 'latest.json'), JSON.stringify(input))
}

export async function readPolicyInput() {
  if (storageIdentity()?.kind === 'guest') return JSON.parse(await readFile(path.join(policyRoot, 'data/policy-demo.json'), 'utf8'))
  try { return JSON.parse(await readFile(path.join(storageDirectory('policy-data'), 'latest.json'), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return JSON.parse(await readFile(path.join(policyRoot, 'data/policy-demo.json'), 'utf8'))
    throw error
  }
}

export const policyInputSource = (bytes, name, sheet) => ({ name: path.basename(name), sheet, sha256: createHash('sha256').update(bytes).digest('hex') })
