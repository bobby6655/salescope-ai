import { scryptSync, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
// 从标准输入接收密码，避免写入命令参数、终端历史或仓库。
const [username, filename] = process.argv.slice(2)
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username || '') || ['__proto__', 'constructor', 'prototype'].includes(username) || !filename) throw new Error('用法：node scripts/create-user.mjs 用户名 输出JSON文件；密码从标准输入读取')
let input = ''
for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024) throw new Error('密码过长') }
const password = input.replace(/\r?\n$/, '')
if (password.length < 12 || password.length > 256) throw new Error('密码需12到256个字符')
let users = {}
try { users = JSON.parse(await readFile(filename, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const salt = randomBytes(16).toString('hex')
users[username] = `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`
await writeFile(filename, JSON.stringify(users), { mode: 0o600 })
console.log(`已保存账号${username}的密码哈希，未输出密码。`)
