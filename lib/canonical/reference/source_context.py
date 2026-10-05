"""Read original OOXML cells independently; never read approvals from model output."""
import hashlib,posixpath,zipfile
from pathlib import Path
import xml.etree.ElementTree as E
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def from_sources(run,paths,*,layout_approvals,field_approvals,review_event_ids,disposition_approvals,extension_value_approvals=None):
    context=dict(cells={},file_hashes={},layout_approvals=set(layout_approvals),field_approvals=dict(field_approvals),disposition_approvals=dict(disposition_approvals),extension_value_approvals=dict(extension_value_approvals or {}),review_event_ids=set(review_event_ids))
    for source in run['source_files']:
        p=Path(paths[source['file_id']])
        if p.suffix.lower() not in ('.xlsx','.xlsm'):raise ValueError('Only OOXML Excel supported in v1')
        if p.stat().st_size>20*1024*1024:raise ValueError('Upload exceeds 20 MiB')
        context['file_hashes'][source['file_id']]=hashlib.sha256(p.read_bytes()).hexdigest()
        with zipfile.ZipFile(p) as z:
            if len(z.infolist())>10000 or sum(i.file_size for i in z.infolist())>200*1024*1024:raise ValueError('Archive resource limit exceeded')
            def xml(name):
                data=z.read(name)
                if b'<!DOCTYPE' in data or b'<!ENTITY' in data:raise ValueError('Unsupported XML declarations')
                return E.fromstring(data)
            strings=[''.join(s.itertext()) for s in xml('xl/sharedStrings.xml').findall('s:si',N)] if 'xl/sharedStrings.xml' in z.namelist() else []
            rel={r.get('Id'):r.get('Target') for r in xml('xl/_rels/workbook.xml.rels')}
            workbook=xml('xl/workbook.xml')
            sheets=workbook.findall('s:sheets/s:sheet',N)
            if len(sheets)>50:raise ValueError('More than 50 sheets')
            sheet_ids={s['name']:s['sheet_id'] for s in source['sheets']}
            if set(sheet_ids)!={s.get('name') for s in sheets}:raise ValueError('Sheet inventory mismatch')
            for sh in sheets:
                target=rel[sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
                path=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
                for c in xml(path).findall('.//s:sheetData/s:row/s:c',N):
                    v=c.find('s:v',N);inline=c.find('s:is',N);raw=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else None
                    if c.get('t')=='s' and raw is not None:raw=strings[int(raw)]
                    if raw not in (None,''):context['cells'][(source['file_id'],sheet_ids[sh.get('name')],c.get('r'))]=raw
                    if len(context['cells'])>1000000:raise ValueError('More than one million populated cells')
    return context
