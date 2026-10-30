import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzePolicy, summarizeCustomers, policyCustomerRows } from '../src/policyAnalysis.js';
import { NATIONAL_DAY_POLICY as RULES } from '../src/policyRules.js';
const dates = Array.from({
  length: 13
}, (value_, index) => new Date(Date.UTC(2026, 8, 25 + index)).toISOString().slice(0, 10));
const base = (customer, baseDaily = 1, type = '小游戏', department = '甲部门', sales = '甲销售') => ({
  客户: customer,
  属性: type,
  行业分组: department,
  负责销售: sales,
  'base(万/日)': baseDaily
});
const day = (customer, date, cost6, cost4 = cost6) => ({
  客户: customer,
  日期: date,
  'cost_6消耗(万)': cost6,
  'cost_4现金(万)': cost4
});
const daily = (customer, cost6, cashRate = 1) => dates.map(date => day(customer, date, cost6, cost6 * cashRate));
const close = (actual, expected, message = '') => {
  assert.ok(Number.isFinite(actual), `${message}: expected finite value, received ${actual}`);
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10, `${message}: ${actual} != ${expected}`);
};
const customer = report => report.customers[0];
test('all eight base tiers use inclusive lower and exclusive upper boundaries', () => {
  const cases = [['小游戏', .5, .35, .65, .04, .08], ['小游戏', 10, .30, .60, .04, .08], ['小游戏', 15, .25, .55, .04, .08], ['大游戏', .5, .40, .70, .06, .09], ['大游戏', 10, .35, .65, .06, .09], ['大游戏', 20, .30, .60, .06, .09], ['大游戏', 50, .25, .55, .06, .09], ['大游戏', 150, .20, .50, .06, .09]];
  for (const [type, value, growth1, growth2, rate1, rate2] of cases) {
    const client = customer(analyzePolicy([base('A', value, type)], daily('A', value)));
    assert.deepEqual([client.growth1, client.growth2, client.rate1, client.rate2], [growth1, growth2, rate1, rate2]);
  }
  for (const [type, boundary, previousGrowth] of [['小游戏', 10, .35], ['小游戏', 15, .30], ['大游戏', 10, .40], ['大游戏', 20, .35], ['大游戏', 50, .30], ['大游戏', 150, .25]]) {
    assert.equal(customer(analyzePolicy([base('A', boundary - 1e-6, type)], [])).growth1, previousGrowth);
  }
  assert.throws(() => analyzePolicy([base('A', .499999)], []), /档位/);
});
test('growth thresholds are inclusive and tier two replaces tier one without stacking', () => {
  for (const [growth, hit1, hit2, rate] of [[.35 - 1e-7, false, false, 0], [.35 - 1e-10, false, false, 0], [.35, true, false, .04], [.65 - 1e-7, true, false, .04], [.65 - 1e-10, true, false, .04], [.65, true, true, .08]]) {
    const client = customer(analyzePolicy([base('A')], daily('A', 1 + growth, .5)));
    assert.deepEqual([client.hit1, client.hit2], [hit1, hit2]);
    close(client.policyRebate, growth * 13 * .5 * rate, 'single attained tier rebate');
  }
});
test('explicit cash-adjusted cap governs rebates and preserves the documented example ambiguity warning', () => {
  const report = analyzePolicy([base('A', 10, '大游戏')], daily('A', 25, .9));
  close(customer(report).policyRebate, 15.795);
  assert.ok(report.warnings.some(warning => /公式/.test(warning) && /示例|例/.test(warning)));
  const capped = customer(analyzePolicy([base('A', 10, '大游戏')], daily('A', 100, .5)));
  close(capped.policyRebate, 22.815);
  assert.equal(capped.capped, true);
});
test('cost6 assesses growth; incremental cash funds framework and channel rebates', () => {
  const client = customer(analyzePolicy([base('A')], daily('A', 1.65, .5)));
  close(client.growth, .65);
  close(client.policyRebate, .338);
  close(client.annualRebate, 4.225 * .12);
  close(client.channelRebate, 4.225 * .085);
  close(client.roi, 8.45 / (.338 + 4.225 * .205));
  close(client.policyRoi, 25);
  const zeroCash = customer(analyzePolicy([base('A')], daily('A', 1.65, 0)));
  assert.equal(zeroCash.hit2, true);
  assert.equal(zeroCash.policyRebate, 0);
  assert.equal(zeroCash.roi, null);
});
test('missing days remain uncertain, explicit zero days do not, and zero-assumption is an explicit rule', () => {
  const report = analyzePolicy([base('absent'), base('partial'), base('zero')], [day('partial', dates[0], 1), ...daily('zero', 0)]);
  const [absent, partial, zero] = report.customers;
  assert.equal(absent.growth, null);
  assert.equal(absent.uncertain, true);
  assert.equal(absent.coverageDays, 0);
  assert.equal(partial.uncertain, true);
  assert.equal(partial.coverageDays, 1);
  assert.equal(zero.uncertain, false);
  assert.equal(zero.growth, -1);
  assert.equal(report.summary.matchedCount, 2);
  assert.equal(report.reconciliation.missingCustomerDays, 25);
  const confirmed = analyzePolicy([base('absent'), base('partial')], [day('partial', dates[0], 1)], {
    ...RULES,
    missingAsZero: true
  });
  assert.ok(confirmed.customers.every(client => !client.uncertain));
  assert.equal(confirmed.customers[0].growth, -1);
  assert.ok(report.warnings.some(warning => /待核验/.test(warning)));
});
test('all-base customer and base-weighted hit rates differ from consumption shares', () => {
  const report = analyzePolicy([base('winner', 1), base('loser', 9), base('missing', 10)], [...daily('winner', 1.65), ...daily('loser', 9)]);
  assert.equal(report.summary.count, 3);
  assert.equal(report.summary.matchedCount, 2);
  close(report.summary.countRate, 1 / 3);
  close(report.summary.baseWeightedRate, 1 / 20);
  close(report.summary.baseTotal, 20 * 13);
  assert.notEqual(report.summary.baseWeightedRate, 21.45 / report.summary.cost6);
});
test('ROI uses policy recipients for both increment and rebate totals, leaving portfolio spend unchanged', () => {
  const report = analyzePolicy([base('winner'), base('decline', 10)], [...daily('winner', 2), ...daily('decline', 8)]);
  close(report.summary.increment, -13);
  close(report.summary.policyRebate, 1.04);
  close(report.summary.roi, 13 / (1.04 + 13 * .205));
  assert.equal(report.summary.roiCustomerCount, 1);
  close(report.summary.roiIncrement, 13);
  close(report.summary.roiTotalRebate, 1.04 + 13 * .205);
  close(report.summary.policyRoi, 12.5);
  assert.notEqual(report.summary.roi, report.customers.reduce((subtotal, client) => subtotal + client.roi, 0) / 2);
  for (const field of ['department', 'sales', 'type']) {
    close(report.groups[field][0].increment, -13);
    close(report.groups[field][0].roi, report.summary.roi);
  }
  const sub = summarizeCustomers([report.customers[1]], 13);
  assert.equal(sub.roi, null);
  assert.equal(sub.roiCustomerCount, 0);
  assert.equal(report.customers[1].roi, null);
  assert.equal(report.customers[1].annualRebate, 0);
});
test('duplicate customer-days and normalized duplicate base identifiers cannot silently double-count', () => {
  assert.throws(() => analyzePolicy([base('A')], [day('A', dates[0], 2), day('A', dates[0], 2)]), /重复/);
  assert.throws(() => analyzePolicy([base(4399), base(' 4399 ')], []), /重复/);
  const report = analyzePolicy([base(4399)], daily(' 4399 ', 1.65));
  assert.equal(report.summary.matchedCount, 1);
  assert.equal(customer(report).customer, '4399');
  close(customer(report).cost6, 21.45);
});
test('date range is inclusive, out-of-period and out-of-cohort spend reconcile without inflating the portfolio', () => {
  const report = analyzePolicy([base('A')], [...daily('A', 2), day('A', '2026-09-24', 99), day('A', '2026-10-08', 99), day('outsider', dates[0], 100, 80)]);
  assert.equal(report.elapsedDays, 13);
  close(report.summary.cost6, 26);
  close(report.summary.cost4, 26);
  assert.equal(report.reconciliation.outOfPeriodRows, 2);
  assert.deepEqual(report.reconciliation.unmatchedCustomers, ['outsider']);
  close(report.reconciliation.outOfCohortCost6, 100);
  assert.throws(() => analyzePolicy([base('A')], [day('A', '2026-09-31', 1)]), /日期/);
});
test('invalid monetary and policy field semantics fail instead of becoming zeros or sales assumptions', () => {
  for (const [cost6, cost4] of [[1, 1.1], [-1, 0], [1, -1], [null, 0], [1, ''], ['not-a-number', 0], [' ', 0], [1, ' \t ']]) {
    assert.throws(() => analyzePolicy([base('A')], [day('A', dates[0], cost6, cost4)]), /数值|口径/);
  }
  assert.throws(() => analyzePolicy([{
    ...base('A'),
    增速1档: .4
  }], []), /不一致/);
  assert.throws(() => analyzePolicy([base('A')], [], {
    ...RULES,
    processBonusRate: .01
  }), /过程/);
  assert.throws(() => analyzePolicy([base('A')], [], {
    ...RULES,
    regularRebateBasis: 'revenue'
  }), /基数/);
  assert.throws(() => analyzePolicy([base('A')], [], {
    ...RULES,
    tiers: [...RULES.tiers, {
      ...RULES.tiers[0]
    }]
  }), /重叠/);
});
test('asOf monitors elapsed pace using observed days, keeps full-period targets, and reconciles cumulative trend', () => {
  const report = analyzePolicy([base('A', 10, '大游戏')], daily('A', 15, .8), RULES, {
    asOf: '2026-09-27'
  });
  assert.equal(report.elapsedDays, 3);
  assert.equal(report.remainingDays, 10);
  assert.equal(report.phase, '阶段监控');
  close(report.summary.baseTotal, 30);
  close(report.summary.cost6, 45);
  close(customer(report).growth, .5);
  close(customer(report).target1, 175.5);
  close(customer(report).phaseTarget1, 40.5);
  close(customer(report).neededDaily1, 13.05);
  assert.equal(customer(report).coverageDays, 3);
  assert.equal(customer(report).uncertain, false);
  assert.equal(report.trend.length, 3);
  close(report.trend.at(-1).cumulativeCost6, report.summary.cost6);
  close(report.trend.at(-1).countRate, report.summary.countRate);
  close(report.trend.at(-1).baseWeightedRate, report.summary.baseWeightedRate);
  assert.ok(report.warnings.some(warning => /阶段/.test(warning)));
  for (const asOf of ['2026-09-24', '2026-10-08']) assert.throws(() => analyzePolicy([base('A')], [], RULES, {
    asOf
  }), /截止日期/);
});
test('policy evidence exports ROI eligibility and excludes clustering', () => {
  const report = analyzePolicy([base('A'), base('B'), base('missing')], [...daily('A', 2), ...daily('B', 1.1)]);
  assert.equal(report.clusterProfiles, undefined);
  assert.equal(report.clusterMethod, undefined);
  assert.equal(report.groups.cluster, undefined);
  assert.ok(report.customers.every(client => !Object.hasOwn(client, 'cluster')));
  const rows = policyCustomerRows(report);
  assert.equal(rows[0]['获政策返货客户ROI'], report.customers[0].roi);
  assert.equal(rows[0].纳入ROI, 1);
  assert.equal(rows[1].纳入ROI, 0);
  assert.equal(rows[1]['获政策返货客户ROI'], null);
  assert.equal(rows[1]['框架增量返货试算(万)'] > 0, true);
  assert.equal(rows.at(-1).待核验, 1);
  assert.ok(rows.every(row => !Object.hasOwn(row, '分群')));
});
test('ROI excludes positive non-recipients, zero cash achievers and missing customers from both sides', () => {
  const report = analyzePolicy([base('winner'), base('below'), base('zeroCash'), base('missing')], [...daily('winner', 2, .8), ...daily('below', 1.1, .9), ...daily('zeroCash', 2, 0)]);
  assert.equal(report.summary.count, 4);
  assert.equal(report.summary.roiCustomerCount, 1);
  close(report.summary.roiIncrement, 13);
  close(report.summary.roiTotalRebate, 13 * .8 * (.08 + .12 + .085));
  close(report.summary.roi, 1 / (.8 * (.08 + .12 + .085)));
  assert.ok(report.summary.totalRebate > report.summary.roiTotalRebate);
  const empty = analyzePolicy([base('zeroCash')], daily('zeroCash', 2, 0));
  assert.equal(empty.summary.roi, null);
  assert.equal(empty.summary.policyRoi, null);
});
test('unequal recipients and capped policy rebates aggregate by actual incremental payouts, not average ROI', () => {
  const report = analyzePolicy([base('small'), base('capped', 10, '大游戏'), base('below')], [...daily('small', 2, .5), ...daily('capped', 100, .5), ...daily('below', 1.1, .9)], {...RULES, regularRebateBasis: 'cost4'});
  const [small, capped] = report.customers;
  assert.equal(report.rules.regularRebateBasis, 'cashIncrement');
  assert.equal(capped.capped, true);
  close(capped.annualRebate, 1170 * .5 * .12);
  close(capped.channelRebate, 1170 * .5 * .085);
  close(report.summary.roiIncrement, small.increment + capped.increment);
  close(report.summary.roiTotalRebate, small.totalRebate + capped.totalRebate);
  close(report.summary.roi, (small.increment + capped.increment) / (small.totalRebate + capped.totalRebate));
  assert.notEqual(report.summary.roi, (small.roi + capped.roi) / 2);
});
const basePath = '/Users/yanghanyue/Downloads/国庆base表.xlsx';
const consumptionPath = '/Users/yanghanyue/Downloads/游戏国庆政策_修正版SQL消耗结果.xlsx';
test('real Excel inputs match an independently computed openpyxl reference, including numeric identifiers', {
  skip: !existsSync(basePath) || !existsSync(consumptionPath)
}, () => {
  const python = spawnSync('python3', ['-c', `import json,openpyxl,sys
result=[]
for path in sys.argv[1:]:
    workbook=openpyxl.load_workbook(path,read_only=True,data_only=True)
    rows=list(workbook.active.values)
    result.append([dict(zip(rows[0],row)) for row in rows[1:]])
    workbook.close()
print(json.dumps(result,ensure_ascii=False))`, basePath, consumptionPath], {
    encoding: 'utf8'
  });
  assert.equal(python.status, 0, python.stderr);
  const [baseData, client] = JSON.parse(python.stdout);
  assert.equal(baseData.length, 107);
  assert.equal(client.length, 1157);
  const report = analyzePolicy(baseData, client, {
    ...RULES,
    missingAsZero: true
  });
  const expected = {
    count: 107,
    matchedCount: 94,
    hit1Count: 28,
    hit2Count: 22,
    baseDaily: 850.98,
    baseTotal: 11062.74,
    cost6: 15353.784,
    cost4: 14517.4257,
    increment: 4291.044,
    growth: .38788256797140575,
    policyRebate: 370.4557270394684,
    annualRebate: 568.2223010141028,
    channelRebate: 402.49079655165656,
    totalRebate: 1341.1688246052277,
    roi: 3.587956459082735,
    policyRoi: 12.076773750411874,
    roiCustomerCount: 28,
    roiIncrement: 4473.91,
    roiTotalRebate: 1246.924273195823,
    countRate: 28 / 107,
    baseWeightedRate: .481715198947096
  };
  for (const [key, value] of Object.entries(expected)) close(report.summary[key], value, key);
  assert.equal(report.customers.filter(client => client.coverageDays === 13).length, 87);
  assert.equal(report.reconciliation.missingCustomerDays, 234);
  assert.deepEqual(report.reconciliation.unmatchedCustomers, []);
  assert.equal(report.reconciliation.outOfPeriodRows, 0);
  close(report.customers.find(client => client.customer === '4399').policyRebate, 15.584898352543673);
  const small = report.groups.type.find(group => group.label === '小游戏');
  close(small.increment, -22.5301);
  close(small.roi, 4.7163138257438595);
  const defaultReport = analyzePolicy(baseData, client);
  assert.equal(defaultReport.customers.filter(client => client.uncertain).length, 20);
  assert.equal(defaultReport.customers.filter(client => client.growth === null).length, 13);
  close(defaultReport.summary.policyRebate, expected.policyRebate);
  close(defaultReport.summary.roi, expected.roi);
});
