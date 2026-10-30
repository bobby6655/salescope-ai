import datetime
import io
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as xml
import zipfile

namespace = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def read_workbook(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist()) > 1000 or sum(item.file_size for item in archive.infolist()) > 64 * 1024 * 1024:
            raise ValueError('Excel 解压大小超过限制')
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(item.itertext()) for item in xml.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', namespace)]
        date_styles = set()
        if 'xl/styles.xml' in archive.namelist():
            styles = xml.fromstring(archive.read('xl/styles.xml'))
            formats = {int(item.attrib['numFmtId']): item.attrib['formatCode'] for item in styles.findall('s:numFmts/s:numFmt', namespace)}
            for index, item in enumerate(styles.findall('s:cellXfs/s:xf', namespace)):
                format_id = int(item.attrib.get('numFmtId', 0))
                code = re.sub(r'"[^"]*"|\[[^\]]*\]', '', formats.get(format_id, '')).lower()
                if format_id in set(range(14, 23)) | {45, 46, 47} or re.search(r'y{2,}|d{1,}', code):
                    date_styles.add(index)
        workbook = xml.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find('s:workbookPr', namespace)
        epoch = datetime.datetime(1904, 1, 1) if properties is not None and properties.attrib.get('date1904') in {'1', 'true'} else datetime.datetime(1899, 12, 30)
        relations = xml.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {item.attrib['Id']: item.attrib['Target'] for item in relations if item.attrib.get('TargetMode') != 'External'}
        sheets = []
        for sheet in workbook.findall('s:sheets/s:sheet', namespace):
            target = targets.get(sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
            if not target:
                continue
            member = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            if not member.startswith('xl/'):
                raise ValueError('工作表路径不合法')
            rows = []
            for row in xml.fromstring(archive.read(member)).findall('s:sheetData/s:row', namespace):
                cells = {}
                for cell in row.findall('s:c', namespace):
                    column = 0
                    for letter in re.match(r'[A-Z]+', cell.attrib['r']).group():
                        column = column * 26 + ord(letter) - 64
                    value_node = cell.find('s:v', namespace)
                    value = value_node.text if value_node is not None else None
                    kind = cell.attrib.get('t')
                    if kind == 's' and value is not None:
                        value = shared[int(value)]
                    elif kind == 'inlineStr':
                        inline = cell.find('s:is', namespace)
                        value = ''.join(inline.itertext()) if inline is not None else ''
                    elif kind == 'e':
                        raise ValueError('Excel单元格错误：' + str(value))
                    elif value is not None and kind not in {'str', 'd'}:
                        numeric = float(value)
                        value = (epoch + datetime.timedelta(days=numeric)).isoformat() if int(cell.attrib.get('s', 0)) in date_styles else int(numeric) if numeric.is_integer() else numeric
                    cells[column - 1] = value
                if cells and any(value is not None for value in cells.values()):
                    rows.append([cells.get(index) for index in range(max(cells) + 1)])
            sheets.append({'name': sheet.attrib['name'], 'rows': rows})
        return {'sheets': sheets}


if __name__ == '__main__':
    try:
        print(json.dumps(read_workbook(sys.stdin.buffer.read()), ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
