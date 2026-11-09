import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = process.env.V3_VENV || path.join(root, 'runtime-data/v3-python')
const python = process.env.V3_PYTHON || path.join(directory, 'bin/python')
if (!process.env.V3_PYTHON) {
  if (!existsSync(python)) execFileSync('uv', ['venv', '--python', '3.11', directory], { stdio: 'inherit' })
  execFileSync('uv', ['pip', 'sync', '--python', python, path.join(root, 'server/v3/requirements.lock')], { stdio: 'inherit' })
}
execFileSync(python, [path.join(root, 'server/v3/worker.py')], { input: JSON.stringify({ action: 'health' }), stdio: ['pipe', 'inherit', 'inherit'] })
