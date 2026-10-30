import { readFile } from 'node:fs/promises'
import { readPolicyWorkbook, savePolicyInput, policyInputSource } from '../server/policyIO.js'
import { analyzePolicy } from '../src/policyAnalysis.js'
import { NATIONAL_DAY_POLICY } from '../src/policyRules.js'
import { savePolicyReport } from '../server/policyReports.js'

const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
if (!process.argv.includes('--base') || !process.argv.includes('--consumption')) throw new Error('请传入 --base 客户base.xlsx --consumption 消耗明细.xlsx')
const basePath = argument('--base')
const consumptionPath = argument('--consumption')
const [baseBytes, consumptionBytes] = await Promise.all([readFile(basePath), readFile(consumptionPath)])
const [base, consumption] = await Promise.all([readPolicyWorkbook(baseBytes, basePath), readPolicyWorkbook(consumptionBytes, consumptionPath)])
const sources = [policyInputSource(baseBytes, basePath, base.sheet), policyInputSource(consumptionBytes, consumptionPath, consumption.sheet)]
const input = { baseRows: base.rows, consumptionRows: consumption.rows, rules: NATIONAL_DAY_POLICY, sources }
const report = { ...analyzePolicy(input.baseRows, input.consumptionRows, input.rules), sources }
await savePolicyInput(input)
const exports = await savePolicyReport(report)
console.log(JSON.stringify({ summary: report.summary, reconciliation: report.reconciliation, exports }, null, 2))
