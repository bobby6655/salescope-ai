import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseCsv, executeQuery, resolveColumn } from '../src/datasetEngine.js'

let passed = 0
const check = (label, callback) => { callback(); passed += 1; console.log('PASS ' + label) }
for (const [file, column, expected] of [['sales-data.csv', '销售额', 57100], ['orders-en.csv', 'revenue', 7200], ['ads-data.csv', '消耗', 10000]]) {
  const dataset = parseCsv(await readFile(new URL('../data/' + file, import.meta.url), 'utf8'))
  check(file + ' 动态解析及真实求和', () => assert.equal(executeQuery(dataset, { measures: [{ column, aggregate: 'sum' }] }).value, expected))
}
check('空值不作为零参与平均', () => assert.equal(executeQuery(parseCsv('amount\n100\n\n300'), { measures: [{ column: 'amount', aggregate: 'avg' }] }).value, 200))
check('字段歧义需要确认', () => assert.throws(() => resolveColumn(parseCsv('net_amount,gross_amount\n80,100'), '收入'), /含义不明确/))
const manifest = JSON.parse(await readFile(new URL('../versions/v1/SNAPSHOT.json', import.meta.url), 'utf8'))
for (const entry of manifest.files) {
  const digest = createHash('sha256').update(await readFile(new URL('../versions/v1/' + entry.file, import.meta.url))).digest('hex')
  check('v1 快照完整：' + entry.file, () => assert.equal(digest, entry.sha256, entry.file + ' 与冻结快照不一致'))
}
const config = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
check('v2 版本及 v1 启动入口', () => { assert.equal(config.version, '2.0.0'); assert.ok(config.scripts['dev:v1']); assert.ok(config.scripts['package:v1']) })
console.log('检查结果：' + passed + '/' + passed + ' 项通过；更多行为检查请运行 npm test')
