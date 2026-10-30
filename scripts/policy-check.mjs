import assert from 'node:assert/strict'
import { analyzePolicy } from '../src/policyAnalysis.js'
import { readPolicyInput } from '../server/policyIO.js'
import { policyMarkdown, policyCsv } from '../server/policyReports.js'

const input = await readPolicyInput()
const report = analyzePolicy(input.baseRows, input.consumptionRows, input.rules, input.options)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10)
assert.equal(report.summary.count, report.reconciliation.matchedCustomers + report.reconciliation.missingCustomers.length)
for (const groups of Object.values(report.groups)) {
  assert.equal(groups.reduce((total, group) => total + group.count, 0), report.summary.count)
  close(groups.reduce((total, group) => total + group.cost6, 0), report.summary.cost6)
  close(groups.reduce((total, group) => total + group.policyRebate, 0), report.summary.policyRebate)
  close(groups.reduce((total, group) => total + group.increment, 0), report.summary.increment)
  close(groups.reduce((total, group) => total + group.roiIncrement, 0), report.summary.roiIncrement)
  close(groups.reduce((total, group) => total + group.roiTotalRebate, 0), report.summary.roiTotalRebate)
}
if (report.summary.roiTotalRebate > 0) close(report.summary.roi, report.summary.roiIncrement / report.summary.roiTotalRebate)
close(report.trend.at(-1).cumulativeCost6, report.summary.cost6)
assert.ok(policyMarkdown(report).includes('base加权'))
assert.equal(policyCsv(report).split('\r\n').length, report.summary.count + 1)
console.log(JSON.stringify({ verified: true, phase: report.phase, customers: report.summary.count, matched: report.summary.matchedCount, cost6: report.summary.cost6, cost4: report.summary.cost4, policyRebate: report.summary.policyRebate, roi: report.summary.roi, roiCustomerCount: report.summary.roiCustomerCount, roiIncrement: report.summary.roiIncrement, roiTotalRebate: report.summary.roiTotalRebate, countRate: report.summary.countRate, baseWeightedRate: report.summary.baseWeightedRate }, null, 2))
