"""Shape and semantic validation. Never trust a model-provided export status."""
import argparse
import json
import math
import re
from decimal import Decimal
from pathlib import Path

SCHEMA=json.loads(Path(__file__).with_name('canonical.schema.json').read_text())
AUTO_METHODS={'copied','parsed'}
AUTO_RULES={'copy-v1','trim-v1','number-v1','unit-alias-v1','join-v1','source-span-v2','labeled-identifier-v1','labeled-pack-v1','labeled-unit-v1'}

def validate(run, *, final=False, trusted=None):
    errors=[]
    def fail(code,path,message): errors.append({'code':code,'path':path,'message':message})
    def shape(value,s,path):
        if '$ref' in s: return shape(value,SCHEMA['$defs'][s['$ref'].split('/')[-1]],path)
        if 'anyOf' in s:
            for option in s['anyOf']:
                before=len(errors);shape(value,option,path)
                if len(errors)==before:return
                del errors[before:]
            fail('SHAPE',path,'No allowed shape matches');return
        if 'const' in s and value!=s['const']:fail('SHAPE',path,'Incorrect constant')
        if 'enum' in s and value not in s['enum']:fail('SHAPE',path,'Unknown enum value')
        types=s.get('type',[]);types=[types] if isinstance(types,str) else types
        matches={'object':isinstance(value,dict),'array':isinstance(value,list),'string':isinstance(value,str),'integer':type(value) is int,'number':type(value) in (int,float) and math.isfinite(value),'boolean':type(value) is bool,'null':value is None}
        if types and not any(matches[t] for t in types):fail('SHAPE',path,'Invalid type');return
        if isinstance(value,dict) and 'properties' in s:
            for key in s['required']:
                if key not in value:fail('SHAPE',path+'/'+key,'Required property missing')
            for key,v in value.items():
                if key not in s['properties']:fail('SHAPE',path+'/'+key,'Unknown property')
                else:shape(v,s['properties'][key],path+'/'+key)
        if isinstance(value,list) and 'items' in s:
            for i,v in enumerate(value):shape(v,s['items'],path+'/'+str(i))
        if isinstance(value,str):
            if len(value)<s.get('minLength',0):fail('SHAPE',path,'Empty text')
            if 'pattern' in s and not re.fullmatch(s['pattern'],value):fail('SHAPE',path,'Invalid text syntax')
        if type(value) in (int,float):
            if value<s.get('minimum',-math.inf) or value>s.get('maximum',math.inf):fail('SHAPE',path,'Outside bounds')
    shape(run,SCHEMA,'')
    if errors:return errors
    if final and trusted is None:fail('TRUSTED_CONTEXT_REQUIRED','','Final readiness needs an independent inspector snapshot and controller approval registry')
    def index(records,key,path):
        result={}
        for record in records:
            identity=record[key]
            if identity in result:fail('DUPLICATE_ID',path,identity)
            result[identity]=record
        return result
    files=index(run['source_files'],'file_id','/source_files');ev=index(run['evidence'],'evidence_id','/evidence');regions=index(run['regions'],'region_id','/regions');items=index(run['items'],'item_id','/items');events=index(run['review_events'],'event_id','/review_events');issues=index(run['issues'],'issue_id','/issues')
    candidates={}
    for item in items.values():
        for f,d in item['fields'].items():
            for c in d['candidates']:
                if c['candidate_id'] in candidates:fail('DUPLICATE_ID','/items',c['candidate_id'])
                candidates[c['candidate_id']]=c
    visiting=set();visited=set()
    def dependency_cycle(identity):
        if identity in visiting:fail('DEPENDENCY_CYCLE','/candidates',identity);return
        if identity in visited or identity not in candidates:return
        visiting.add(identity)
        for parent in candidates[identity]['input_candidate_ids']:dependency_cycle(parent)
        visiting.remove(identity);visited.add(identity)
    for identity in candidates:dependency_cycle(identity)
    def refs(ids,mapping,path):
        for identity in ids:
            if identity not in mapping:fail('MISSING_REFERENCE',path,identity)
    def unit(u,path):
        if u and u['code']=='OTHER' and not u['label']:fail('UNIT_LABEL_REQUIRED',path,'OTHER requires label')
    def quantity(q,path):
        a=q['amount'];kind=a['kind']
        valid=(kind=='scalar' and a['value'] is not None and a['minimum'] is None and a['maximum'] is None and not a['alternatives']) or (kind=='range' and a['value'] is None and a['minimum'] is not None and a['maximum'] is not None and not a['alternatives']) or (kind=='alternatives' and a['value'] is None and a['minimum'] is None and a['maximum'] is None and len(a['alternatives'])>=2)
        if not valid:fail('QUANTITY_SHAPE',path,'Amount branches are mutually exclusive')
        if kind=='range' and a['minimum'] is not None and a['maximum'] is not None and Decimal(a['minimum'])>Decimal(a['maximum']):fail('QUANTITY_RANGE',path,'Reversed range')
        unit(q['uom'],path)
    for e in ev.values():
        if final and e['formula_verified'] and (trusted is None or trusted.get('formula_approvals',{}).get((e['file_id'],e['sheet_id'],e['range']))!={'raw':e['raw_value'],'formula':e['formula']}):fail('FORMULA_APPROVAL_UNVERIFIED','/evidence/'+e['evidence_id'],'Formula proof is missing or stale')
        file=files.get(e['file_id'])
        if not file or e['sheet_id'] not in {s['sheet_id'] for s in file['sheets']}:fail('EVIDENCE_SOURCE','/evidence/'+e['evidence_id'],'Unknown file/sheet')
        span=e['span']
        if span and (not isinstance(e['raw_value'],str) or e['raw_value'][span['start']:span['end']]!=span['quoted_text'] or span['start']>=span['end']):fail('INVALID_SPAN','/evidence/'+e['evidence_id'],'Span does not match raw text')
    for event in events.values():
        refs(event['supporting_evidence_ids'],ev,'/review_events')
        if event['run_id']!=run['run_id'] or event['resulting_revision']!=event['expected_revision']+1 or event['resulting_revision']>run['revision']:fail('REVIEW_REVISION','/review_events','Invalid revision/run')
    for region in regions.values():
        source=files.get(region['file_id'])
        if not source or region['sheet_id'] not in {s['sheet_id'] for s in source['sheets']}:fail('REGION_SOURCE','/regions',region['region_id'])
        refs(region['header_evidence_ids'],ev,'/regions')
        if final and (region['resolution']=='unresolved' or not region['approval_ref']):fail('LAYOUT_UNRESOLVED','/regions',region['region_id'])
        if final and trusted is not None and region['approval_ref'] not in trusted.get('layout_approvals',set()):fail('LAYOUT_APPROVAL_UNVERIFIED','/regions',region['region_id'])
        for disposition in region['coverage']:
            refs([disposition['evidence_id']],ev,'/regions/coverage');refs(disposition['item_ids'],items,'/regions/coverage')
            if final and disposition['disposition']=='unresolved':fail('COVERAGE_UNRESOLVED','/regions',region['region_id'])
    covered={d['evidence_id'] for r in regions.values() for d in r['coverage']}
    if final:
        for identity in ev:
            if identity not in covered:fail('COVERAGE_MISSING','/evidence',identity)
    for issue in issues.values():
        refs(issue['competing_candidate_ids'],candidates,'/issues')
        if issue['resolution_status']=='resolved' and not (issue['resolution_rule'] or issue['resolving_event_id'] in events):fail('ISSUE_RESOLUTION','/issues',issue['issue_id'])
        if final and issue['severity']!='info' and issue['resolution_status']=='open':fail('OPEN_ISSUE','/issues',issue['issue_id'])
    for item in items.values():
        path='/items/'+item['item_id'];refs(item['issue_ids'],issues,path)
        region=regions.get(item['lineage']['region_id'])
        if not region or region['file_id']!=item['lineage']['file_id'] or region['sheet_id']!=item['lineage']['sheet_id']:fail('ITEM_LINEAGE',path,'Region source mismatch')
        for anchor in item['lineage']['source_ranges']:
            if (item['lineage']['file_id'],item['lineage']['sheet_id'],anchor) not in {(e['file_id'],e['sheet_id'],e['range']) for e in ev.values()}:fail('ITEM_ANCHOR_MISSING',path,anchor)
        if final and item['inclusion'] in ('candidate','needs_review'):fail('ITEM_UNRESOLVED',path,'Unresolved inclusion')
        if item['inclusion']=='excluded' and not item['exclusion_reason']:fail('EXCLUSION_REASON',path,'Reason required')
        selected={}
        for field,d in item['fields'].items():
            fp=path+'/fields/'+field;local={c['candidate_id']:c for c in d['candidates']};c=local.get(d['selected_candidate_id'])
            if d['selected_candidate_id'] is not None and c is None:fail('SELECTION_INVALID',fp,'Selection not in field candidates')
            accepted=d['resolution'] in ('auto_accepted','reviewer_accepted')
            if accepted and d['presence']=='present' and c is None:fail('SELECTION_REQUIRED',fp,'Present accepted fact needs candidate')
            if d['resolution']=='accepted_unknown' and (c is not None or d['presence'] not in ('absent','explicitly_unknown','unresolved')):fail('UNKNOWN_STATE',fp,'Unknown must not select a fact')
            if d['presence'] in ('absent','not_applicable') and (c or not d['disposition_reason']):fail('ABSENCE_STATE',fp,'Scoped absence reason and no selection required')
            if accepted and d['presence'] in ('unresolved','explicitly_unknown'):fail('DECISION_STATE',fp,'Unresolved presence cannot accept a value')
            if d['decision_revision']>run['revision']:fail('DECISION_REVISION',fp,'Future decision')
            review=events.get(d['review_event_id'])
            if d['resolution'] in ('reviewer_accepted','accepted_unknown') and (not review or field not in review['affected_ids'] and item['item_id'] not in review['affected_ids']):fail('REVIEW_REQUIRED',fp,'Missing scoped review event')
            if review and d['resolution']=='reviewer_accepted' and (review['action'] not in ('accept','correct') or review['new_candidate_id']!=d['selected_candidate_id'] or review['resulting_revision']!=d['decision_revision']):fail('REVIEW_DECISION_MISMATCH',fp,'Review event does not approve current decision')
            if review and d['resolution']=='accepted_unknown' and (review['action']!='accept_unknown' or review['new_candidate_id'] is not None or review['resulting_revision']!=d['decision_revision']):fail('REVIEW_DECISION_MISMATCH',fp,'Unknown review event mismatch')
            conf=d['confidence_assessment']
            if conf['calibrated_probability'] is not None and not conf['calibration_version']:fail('CALIBRATION_REQUIRED',fp,'Calibration version required')
            for candidate in d['candidates']:
                refs(candidate['evidence_ids'],ev,fp);refs(candidate['input_candidate_ids'],candidates,fp)
                if not candidate['evidence_ids'] and candidate['method']!='reviewer_assertion':fail('EVIDENCE_REQUIRED',fp,'Fact needs source evidence')
                if candidate['method']=='derived' and not candidate['input_candidate_ids']:fail('DERIVATION_INPUTS',fp,'Derived fact needs inputs')
                v=candidate['value']
                if field=='annual_usage':quantity(v,fp)
                if field=='customer_uom':unit(v,fp)
                if field=='pack_quantity':unit(v['container_uom'],fp);unit(v['content_uom'],fp)
            if c and accepted:
                selected[field]=c['value']
                sources=[ev[e] for e in c['evidence_ids'] if e in ev]
                if c['rule_version']=='join-v1' and (not isinstance(c['value'],str) or c['value']!=' '.join(str(e['raw_value']).strip() for e in sources)):fail('JOIN_VALUE_MISMATCH',fp,'Joined narrative differs from ordered source cells')
                if c['method']=='copied' and isinstance(c['value'],str) and not any(str(e['raw_value']).strip()==c['value'] for e in sources):fail('COPY_VALUE_MISMATCH',fp,'Copied text differs from source')
                if final and trusted is not None and trusted.get('field_approvals',{}).get((item['item_id'],field,c['candidate_id']))!=c['value']:fail('FIELD_APPROVAL_UNVERIFIED',fp,'Mapping and exact value not approved by controller')
                if any(e['semantic_role']!='customer_specification' or files.get(e['file_id'],{}).get('source_role') not in ('customer_input','operator_context') for e in sources):fail('SOURCE_ROLE',fp,'Non-customer evidence selected')
                if any(e['formula'] and not e['formula_verified'] for e in sources):fail('FORMULA_UNVERIFIED',fp,'Unverified formula')
                if d['resolution']=='auto_accepted' and (not ((c['method'] in ('copied','parsed','semantic') and trusted is not None and trusted.get('evaluated_approvals',{}).get((item['item_id'],field,c['candidate_id']))==c['value']) if c['rule_version']=='evaluated-v2' else (c['method'] in AUTO_METHODS and c['rule_version'] in AUTO_RULES)) or not region or region['resolution']=='unresolved' or d['review_reason_codes']):fail('AUTO_ACCEPT_FORBIDDEN',fp,'Not an approved deterministic decision')
                if d['resolution']=='auto_accepted' and len(d['candidates'])>1:fail('COMPETING_CANDIDATES',fp,'Multiple candidates require explicit resolution')
                if c['method']=='reviewer_assertion' and not review:fail('REVIEW_REQUIRED',fp,'Assertion needs reviewer')
                ns={'online_bid_sequence':'online_bid_sequence','customer_reference':'customer_reference','manufacturer_part_primary':'manufacturer_part','manufacturer_part_secondary':'manufacturer_part'}.get(field)
                if ns and c['value']['namespace']!=ns:fail('IDENTIFIER_NAMESPACE',fp,'Wrong identifier namespace')
            if final and item['inclusion']=='included' and (d['resolution'] in ('unresolved','rejected') or (d['presence']=='present' and not c)):fail('FIELD_UNRESOLVED',fp,'No final disposition')
        q=selected.get('annual_usage');u=selected.get('customer_uom');p=selected.get('pack_quantity')
        if q:
            if q['time_basis']!='annual' or q['amount']['kind']!='scalar':fail('ANNUAL_BASIS',path,'Annual scalar required')
            if q['uom'] and u and (q['uom']['code'],q['uom']['label'])!=(u['code'],u['label']):fail('QUANTITY_UOM_MISMATCH',path,'Quantity and output UOM differ')
        if p:
            if p['count'] is None or p['count']>50000:fail('PACK_BOUNDS',path,'Pack count 1..50000 required')
            if not u or (p['container_uom']['code'],p['container_uom']['label'])!=(u['code'],u['label']):fail('PACK_UOM_MISMATCH',path,'Pack container must match L')
        stock_identity=any(x['name']=='Source Product ID' and x['status']=='approved' and x['output_position'] is not None and any(v['item_id']==item['item_id'] and isinstance(v['value'],str) and bool(v['value']) and trusted is not None and trusted.get('stock_identity_approvals',{}).get(item['item_id'])==v['value'] and trusted.get('extension_value_approvals',{}).get((x['column_id'],item['item_id']))==v['value'] for v in x['values']) for x in run['extensions'])
        if final and item['inclusion']=='included' and not any(selected.get(f) for f in ('description_primary','online_bid_sequence','customer_reference','manufacturer_part_primary','manufacturer_part_secondary')) and not stock_identity:fail('IDENTITY_NOT_PROJECTABLE',path,'No usable projected identity')
        for q in item['quantity_observations']:quantity(q,path)
    if final and sum(i['inclusion']=='included' for i in items.values())>2000:fail('CAPACITY','/items','v1 capacity 2000')
    if trusted is not None:
        for e in ev.values():
            key=(e['file_id'],e['sheet_id'],e['range'])
            if key not in trusted.get('cells',{}) or trusted['cells'][key]!=e['raw_value']:fail('SOURCE_VALUE_MISMATCH','/evidence',e['evidence_id'])
        for f in files.values():
            if trusted.get('file_hashes',{}).get(f['file_id'])!=f['sha256']:fail('SOURCE_DIGEST_MISMATCH','/source_files',f['file_id'])
        if final and set(trusted.get('cells',{}))!={(e['file_id'],e['sheet_id'],e['range']) for e in ev.values()}:fail('INSPECTION_COVERAGE_MISMATCH','/evidence','Inspector inventory differs')
        if final:
            for item in items.values():
                for field,d in item['fields'].items():
                    if d['resolution'] in ('reviewer_accepted','accepted_unknown') and d['review_event_id'] not in trusted.get('review_event_ids',set()):fail('REVIEW_UNVERIFIED','/items',item['item_id'])
                    if item['inclusion']=='included' and d['presence'] in ('absent','not_applicable') and trusted.get('disposition_approvals',{}).get((item['item_id'],field))!=d['presence']:fail('ABSENCE_UNVERIFIED','/items',field)
    names=set();positions=set()
    for x in run['extensions']:
        refs(x['evidence_ids'],ev,'/extensions')
        for v in x['values']:
            refs([v['item_id']],items,'/extensions');refs(v['evidence_ids'],ev,'/extensions')
            if x['status']=='approved' and final and trusted is not None and trusted.get('extension_value_approvals',{}).get((x['column_id'],v['item_id']))!=v['value']:fail('COLUMN_VALUE_UNVERIFIED','/extensions','Approving a column does not approve inferred values')
        if x['name'].casefold() in names:fail('COLUMN_NAME_DUPLICATE','/extensions',x['name'])
        names.add(x['name'].casefold())
        if x['status'] in ('approved','declined'):
            event=events.get(x['review_event_id']);action='approve_column' if x['status']=='approved' else 'decline_column'
            if not event or event['action']!=action or x['column_id'] not in event['affected_ids']:fail('COLUMN_REVIEW_REQUIRED','/extensions',x['column_id'])
            if final and trusted is not None and x['review_event_id'] not in trusted.get('review_event_ids',set()):fail('REVIEW_UNVERIFIED','/extensions',x['column_id'])
        if x['status']=='approved':
            if x['output_position'] is None or x['output_position'] in positions:fail('COLUMN_POSITION','/extensions','Approved positions must be unique')
            positions.add(x['output_position'])
        elif x['output_position'] is not None:fail('COLUMN_NOT_APPROVED','/extensions','Unapproved column cannot be exported')
        if x['status']=='declined' and not x['decline_disposition']:fail('DECLINE_DISPOSITION','/extensions','Document consequences of declining')
        if final and x['status']=='proposed':fail('COLUMN_PENDING','/extensions',x['column_id'])
    return errors

def main():
    parser=argparse.ArgumentParser();parser.add_argument('file');parser.add_argument('--final',action='store_true');args=parser.parse_args()
    try:
        run=json.loads(Path(args.file).read_text(),parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
        result=validate(run,final=args.final)
    except (ValueError,OSError) as exc:result=[{'code':'INPUT_INVALID','path':'','message':str(exc)}]
    print(json.dumps({'valid':not result,'mode':'final_readiness' if args.final else 'record','errors':result},indent=2));return 1 if result else 0
if __name__=='__main__':raise SystemExit(main())
