export const evaluationCases = [
  { id: 1, category: '总数计算', question: '去年总营收是多少？', expected: '￥57,100', match: (result) => result.answer.includes('57,100') },
  { id: 2, category: '找最高', question: '哪个地区营收最高？', expected: '华东 ￥26,200', match: (result) => result.answer.includes('华东') && result.answer.includes('26,200') },
  { id: 3, category: '找最低', question: '哪个地区营收最低？', expected: '西北 ￥1,900', match: (result) => result.answer.includes('西北') && result.answer.includes('1,900') },
  { id: 4, category: '按地区比较', question: '请做一张不同地区的营收对比柱状图。', expected: '5 个地区 + 柱状图', match: (result) => result.chart?.type === 'bar' && result.rows?.length === 5 },
  { id: 5, category: '按产品比较', question: '营收最高的前三个产品是什么？', expected: '智能手表 S3、降噪耳机 Pro、运动相机 X2', match: (result) => ['智能手表 S3', '降噪耳机 Pro', '运动相机 X2'].every((name) => result.answer.includes(name)) },
  { id: 6, category: '按月份分析', question: '哪个月营收最高？', expected: '12月 ￥10,100', match: (result) => result.answer.includes('12月') && result.answer.includes('10,100') },
  { id: 7, category: '按客户类型分析', question: '不同客户类型的营收分别是多少？', expected: '会员、新客、普通三组', match: (result) => ['会员', '新客', '普通'].every((name) => result.answer.includes(name)) },
  { id: 8, category: '折扣分析', question: '哪个地区的平均折扣最高？', expected: '华东 93.6%', match: (result) => result.answer.includes('华东') && result.answer.includes('93.6%') },
  { id: 9, category: '利润分析', question: '总利润是多少？', expected: '￥23,400', match: (result) => result.answer.includes('23,400') },
  { id: 10, category: '筛选与画图', question: '请画一张华东地区营收柱状图。', expected: '华东筛选 + 图片', match: (result) => result.chart?.type === 'bar' && result.answer.includes('图片已保存') && result.rows?.length === 1 },
]
