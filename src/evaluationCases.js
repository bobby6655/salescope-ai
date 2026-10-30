export const evaluationCases = [
  { id: 1, dataset: 'sales', question: '去年总营收是多少？', expected: '￥57,100', match: (result) => result.answer?.includes('57,100') && result.rows?.[0]?.value === 57100 },
  { id: 2, dataset: 'sales', question: '营收最高的前三个产品是什么？', expected: '25700、15200、9000', match: (result) => JSON.stringify(result.rows?.map((row) => row.value)) === JSON.stringify([25700, 15200, 9000]) },
  { id: 3, dataset: 'sales', question: '画每个月各地区收入的堆积柱状图。', expected: '10 个月、5 个地区、合计 57100', match: (result) => result.chart?.type === 'stacked-bar' && result.rows?.length === 10 && result.rows.every((row) => row.series?.length === 5) && result.rows.reduce((sum, row) => sum + row.value, 0) === 57100 },
  { id: 4, dataset: 'orders', question: 'revenue 的总和是多少？', expected: '7200', match: (result) => result.rows?.[0]?.value === 7200 },
  { id: 5, dataset: 'orders', question: '按 city 汇总 revenue，画柱状图。', expected: 'Shanghai 3900、Beijing 2700、Shenzhen 600', match: (result) => result.chart?.type === 'bar' && ['Shanghai', 'Beijing', 'Shenzhen'].every((label, index) => result.rows?.find((row) => row.label === label)?.value === [3900, 2700, 600][index]) },
  { id: 6, dataset: 'orders', question: 'order_id 去重后有多少个？', expected: '6', match: (result) => result.rows?.[0]?.value === 6 },
  { id: 7, dataset: 'ads', question: '消耗的合计是多少？', expected: '10000', match: (result) => result.rows?.[0]?.value === 10000 },
  { id: 8, dataset: 'ads', question: '按渠道汇总点击数，画柱状图。', expected: '搜索 3210、信息流 4650', match: (result) => result.chart?.type === 'bar' && result.rows?.find((row) => row.label === '搜索')?.value === 3210 && result.rows?.find((row) => row.label === '信息流')?.value === 4650 },
  { id: 9, dataset: 'ads', question: '投放日期在 2025-02-01 到 2025-02-28 之间，消耗合计是多少？', expected: '4000', match: (result) => result.rows?.[0]?.value === 4000 },
  { id: 10, dataset: 'ads', question: '按投放日期的月份和渠道计算消耗占比，画堆积柱状图。', expected: '3 个月、2 个渠道，每月 100%', match: (result) => result.chart?.type === 'stacked-bar' && result.rows?.length === 3 && result.rows.every((row) => row.series?.length === 2 && Math.abs(row.series.reduce((sum, item) => sum + item.value, 0) - 100) < 0.000001) },
]
