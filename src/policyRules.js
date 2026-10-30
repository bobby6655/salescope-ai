export const NATIONAL_DAY_POLICY = {
  name: '2026年游戏行业国庆&中秋冲量政策',
  startDate: '2026-09-25', endDate: '2026-10-07',
  sourceUrl: 'https://docs.corp.kuaishou.com/d/home/fcACBWYgvB9dcVkG8FAxuBTYb',
  sourcePublishedAt: '2026-09-22',
  annualRate: 0.12, channelRate: 0.085, regularRebateBasis: 'cashIncrement', roiScope: 'policyRecipients',
  missingAsZero: false, processBonusRate: 0, capMode: 'cashAdjusted', capCoefficient: 3,
  tiers: [
    { type: '小游戏', min: 0.5, max: 10, label: '[0.5,10)', growth1: 0.35, rate1: 0.04, growth2: 0.65, rate2: 0.08 },
    { type: '小游戏', min: 10, max: 15, label: '[10,15)', growth1: 0.30, rate1: 0.04, growth2: 0.60, rate2: 0.08 },
    { type: '小游戏', min: 15, max: null, label: '[15+)', growth1: 0.25, rate1: 0.04, growth2: 0.55, rate2: 0.08 },
    { type: '大游戏', min: 0.5, max: 10, label: '[0.5,10)', growth1: 0.40, rate1: 0.06, growth2: 0.70, rate2: 0.09 },
    { type: '大游戏', min: 10, max: 20, label: '[10,20)', growth1: 0.35, rate1: 0.06, growth2: 0.65, rate2: 0.09 },
    { type: '大游戏', min: 20, max: 50, label: '[20,50)', growth1: 0.30, rate1: 0.06, growth2: 0.60, rate2: 0.09 },
    { type: '大游戏', min: 50, max: 150, label: '[50,150)', growth1: 0.25, rate1: 0.06, growth2: 0.55, rate2: 0.09 },
    { type: '大游戏', min: 150, max: null, label: '[150+)', growth1: 0.20, rate1: 0.06, growth2: 0.50, rate2: 0.09 },
  ],
  warnings: [
    '过程指标额外1%按用户要求忽略；返货为消耗口径试算，不代表已核验互斥、报名资格及钱包范围后的正式结算。',
    '默认封顶公式：min(cost6增量×现金率, base日均×二档增速×3×天数)×对应返点率。原文示例16.5万与明确公式14.85万不一致，默认以明确公式为准。',
    '框架/渠道返货默认分别为正cost6增量×现金率×12%及×8.5%；ROI仅统计获得政策返货的客户，分子和三项返货分母使用同一客户范围；比例仍为合同试算假设。',
  ],
}

export const POLICY_FIELDS = {
  base: { customer: '客户', type: '属性', department: '行业分组', sales: '负责销售', base: 'base(万/日)', tier: '档位' },
  consumption: { date: '日期', customer: '客户', cost6: 'cost_6消耗(万)', cost4: 'cost_4现金(万)' },
}
