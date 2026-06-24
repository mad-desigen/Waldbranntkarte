#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

STATE_URLS=[
"https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AWarngebiete_Bundeslaender&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
"https://maps.dwd.de/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=dwd%3AKV_VG250_BUNDESLAENDER_2020&outputFormat=application%2Fjson&srsName=EPSG%3A4326",
"https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/main/2_bundeslaender/3_mittel.geo.json"
]
HOSTS=["https://www.wettergefahren.de/DWD/warnungen/agrar/wbx/","https://www.dwd.de/DWD/warnungen/agrar/wbx/"]

def session():
 s=requests.Session(); r=Retry(total=5,connect=5,read=5,backoff_factor=1,status_forcelist=(429,500,502,503,504),allowed_methods=frozenset({'GET'})); s.mount('https://',HTTPAdapter(max_retries=r)); s.headers.update({'User-Agent':'Mozilla/5.0 (compatible; WBI-GitHub-Pages/3.0)','Referer':'https://www.wettergefahren.de/'}); return s

def fetch_first(s,urls,validator,accept):
 errors=[]
 for url in urls:
  try:
   res=s.get(url,timeout=60,headers={'Accept':accept}); res.raise_for_status(); body=res.content
   if validator(body): return body,url
   errors.append(f'{url}: ungültiges Datenformat')
  except Exception as e: errors.append(f'{url}: {e}')
 raise RuntimeError(' | '.join(errors))

def valid_geo(body):
 try: data=json.loads(body.decode('utf-8-sig'))
 except Exception: return False
 return isinstance(data,dict) and data.get('type')=='FeatureCollection' and len(data.get('features',[]))>=16

def valid_png(body): return len(body)>1000 and body.startswith(b'\x89PNG\r\n\x1a\n')
def image_urls(day):
 names=['wbx_stationen.png'] if day==0 else [f'wbx_stationen{day}kl.png',f'wbx_stationen{day}.png']
 return [urljoin(h,n) for h in HOSTS for n in names]
def write(path,body): path.parent.mkdir(parents=True,exist_ok=True); tmp=path.with_suffix(path.suffix+'.tmp'); tmp.write_bytes(body); tmp.replace(path)

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--output',type=Path,default=Path('site/data')); out=ap.parse_args().output; out.mkdir(parents=True,exist_ok=True); s=session()
 states,src=fetch_first(s,STATE_URLS,valid_geo,'application/geo+json,application/json;q=0.9,*/*;q=0.2'); data=json.loads(states.decode('utf-8-sig')); write(out/'states.geojson',json.dumps(data,ensure_ascii=False,separators=(',',':')).encode())
 status={'ok':True,'updated_at':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'states_source':src,'state_feature_count':len(data['features']),'images':[],'available_days':[]}
 for day in range(5):
  try:
   body,url=fetch_first(s,image_urls(day),valid_png,'image/png,image/*;q=0.9,*/*;q=0.2'); write(out/f'wbi_{day}.png',body); status['images'].append({'day':day,'source':url,'bytes':len(body)}); status['available_days'].append(day)
  except Exception as e:
   status.setdefault('warnings',[]).append({'day':day,'error':str(e)})
 if 0 not in status['available_days']: raise RuntimeError('Die aktuelle DWD-WBI-Karte konnte nicht geladen werden.')
 write(out/'status.json',json.dumps(status,ensure_ascii=False,indent=2).encode()); print(json.dumps(status,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
