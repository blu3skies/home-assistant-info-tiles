import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from app import Cache, bus_rows, filter_trains, train_time, create_app, Upstream, SOURCES
class Tests(unittest.TestCase):
 def test_bus_sort_limit(self):
  ref=datetime(2026,11,12,12,tzinfo=timezone.utc)
  rows=bus_rows([dict(lineName=str(i),timeToStation=i*60) for i in range(12,0,-1)],ref)
  self.assertEqual([r['line'] for r in rows],list(map(str,range(1,9))))
  self.assertEqual(rows[0]['arrival'],'2026-11-12T12:01:00+00:00')
 def test_platform_filter_limit_no_inference(self):
  rows=[dict(platform=p,std='12:10',etd='On time',destination='St Albans') for p in ['','-','3','4','1','2','1']]
  result=filter_trains(rows,1,datetime(2026,11,12,12,tzinfo=timezone.utc))
  self.assertEqual({p:len(v) for p,v in result.items()},{'1':1,'2':1})
 def test_cache_empty_failure_recovery(self):
  tick=[0]; fetch=Mock(side_effect=[[],RuntimeError(),[1]]); cache=Cache(fetch,10,lambda:tick[0])
  self.assertEqual(cache.get()['data'],[]); cache.get(); self.assertEqual(fetch.call_count,1)
  tick[0]=10; stale=cache.get(); self.assertEqual(stale['state'],'stale'); self.assertIsNotNone(stale['last_successful_update'])
  tick[0]=20; self.assertEqual(cache.get()['data'],[1])
 def test_failure_shared_clients(self):
  fetch=Mock(side_effect=RuntimeError('secret')); c=create_app({s:fetch for s in SOURCES}).test_client()
  self.assertEqual(c.get('/api/buses').status_code,503)
  self.assertEqual(c.get('/api/buses').json['state'],'unavailable'); self.assertEqual(fetch.call_count,1)
  self.assertNotIn('secret',c.get('/api/buses').text)
 def test_concurrency(self):
  fetch=Mock(return_value=[]); cache=Cache(fetch,60)
  with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(lambda _:cache.get(),range(20)))
  self.assertEqual(fetch.call_count,1)
 def test_dst_midnight(self):
  self.assertEqual(train_time('12:15',datetime(2026,7,1,11,tzinfo=timezone.utc)),'2026-07-01T11:15:00+00:00')
  self.assertEqual(train_time('00:05',datetime(2026,11,12,23,55,tzinfo=timezone.utc)),'2026-11-13T00:05:00+00:00')
 @patch('app.requests.get')
 def test_upstream_error(self,get):
  get.return_value.raise_for_status.side_effect=RuntimeError()
  with self.assertRaises(RuntimeError):Upstream().tube()
 @patch('app.requests.post')
 @patch.dict('os.environ',{'NATIONAL_RAIL_TOKEN':'test'})
 def test_soap_empty_fault(self,post):
  post.return_value.content=b'<Envelope><GetStationBoardResult/></Envelope>'
  self.assertEqual(Upstream().trains(),{'1':[],'2':[]})
  post.return_value.content=b'<Envelope><Fault>bad</Fault></Envelope>'
  with self.assertRaises(ValueError):Upstream().trains()
 def test_routes(self):
  c=create_app({s:lambda:[] for s in SOURCES}).test_client()
  for s in SOURCES:
   self.assertEqual(c.get('/tiles/'+s).status_code,200); self.assertEqual(c.get('/api/'+s).json['state'],'ok')
  self.assertEqual(c.get('/health').status_code,200); self.assertEqual(c.get('/tiles/weather').status_code,404)
if __name__=='__main__':unittest.main()
