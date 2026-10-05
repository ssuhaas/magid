import copy,unittest
from validator import validate
from test_validator import fixture,context
class Hardening(unittest.TestCase):
 def test_requires_independent_context(self):self.assertIn('TRUSTED_CONTEXT_REQUIRED',{e['code'] for e in validate(fixture(),final=True)})
 def test_fabricated_copy(self):
  r=fixture();t=context(r);r['items'][0]['fields']['description_primary']['candidates'][0]['value']='Invented';self.assertIn('COPY_VALUE_MISMATCH',{e['code'] for e in validate(r,final=True,trusted=t)})
 def test_fabricated_cell(self):
  r=fixture();t=context(r);r['evidence'][0]['raw_value']='Changed';self.assertIn('SOURCE_VALUE_MISMATCH',{e['code'] for e in validate(r,final=True,trusted=t)})
 def test_phantom_anchor(self):
  r=fixture();r['items'][0]['lineage']['source_ranges']=['Z999'];self.assertIn('ITEM_ANCHOR_MISSING',{e['code'] for e in validate(r,final=True,trusted=context(r))})
 def test_phantom_region(self):
  r=fixture();r['regions'][0]['file_id']='missing';self.assertIn('REGION_SOURCE',{e['code'] for e in validate(r,final=True,trusted=context(r))})
 def test_omitted_inspector_cell(self):
  r=fixture();t=context(r);t['cells'][('file1','sheet1','A3')]='Missing item';self.assertIn('INSPECTION_COVERAGE_MISMATCH',{e['code'] for e in validate(r,final=True,trusted=t)})
 def test_fake_layout_approval(self):
  r=fixture();t=context(r);t['layout_approvals']=set();self.assertIn('LAYOUT_APPROVAL_UNVERIFIED',{e['code'] for e in validate(r,final=True,trusted=t)})
 def test_fake_field_approval(self):
  r=fixture();t=context(r);t['field_approvals']={};self.assertIn('FIELD_APPROVAL_UNVERIFIED',{e['code'] for e in validate(r,final=True,trusted=t)})
 def extension(self):return dict(column_id='source_id',name='Source Product ID',meaning='Source code without false manufacturer namespace',benefit_reason='Retains matching identity',evidence_ids=['e1'],values=[dict(item_id='i1',value='Glove',evidence_ids=['e1'])],status='proposed',review_event_id=None,output_position=None,decline_disposition=None)
 def test_pending_column_blocks(self):
  r=fixture();r['extensions']=[self.extension()];self.assertIn('COLUMN_PENDING',{e['code'] for e in validate(r,final=True,trusted=context(r))})
 def test_unapproved_column_position(self):
  r=fixture();x=self.extension();x['output_position']=14;r['extensions']=[x];self.assertIn('COLUMN_NOT_APPROVED',{e['code'] for e in validate(r)})
 def test_approved_column(self):
  r=fixture();r['revision']=1;x=self.extension();x.update(status='approved',review_event_id='colreview',output_position=14);r['extensions']=[x];r['review_events']=[dict(event_id='colreview',run_id='run1',affected_ids=['source_id'],expected_revision=0,resulting_revision=1,actor_id='reviewer',timestamp='2026-09-30T08:00:00Z',action='approve_column',prior_candidate_id=None,new_candidate_id=None,reason='Needed for matching',supporting_evidence_ids=['e1'])];self.assertEqual(validate(r,final=True,trusted=context(r)),[])
if __name__=='__main__':unittest.main()
