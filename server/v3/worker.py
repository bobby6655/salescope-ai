"""Account-scoped worker. Reads JSON on stdin, emits JSON; never executes model code."""
import base64, csv, datetime, io, json, math, re, sys, zipfile
from collections import Counter
from typing import TypedDict
import duckdb
from openpyxl import load_workbook
from langgraph.graph import StateGraph, START, END

MAX_ROWS, MAX_COLS = 20000, 160

def empty(value): return value is None or value == ''
def text(value): return '' if value is None else str(value).strip()
def scalar(value):
    if isinstance(value, (datetime.datetime, datetime.date)): return value.isoformat()[:10]
    if isinstance(value, float) and not math.isfinite(value): return None
    return value

def inspect_file(payload):
    data = base64.b64decode(payload['data'], validate=True)
    if len(data) > 6 * 1024 * 1024: raise ValueError('单文件超过6MB')
    name = payload['name']
    sheets = []
    if name.lower().endswith('.csv'):
        raw = list(csv.reader(io.StringIO(data.decode('utf-8-sig'))))
        if len(raw) > MAX_ROWS or max((len(r) for r in raw), default=0) > MAX_COLS: raise ValueError('表格超过20000行或160列')
        sheets = [{'name': 'CSV', 'rows': raw, 'merges': [], 'formulaCells': []}]
    elif name.lower().endswith('.xlsx'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(x.file_size for x in archive.infolist()) > 80 * 1024 * 1024: raise ValueError('Excel解压后超过80MB')
        workbook = load_workbook(io.BytesIO(data), data_only=False, read_only=False, keep_links=False)
        cached = load_workbook(io.BytesIO(data), data_only=True, read_only=False, keep_links=False)
        if len(workbook.worksheets) > 30: raise ValueError('Excel超过30个Sheet')
        for sheet in workbook:
            if sheet.max_row > MAX_ROWS or sheet.max_column > MAX_COLS: raise ValueError('Sheet超过20000行或160列，请选择较小的数据范围')
            formulas, rows = [], []
            for row in sheet:
                values = []
                for cell in row:
                    if cell.data_type == 'f':
                        formulas.append(cell.coordinate)
                        values.append(scalar(cached[sheet.title][cell.coordinate].value))
                    else: values.append(scalar(cell.value))
                rows.append(values)
            sheets.append({'name': sheet.title, 'rows': rows, 'merges': [str(m) for m in sheet.merged_cells.ranges], 'formulaCells': formulas})
        workbook.close(); cached.close()
    else: raise ValueError('支持.xlsx或UTF-8 CSV；不支持图片、旧版.xls或加密文件')
    for sheet in sheets:
        rows = sheet['rows']
        while rows and all(empty(x) for x in rows[-1]): rows.pop()
        candidates = []
        for i, row in enumerate(rows[:30]):
            populated = [x for x in row if not empty(x)]
            if len(populated) >= 2:
                next_rows = rows[i+1:i+4]
                score = len(populated) + sum(isinstance(x,str) and not re.fullmatch(r'[\d,.%]+', x.strip()) for x in populated)
                score += sum(sum(not empty(x) for x in r) >= len(populated) for r in next_rows)
                candidates.append({'row':i+1, 'score':score})
        candidates.sort(key=lambda x:(-x['score'],x['row']))
        sheet['headerCandidates'] = candidates[:5]
        sheet['suggestion'] = {'headerStart': candidates[0]['row'] if candidates else 1, 'headerDepth':1}
    return {'sheets': sheets}

def number(value):
    if empty(value): return None
    if isinstance(value, bool): raise ValueError('布尔值不是金额')
    if isinstance(value,(int,float)): return value
    raw = str(value).strip().replace(',', '').replace('，','').replace('￥','').replace('¥','').replace('$','')
    percent = raw.endswith('%') or raw.endswith('％')
    if percent: raw=raw[:-1]
    if raw.endswith('万元'): raw=raw[:-2]
    elif raw.endswith('元'): raw=raw[:-1]
    value = float(raw)
    if not math.isfinite(value): raise ValueError('无效数值')
    return value/100 if percent else value

def normalize(sheet, plan):
    rows, merges = sheet['rows'], sheet.get('merges',[])
    start, depth = int(plan.get('headerStart',1))-1, int(plan.get('headerDepth',1))
    end = int(plan.get('endRow') or len(rows))
    if start < 0 or depth < 1 or depth > 5 or start+depth >= end or end > len(rows): raise ValueError('表头/结束行范围无效，表头后必须有数据')
    width = max(len(r) for r in rows)
    header = [r[:] + [None]*(width-len(r)) for r in rows[start:start+depth]]
    # Propagate merged header values only; never fill down unknown data cells.
    from openpyxl.utils.cell import range_boundaries
    for merge in merges:
        c1,r1,c2,r2=range_boundaries(merge)
        if start+1 <= r1 <= start+depth:
            value=rows[r1-1][c1-1]
            for r in range(max(r1,start+1),min(r2,start+depth)+1):
                for c in range(c1,c2+1): header[r-start-1][c-1]=value
    headers=[]; seen=Counter()
    for column in range(width):
        tokens=[]
        for row in header:
            value=text(row[column])
            if value and (not tokens or tokens[-1]!=value): tokens.append(value)
        name=' / '.join(tokens) or f'未命名列{column+1}'
        seen[name]+=1; headers.append(name if seen[name]==1 else f'{name} ({seen[name]})')
    renames=plan.get('renames',{})
    if any(k not in headers for k in renames): raise ValueError('重命名字段不存在')
    headers=[text(renames.get(h,h)) for h in headers]
    if len(set(headers))!=len(headers) or any(not h for h in headers): raise ValueError('字段名不能为空或重复')
    excluded=set(int(v) for v in plan.get('excludeRows',[])); totals=[]; output=[]; provenance=[]; excluded_actual=[]
    for i in range(start+depth,end):
        row=rows[i]+[None]*(width-len(rows[i]))
        if all(empty(v) for v in row): continue
        if any(re.fullmatch(r'(总计|合计|小计|汇总|grand total|subtotal|total)',text(v),re.I) for v in row): totals.append(i+1)
        if i+1 in excluded: excluded_actual.append(i+1);continue
        output.append(dict(zip(headers,row)));provenance.append({'sheet':sheet['name'],'row':i+1})
    fill_columns=plan.get('fillDown',[])
    for col in fill_columns:
        if col not in headers: raise ValueError('填充字段不存在')
        previous=None
        for row in output:
            if empty(row[col]): row[col]=previous
            else: previous=row[col]
    unpivot=plan.get('unpivot')
    if unpivot:
        columns=unpivot.get('columns',[]); dimension=text(unpivot.get('dimension','期间')); metric=text(unpivot.get('metric','数值'))
        if not columns or len(set(columns))!=len(columns) or any(c not in headers for c in columns): raise ValueError('请选择有效且不重复的转长表列')
        retained=[h for h in headers if h not in columns]
        if not dimension or not metric or dimension==metric or dimension in retained or metric in retained: raise ValueError('转长表字段名与其他字段重复')
        long_rows=[]; long_sources=[]
        for row,source in zip(output,provenance):
            for col in columns:
                long_rows.append({**{h:row[h] for h in retained},dimension:col,metric:row[col]})
                long_sources.append({**source,'valueColumn':headers.index(col)+1,'valueField':col})
        output,provenance,headers=long_rows,long_sources,retained+[dimension,metric]
    schema=plan.get('schema',{})
    if any(k not in headers for k in schema): raise ValueError('类型配置字段不存在')
    invalid=[]
    for row_index,row in enumerate(output):
        for col in headers:
            spec=schema.get(col,{})
            kind=spec.get('type','auto')
            multiplier=float(spec.get('multiplier',1))
            if multiplier not in [1,.0001,10000,100, .01]: raise ValueError('仅支持明确的元/万元/百分数换算倍数')
            raw=row[col]
            try:
                if isinstance(raw,str) and raw.strip().endswith(('万元','元')) and kind=='number':
                    suffix='万元' if raw.strip().endswith('万元') else '元'
                    source_unit=spec.get('sourceUnit')
                    if source_unit != suffix:raise ValueError('带单位数值需确认sourceUnit')
                if empty(raw): row[col]=None
                elif kind=='number': row[col]=number(raw)*multiplier
                elif kind=='string': row[col]=str(raw).strip()
                elif kind=='date':
                    raw=str(raw).strip()
                    date=datetime.datetime.strptime(raw,'%Y%m%d') if re.fullmatch(r'\d{8}',raw) else datetime.datetime.fromisoformat(raw.replace('/','-'))
                    row[col]=date.date().isoformat()
                elif kind=='auto':
                    if isinstance(raw,str) and re.fullmatch(r'-?[\d,]+(?:\.\d+)?%?',raw.strip()) and not re.fullmatch(r'0\d+',raw.strip()) and not re.search(r'id|编号|编码|代码|客户|订单号',col,re.I): row[col]=number(raw)
                else: raise ValueError('类型无效')
            except (ValueError,TypeError):
                invalid.append({'field':col,'source':provenance[row_index],'value':str(raw)[:80]})
                # Invalids remain explicit, never silently become zero.
                row[col]=raw
    if len(output)>MAX_ROWS or len(headers)>MAX_COLS: raise ValueError('转换后超过20000行或160列')
    return {'headers':headers,'rows':output,'provenance':provenance,'invalidCells':invalid[:100], 'invalidCount':len(invalid),'totalCandidates':totals,'excludedRows':excluded_actual,'plan':plan}

def profile(table):
    rows,headers=table['rows'],table['headers']
    con=duckdb.connect(':memory:');con.execute("SET memory_limit='256MB'");con.execute('SET threads=1')
    columns=[]
    for h in headers:
        values=[r[h] for r in rows]; nonempty=[v for v in values if not empty(v)]
        numeric=bool(nonempty) and all(isinstance(v,(int,float)) and not isinstance(v,bool) for v in nonempty)
        dtype='number' if numeric else 'date' if nonempty and all(re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(v)) for v in nonempty) else 'string'
        columns.append({'name':h,'type':dtype,'nullCount':len(values)-len(nonempty),'distinctCount':len(set(str(v) for v in nonempty)),'unit':table.get('plan',{}).get('schema',{}).get(h,{}).get('unit',''),'sum':sum(nonempty) if numeric else None,'samples':nonempty[:3]})
    quoted=lambda h:'"'+h.replace('"','""')+'"'
    definition=', '.join(quoted(c['name'])+(' DOUBLE' if c['type']=='number' else ' VARCHAR') for c in columns)
    if columns:
        con.execute('CREATE TABLE data ('+definition+')')
        if rows: con.executemany('INSERT INTO data VALUES ('+','.join('?' for _ in headers)+')',[[r[h] if columns[i]['type']=='number' else None if empty(r[h]) else str(r[h]) for i,h in enumerate(headers)] for r in rows])
        count=con.execute('SELECT COUNT(*) FROM data').fetchone()[0]
    else: count=0
    con.close()
    duplicates=len(rows)-len(set(json.dumps(row,ensure_ascii=False,sort_keys=True) for row in rows))
    return {**table,'quality':{'rowCount':count,'duplicateCount':duplicates,'columns':columns,'recordGrain':'需用户确认，不能从列名确定业务粒度'}}

