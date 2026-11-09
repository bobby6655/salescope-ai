import importlib.util, pathlib, unittest, io, base64
from openpyxl import Workbook
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('worker',ROOT/'server/v3/worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class Cases(unittest.TestCase):
 def prepare(self,rows,plan=None):return w.main({'action':'prepare','sheet':{'name':'test','rows':rows,'merges':[]},'plan':plan or {'headerStart':1,'headerDepth':1}})
 def test_multisheet_headers_and_totals(self):
  wb=Workbook();s=wb.active;s.title='消耗';s.append(['业务报表']);s.append(['客户','消耗','']);s.append(['客户','2026-09','2026-10']);s.merge_cells('B2:C2');s.append(['甲',100,200]);s.append(['乙',50,80]);s.append(['合计',150,280]);wb.create_sheet('客户');b=io.BytesIO();wb.save(b)
  result=w.inspect_file({'name':'a.xlsx','data':base64.b64encode(b.getvalue()).decode()});self.assertEqual(len(result['sheets']),2)
  t=w.main({'action':'prepare','sheet':result['sheets'][0],'plan':{'headerStart':2,'headerDepth':2,'excludeRows':[6]}})
  self.assertEqual(t['headers'],['客户','消耗 / 2026-09','消耗 / 2026-10']);self.assertEqual(len(t['rows']),2);self.assertEqual(t['provenance'][0]['row'],4);self.assertEqual(t['quality']['columns'][1]['sum'],150);self.assertEqual(t['harness'],'LangGraph')
 def test_unpivot_null_and_conversion(self):
  t=self.prepare([['客户','9月','10月'],['001','1,000',None],['002','200','300']],{'headerStart':1,'headerDepth':1,'unpivot':{'columns':['9月','10月'],'dimension':'月份','metric':'金额'},'schema':{'金额':{'type':'number','multiplier':.0001,'unit':'万元'},'客户':{'type':'string'}}})
  self.assertEqual(len(t['rows']),4);self.assertEqual(t['rows'][0]['金额'],.1);self.assertIsNone(t['rows'][1]['金额']);self.assertEqual(t['rows'][0]['客户'],'001');self.assertEqual(t['provenance'][1]['valueColumn'],3)
 def test_invalid_and_dates(self):
  t=self.prepare([['日期','金额','编号'],['20261101','12%', '001'],['错误','不详','002']],{'headerStart':1,'headerDepth':1,'schema':{'日期':{'type':'date'},'金额':{'type':'number'}}})
  self.assertEqual(t['invalidCount'],2);self.assertEqual(t['rows'][0]['日期'],'2026-11-01');self.assertEqual(t['rows'][0]['金额'],.12);self.assertEqual(t['rows'][1]['金额'],'不详');self.assertEqual(t['rows'][0]['编号'],'001')
 def test_join_and_many_to_many(self):
  l=self.prepare([['客户','消耗'],['甲',100],['甲',200],['乙',50]])
  r=self.prepare([['客户','销售'],['甲','张'],['丙','李']])
  t=w.join_tables({'left':l,'right':r,'keys':[{'left':'客户','right':'客户'}]})
  self.assertEqual(t['joinReport']['relation'],'多对一');self.assertEqual(t['joinReport']['unmatchedLeft'],1);self.assertEqual(t['joinReport']['unmatchedRight'],1);self.assertEqual(t['joinReport']['leftSumsAfter']['消耗'],350)
  r2=self.prepare([['客户','销售'],['甲','张'],['甲','李']])
  with self.assertRaisesRegex(ValueError,'多对多'):w.join_tables({'left':l,'right':r2,'keys':[{'left':'客户','right':'客户'}]})
  one=self.prepare([['客户','消耗'],['甲',100]])
  t=w.join_tables({'left':one,'right':r2,'keys':[{'left':'客户','right':'客户'}]});self.assertEqual(t['joinReport']['amplifiedFields'],['消耗'])
 def test_duckdb_query_quote_and_no_sql(self):
  t=self.prepare([['客户','a"b','城市','产品'],['甲',100,'东','A'],['甲',200,'东','B'],['乙',300,'西','A']])
  q=w.query_table({'table':t,'plan':{'group_by':['客户','城市','产品'],'measures':[{'column':'a"b','aggregate':'sum','alias':'金额'}],'filters':[{'column':'客户','operator':'equals','value':'甲'}]}})
  self.assertEqual(sum(r['values']['金额'] for r in q['table']),300)
  with self.assertRaisesRegex(ValueError,'字段'):w.query_table({'table':t,'plan':{'group_by':['DROP TABLE data'],'measures':[{'column':'a"b','aggregate':'sum'}]}})
 def test_formula_not_executed(self):
  wb=Workbook();s=wb.active;s.append(['客户','金额']);s.append(['甲','=1+2']);b=io.BytesIO();wb.save(b)
  result=w.inspect_file({'name':'a.xlsx','data':base64.b64encode(b.getvalue()).decode()});self.assertEqual(result['sheets'][0]['formulaCells'],['B2']);self.assertIsNone(result['sheets'][0]['rows'][1][1])
 def test_totals_not_removed_without_confirmation(self):
  t=self.prepare([['客户','金额'],['甲',100],['合计',100]])
  self.assertEqual(len(t['rows']),2);self.assertEqual(t['totalCandidates'],[3]);self.assertEqual(t['excludedRows'],[])
 def test_fill_down_is_explicit(self):
  rows=[['客户','金额'],['甲',100],[None,200]]
  self.assertIsNone(self.prepare(rows)['rows'][1]['客户'])
  self.assertEqual(self.prepare(rows,{'headerStart':1,'fillDown':['客户']})['rows'][1]['客户'],'甲')
 def test_units_require_confirmation(self):
  rows=[['客户','金额'],['甲','2万元'],['乙','100元']]
  t=self.prepare(rows,{'headerStart':1,'schema':{'金额':{'type':'number'}}});self.assertEqual(t['invalidCount'],2)
  t=self.prepare([['客户','金额'],['甲','2万元']],{'headerStart':1,'schema':{'金额':{'type':'number','sourceUnit':'万元','multiplier':10000,'unit':'元'}}});self.assertEqual(t['rows'][0]['金额'],20000)
 def test_inner_join_loss_and_blank_keys(self):
  left=self.prepare([['客户','金额'],['甲',100],['乙',50],[None,20]])
  right=self.prepare([['客户','分类'],['甲','A'],[None,'B']])
  t=w.join_tables({'left':left,'right':right,'keys':[{'left':'客户','right':'客户'}],'how':'inner'})
  self.assertEqual(len(t['rows']),1);self.assertEqual(t['joinReport']['unmatchedLeft'],2);self.assertEqual(t['joinReport']['leftSumsAfter']['金额'],100)
if __name__=='__main__':unittest.main()
