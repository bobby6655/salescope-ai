import { readFile, writeFile } from 'node:fs/promises'
const input = process.argv[2]
const url = new URL(input)
if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.vercel.app') || url.hostname === 'bobbyyang.online' || url.hostname === 'www.bobbyyang.online')) throw new Error('仅允许本次部署的Vercel地址和已提供域名')
const file = 'runtime-data/local-host/config.json'
const config = JSON.parse(await readFile(file,'utf8'))
const aliases = JSON.parse(config.PUBLIC_ORIGIN_ALIASES || '[]')
config.PUBLIC_ORIGIN_ALIASES = JSON.stringify([...new Set([...aliases, url.origin])])
await writeFile(file,JSON.stringify(config),{mode:0o600})
console.log(`已登记来源 ${url.origin}，未输出模型配置；重启后端后生效。`)