class Preparation(TypedDict):
    sheet:dict
    plan:dict
    table:dict
    stages:list

def prep_normalize(state):return {'table':normalize(state['sheet'],state['plan']),'stages':['结构标准化']}
def prep_profile(state):return {'table':profile(state['table']),'stages':state['stages']+['DuckDB校验与质量报告']}
preparation=StateGraph(Preparation)
preparation.add_node('normalize',prep_normalize);preparation.add_node('quality',prep_profile)
preparation.add_edge(START,'normalize');preparation.add_edge('normalize','quality');preparation.add_edge('quality',END)
PREPARE=preparation.compile()

def join_tables(payload):
    left,right=payload['left'],payload['right'];keys=payload.get('keys',[])
    if not keys or len(keys)>4: raise ValueError('需要1至4对关联键')
    if any(k['left'] not in left['headers'] or k['right'] not in right['headers'] for k in keys): raise ValueError('关联字段不存在')
    how=payload.get('how','left')
    if how not in ['left','inner']:raise ValueError('关联方式支持left或inner')
    keyfn=lambda row,side: tuple(str(row[k[side]]) for k in keys) if all(not empty(row[k[side]]) for k in keys) else None
    lc=Counter(keyfn(r,'left') for r in left['rows'] if keyfn(r,'left') is not None);rc=Counter(keyfn(r,'right') for r in right['rows'] if keyfn(r,'right') is not None)
    if any(lc[k]>1 and rc[k]>1 for k in lc.keys()&rc.keys()):raise ValueError('多对多关联已拦截：两表同一键均重复，请调整关联键或先汇总')
    relation='一对一' if all(v<=1 for v in lc.values()) and all(v<=1 for v in rc.values()) else '多对一' if all(v<=1 for v in rc.values()) else '一对多'
    con=duckdb.connect(':memory:');con.execute("SET memory_limit='256MB'");con.execute('SET threads=1')
    q=lambda h:'"'+h.replace('"','""')+'"'
    def load(name,t):
        con.execute('CREATE TABLE '+name+' ('+', '.join(q(h)+' VARCHAR' for h in t['headers'])+', __source INTEGER)')
        if t['rows']: con.executemany('INSERT INTO '+name+' VALUES ('+','.join('?' for _ in range(len(t['headers'])+1))+')',[[None if empty(r[h]) else str(r[h]) for h in t['headers']]+[i] for i,r in enumerate(t['rows'])])
    if '__source' in left['headers'] or '__source' in right['headers']:raise ValueError('字段__source为系统保留，请重命名')
    load('l',left);load('r',right)
    condition=' AND '.join('l.'+q(k['left'])+' = r.'+q(k['right']) for k in keys)
    match_sql='SELECT l.__source,r.__source FROM l '+('LEFT' if how=='left' else 'INNER')+' JOIN r ON '+condition
    count=con.execute('SELECT COUNT(*) FROM ('+match_sql+')').fetchone()[0]
    if count>MAX_ROWS:con.close();raise ValueError('关联后超过20000行，请缩小范围或先汇总')
    matches=con.execute(match_sql+' ORDER BY l.__source,r.__source').fetchall();con.close()
    names=[]
    for h in right['headers']:
        candidate=h if h not in left['headers'] else '右表 / '+h
        while candidate in left['headers'] or candidate in names:candidate='右表 / '+candidate
        names.append(candidate)
    output=[];sources=[]
    for li,ri in matches:
        row={**left['rows'][li],**{names[i]:right['rows'][ri][h] if ri is not None else None for i,h in enumerate(right['headers'])}}
        output.append(row);sources.append({'left':left['provenance'][li], 'right':right['provenance'][ri] if ri is not None else None})
    unmatched_left=[i for i,r in enumerate(left['rows']) if keyfn(r,'left') is None or keyfn(r,'left') not in rc]
    unmatched_right=[i for i,r in enumerate(right['rows']) if keyfn(r,'right') is None or keyfn(r,'right') not in lc]
    sums=lambda rows,headers:{h:sum(r[h] for r in rows if isinstance(r[h],(int,float)) and not isinstance(r[h],bool)) for h in headers if any(isinstance(r[h],(int,float)) for r in rows)}
    before=sums(left['rows'],left['headers']);after=sums(output,left['headers']);amplified=[h for h in before if abs(after[h]-before[h])>1e-8 and relation=='一对多']
    return {**profile({'headers':left['headers']+names,'rows':output,'provenance':sources,'invalidCells':[], 'invalidCount':0,'plan':{'join':keys,'how':how}}),'joinReport':{'relation':relation,'leftRows':len(left['rows']),'rightRows':len(right['rows']),'outputRows':len(output),'unmatchedLeft':len(unmatched_left),'unmatchedRight':len(unmatched_right),'unmatchedLeftPreview':[left['provenance'][i] for i in unmatched_left[:20]],'unmatchedRightPreview':[right['provenance'][i] for i in unmatched_right[:20]],'leftSumsBefore':before,'leftSumsAfter':after,'amplifiedFields':amplified,'requiresConfirmation':bool(amplified or unmatched_left or unmatched_right or relation=='一对多')}}


