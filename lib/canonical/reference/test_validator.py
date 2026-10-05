import copy
import json
import unittest
from pathlib import Path
from validator import validate

def fixture():
    names=['online_bid_sequence','customer_reference','output_category','description_primary','description_secondary','size','manufacturer_name','manufacturer_part_primary','manufacturer_part_secondary','annual_usage','customer_uom','pack_quantity']
    fields={n:dict(presence='absent',candidates=[],selected_candidate_id=None,resolution='auto_accepted',review_reason_codes=[],decision_revision=0,review_event_id=None,disposition_reason='No value in reviewed source region',confidence_assessment=dict(model_score=None,calibrated_probability=None,calibration_version=None)) for n in names}
    fields['description_primary'].update(presence='present',candidates=[candidate('description','Glove')],selected_candidate_id='description',disposition_reason=None)
    return dict(schema_version='1.1.0',run_id='run1',revision=0,extraction_version='v1',policy_version='v1',template=dict(file_id='template',sha256='a'*64),bid_metadata=dict(customer_name=None,ticket_number=None),source_files=[dict(file_id='file1',original_name='synthetic.xlsx',sha256='b'*64,source_role='customer_input',sheets=[dict(sheet_id='sheet1',name='Items',ordinal=0)])],evidence=[dict(evidence_id='e1',file_id='file1',sheet_id='sheet1',range='A2',raw_value='Glove',stored_type='string',displayed_text='Glove',number_format=None,formula=None,cached_result=None,formula_verified=False,merge_anchor=None,semantic_role='customer_specification',span=None)],regions=[dict(region_id='r1',file_id='file1',sheet_id='sheet1',range='A1:A2',header_evidence_ids=[],lane_order=0,section_label=None,classification='item_table',resolution='approved_rule',approval_ref='layout-v1',coverage=[dict(evidence_id='e1',disposition='item',item_ids=['i1'],reason='Product')])],items=[dict(item_id='i1',lineage=dict(file_id='file1',sheet_id='sheet1',region_id='r1',source_ranges=['A2'],section=None,lane_order=0,source_order=0,parent_item_ids=[]),inclusion='included',exclusion_reason=None,fields=fields,identifiers=[],quantity_observations=[],pack_observations=[],context_notes=[],issue_ids=[])],issues=[],review_events=[],extensions=[])

def candidate(identity,value):return dict(candidate_id=identity,value=value,evidence_ids=['e1'],input_candidate_ids=[],method='copied',rule_version='copy-v1',explanation='Synthetic explicit cell mapping')
def choose(run,name,value):
    d=run['items'][0]['fields'][name];d.update(presence='present',candidates=[candidate(name,value)],selected_candidate_id=name,disposition_reason=None)
def unit(code):return dict(raw_text=code,code=code,label=None)
def quantity(basis='annual',value='0'):
    return dict(amount=dict(kind='scalar',value=value,minimum=None,maximum=None,alternatives=[]),time_basis=basis,period_text=None,uom=None,qualifiers=[])

def context(r):
    return dict(cells={(e['file_id'],e['sheet_id'],e['range']):e['raw_value'] for e in r['evidence']},file_hashes={f['file_id']:f['sha256'] for f in r['source_files']},layout_approvals={'layout-v1'},field_approvals={(i['item_id'],f,c['candidate_id']):copy.deepcopy(c['value']) for i in r['items'] for f,d in i['fields'].items() for c in d['candidates']},disposition_approvals={(i['item_id'],f):d['presence'] for i in r['items'] for f,d in i['fields'].items() if d['presence'] in ('absent','not_applicable')},extension_value_approvals={(x['column_id'],v['item_id']):v['value'] for x in r['extensions'] for v in x['values']},review_event_ids={e['event_id'] for e in r['review_events']})

