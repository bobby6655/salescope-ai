import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const lock = await readFile('package-lock.json', 'utf8')
await writeFile('package-lock.json', lock.replaceAll('https://npm.corp.kuaishou.com/', 'https://registry.npmjs.org/'))
execFileSync('npm', ['ci', '--registry=https://registry.npmjs.org/'], { stdio:'inherit' })