def query_table(payload):
    table, plan = payload['table'], payload['plan']
    headers=table['headers']; columns=table['quality']['columns']; q=lambda h:'"'+h.replace('"','""')+'"'
    group=plan.get('group_by',[]); measures=plan.get('measures',[])
    if len(group)>8 or not measures or len(measures)>8:raise ValueError('最多8个分组字段及8个指标')
    if any(h not in headers for h in group):raise ValueError('分组字段不存在')
    con=duckdb.connect(':memory:');con.execute("SET memory_limit='256MB'");con.execute('SET threads=1')
    con.execute('CREATE TABLE data ('+', '.join(q(c['name'])+(' DOUBLE' if c['type']=='number' else ' VARCHAR') for c in columns)+')')
    if table['rows']:con.executemany('INSERT INTO data VALUES ('+','.join('?' for _ in headers)+')',[[r[h] if columns[i]['type']=='number' else None if empty(r[h]) else str(r[h]) for i,h in enumerate(headers)] for r in table['rows']])
    metric_expr=[]; aliases=[]
    for m in measures:
        agg=m.get('aggregate');col=m.get('column');alias=text(m.get('alias') or col or '记录数')
        if agg not in ['sum','avg','count','count_distinct','min','max'] or col is not None and col not in headers:raise ValueError('指标字段或聚合无效')
        if col is None and agg!='count':raise ValueError('指标缺少字段')
        if agg in ['sum','avg','min','max'] and next(c for c in columns if c['name']==col)['type']!='number':raise ValueError('指标必须是数值列')
        if alias in aliases or alias in group:raise ValueError('指标别名重复')
        aliases.append(alias);metric_expr.append(('COUNT(*)' if col is None else 'COUNT(DISTINCT '+q(col)+')' if agg=='count_distinct' else agg.upper()+'('+q(col)+')')+' AS '+q(alias))
    where=[];params=[]
    for f in plan.get('filters',[]):
        col=f.get('column');op=f.get('operator');value=f.get('value')
        if col not in headers:raise ValueError('筛选字段不存在')
        if op=='is_null':where.append(q(col)+' IS NULL')
        elif op=='between' and isinstance(value,list) and len(value)==2:where.append(q(col)+' BETWEEN ? AND ?');params+=value
        elif op=='in' and isinstance(value,list) and value:where.append(q(col)+' IN ('+','.join('?' for _ in value)+')');params+=value
        elif op in ['equals','not_equals','gt','gte','lt','lte']:where.append(q(col)+{'equals':' = ?','not_equals':' <> ?','gt':' > ?','gte':' >= ?','lt':' < ?','lte':' <= ?'}[op]);params.append(value)
        else:raise ValueError('筛选操作无效')
    sql='SELECT '+', '.join([q(h) for h in group]+metric_expr)+' FROM data'
    if where:sql+=' WHERE '+' AND '.join(where)
    if group:sql+=' GROUP BY '+', '.join(q(h) for h in group)
    order=plan.get('order')
    if order:
        if order.get('measure') not in aliases or order.get('direction') not in ['asc','desc']:raise ValueError('排序参数无效')
        sql+=' ORDER BY '+q(order['measure'])+' '+order['direction'].upper()
    elif group:sql+=' ORDER BY '+', '.join(q(h) for h in group)
    limit=plan.get('limit')
    if limit is not None:
        if not isinstance(limit,int) or limit<1 or limit>20000:raise ValueError('limit无效')
        sql+=' LIMIT '+str(limit)
    result=con.execute(sql,params).fetchall();con.close()
    if len(result)>20000:raise ValueError('查询返回过多分组，请缩小范围')
    return {'groupBy':group,'measures':aliases,'table':[{'dimensions':[str(v) if v is not None else '（空值）' for v in row[:len(group)]],'values':dict(zip(aliases,row[len(group):]))} for row in result]}

def main(payload):
    if payload['action']=='health':return {'ready':True,'engine':'DuckDB','harness':'LangGraph'}
    if payload['action']=='inspect':return inspect_file(payload)
    if payload['action']=='prepare':
        result=PREPARE.invoke({'sheet':payload['sheet'],'plan':payload['plan'],'stages':[]})
        return {**result['table'],'stages':result['stages'],'harness':'LangGraph'}
    if payload['action']=='join':return join_tables(payload)
    if payload['action']=='query':return query_table(payload)
    raise ValueError('未知数据处理动作')
if __name__=='__main__':
    try: print(json.dumps({'ok':True,'result':main(json.load(sys.stdin))},ensure_ascii=False,allow_nan=False))
    except Exception as error: print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False));sys.exit(1)