class Tests(unittest.TestCase):
    def setUp(self):self.r=fixture()
    def codes(self,final=True):return {e['code'] for e in validate(self.r,final=final,trusted=context(self.r))}
    def test_valid_final(self):self.assertEqual(self.codes(),set())
    def test_unknown_properties(self):self.r['export_status']='final';self.assertIn('SHAPE',self.codes())
    def test_bool_not_integer(self):self.r['revision']=True;self.assertIn('SHAPE',self.codes())
    def test_missing_evidence(self):self.r['evidence']=[];self.assertIn('MISSING_REFERENCE',self.codes())
    def test_leading_zero_identifier(self):
        choose(self.r,'manufacturer_part_primary',dict(text='0011R10',namespace='manufacturer_part',issuer=None,source_label='Manufacturer Part Number',source_order=0));self.assertEqual(self.codes(),set());self.assertEqual(self.r['items'][0]['fields']['manufacturer_part_primary']['candidates'][0]['value']['text'],'0011R10')
    def test_wrong_namespace(self):
        choose(self.r,'manufacturer_part_primary',dict(text='2CVG3',namespace='distributor_item',issuer=None,source_label='Part #',source_order=0));self.assertIn('IDENTIFIER_NAMESPACE',self.codes())
    def test_zero_annual_valid(self):choose(self.r,'annual_usage',quantity());self.assertEqual(self.codes(),set())
    def test_daikin_unknown_basis(self):choose(self.r,'annual_usage',quantity('unknown','48'));self.assertIn('ANNUAL_BASIS',self.codes())
    def test_negative_quantity(self):choose(self.r,'annual_usage',quantity(value='-1'));self.assertIn('SHAPE',self.codes())
    def test_range_reversed(self):
        q=quantity();q['amount'].update(kind='range',value=None,minimum='10',maximum='5');self.r['items'][0]['quantity_observations']=[q];self.assertIn('QUANTITY_RANGE',self.codes())
    def test_quantity_branches(self):q=quantity();q['amount']['minimum']='0';self.r['items'][0]['quantity_observations']=[q];self.assertIn('QUANTITY_SHAPE',self.codes())
    def test_pair_pack_not_converted(self):
        choose(self.r,'customer_uom',unit('BX'));choose(self.r,'pack_quantity',dict(container_uom=unit('BX'),count=200,content_uom=unit('PR'),count_basis='pair',raw_expression='200 PR/BX'));self.assertEqual(self.codes(),set())
    def test_pack_mismatch(self):choose(self.r,'customer_uom',unit('EA'));choose(self.r,'pack_quantity',dict(container_uom=unit('BX'),count=100,content_uom=None,count_basis='unknown',raw_expression='100/BX'));self.assertIn('PACK_UOM_MISMATCH',self.codes())
    def test_pack_bounds(self):choose(self.r,'customer_uom',unit('BX'));choose(self.r,'pack_quantity',dict(container_uom=unit('BX'),count=50001,content_uom=None,count_basis='unknown',raw_expression='50001/BX'));self.assertIn('PACK_BOUNDS',self.codes())
    def test_tesla_conflict_draft_vs_final(self):
        d=self.r['items'][0]['fields']['pack_quantity'];d.update(presence='unresolved',resolution='unresolved',disposition_reason=None,candidates=[candidate('p10',dict(container_uom=unit('BX'),count=10,content_uom=None,count_basis='source_defined',raw_expression='10')),candidate('p100',dict(container_uom=unit('BX'),count=100,content_uom=None,count_basis='unknown',raw_expression='100/BX'))]);self.assertEqual(self.codes(False),set());self.assertIn('FIELD_UNRESOLVED',self.codes())
    def test_alternate_contamination(self):self.r['evidence'][0]['semantic_role']='quoted_alternate';self.assertIn('SOURCE_ROLE',self.codes())
    def test_semantic_auto_accept(self):self.r['items'][0]['fields']['description_primary']['candidates'][0]['method']='semantic';self.assertIn('AUTO_ACCEPT_FORBIDDEN',self.codes())
    def test_unknown_without_review(self):self.r['items'][0]['fields']['size'].update(presence='explicitly_unknown',resolution='accepted_unknown');self.assertIn('REVIEW_REQUIRED',self.codes())
    def test_accepted_unknown(self):
        self.r['revision']=1;self.r['review_events']=[dict(event_id='review1',run_id='run1',affected_ids=['size'],expected_revision=0,resulting_revision=1,actor_id='operator',timestamp='2026-09-30T04:00:00Z',action='accept_unknown',prior_candidate_id=None,new_candidate_id=None,reason='Unknown in source',supporting_evidence_ids=['e1'])];self.r['items'][0]['fields']['size'].update(presence='explicitly_unknown',resolution='accepted_unknown',review_event_id='review1',decision_revision=1);self.assertEqual(self.codes(),set())
    def test_unverified_formula(self):self.r['evidence'][0]['formula']='A1';self.assertIn('FORMULA_UNVERIFIED',self.codes())
    def test_span(self):self.r['evidence'][0]['span']=dict(start=0,end=2,quoted_text='bad');self.assertIn('INVALID_SPAN',self.codes())
    def test_unresolved_coverage(self):self.r['regions'][0]['coverage'][0]['disposition']='unresolved';self.assertIn('COVERAGE_UNRESOLVED',self.codes())
    def test_duplicate_id(self):self.r['evidence'].append(copy.deepcopy(self.r['evidence'][0]));self.assertIn('DUPLICATE_ID',self.codes())
    def test_competing_autoaccept(self):self.r['items'][0]['fields']['description_primary']['candidates'].append(candidate('other','Other glove'));self.assertIn('COMPETING_CANDIDATES',self.codes())
    def test_dependency_cycle(self):self.r['items'][0]['fields']['description_primary']['candidates'][0]['input_candidate_ids']=['description'];self.assertIn('DEPENDENCY_CYCLE',self.codes())
    def test_readiness_capacity(self):
        for i in range(2000):
            item=copy.deepcopy(self.r['items'][0]);item['item_id']='extra'+str(i);item['fields']['description_primary']['candidates'][0]['candidate_id']='desc'+str(i);item['fields']['description_primary']['selected_candidate_id']='desc'+str(i);self.r['items'].append(item)
        self.assertIn('CAPACITY',self.codes())

if __name__=='__main__':
    Path(__file__).with_name('example.valid.json').write_text(json.dumps(fixture(),indent=2)+'\n')
    unittest.main()
