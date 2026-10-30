import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const state = JSON.parse(await readFile(path.join(root, 'runtime-data/local-host/state.json'), 'utf8'))
const url = new URL(state.url)
if (url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') || url.origin !== state.url) throw new Error('需要本机已运行的HTTPS隧道地址')
const backend = url.origin
const config = {
  framework: 'vite',
  installCommand: 'node scripts/install-public-deps.mjs',
  buildCommand: 'VITE_REQUIRE_AUTH=true npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/login', destination: `${backend}/login` },
    { source: '/auth/:path*', destination: `${backend}/auth/:path*` },
    { source: '/api/:path*', destination: `${backend}/api/:path*` },
    { source: '/charts/:path*', destination: `${backend}/charts/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
}
await writeFile(path.join(root, 'vercel.json'), JSON.stringify(config, null, 2)+'\n')
console.log(JSON.stringify({ backend, secrets: 'none', config: 'vercel.json' }))
