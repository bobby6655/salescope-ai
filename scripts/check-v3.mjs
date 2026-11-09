import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
execFileSync(process.env.V3_PYTHON || path.join(root, 'runtime-data/v3-python/bin/python'), [path.join(root, 'scripts/v3_worker_test.py')], { stdio: 'inherit' })
