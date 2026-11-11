#!/usr/bin/env python3
"""Resumable, capped ElevenLabs production. Keys never appear in arguments/logs."""
import argparse
import array
import base64
import concurrent.futures
import datetime
import difflib
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave

from settings import REPO, WORK as ROOT
import contextlib
import fcntl

@contextlib.contextmanager
def operation_lock():
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT/'.production.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('Another audio operation is running in this edition') from None
        yield

VOICE = 'iYng6Ie859Dxu5Nstki4'
MODEL = 'eleven_v4'
CAP = 750000
LOCK = threading.Lock()
ALIASES = {'XBE':'X B E','BCMI':'B C M I','AGI':'A G I','AI':'A I',
           'API':'A P I','WIP':'work in progress','R&D':'research and development',
           'M&A':'mergers and acquisitions','e.g.':'for example','i.e.':'that is',
           'vs.':'versus','Esthergen':'Esther Jen'}

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(x): return hashlib.sha256(x).hexdigest()
def read_json(path): return json.loads(path.read_text())
def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    temp.replace(path)

def say(text): print(text,flush=True)

def speak(text):
    changes=[]
    for a,b in ALIASES.items():
        pattern=r'(?<!\w)'+re.escape(a)+r'(?!\w)'
        text,n=re.subn(pattern,b,text)
        if n: changes.append({'from':a,'to':b,'count':n})
    return text,changes

def plan():
    manifest=read_json(ROOT/'manifest.json')
    for name,expected in manifest['source_hashes'].items():
        if digest((REPO/name).read_bytes())!=expected:
            raise RuntimeError('Source changed: '+name)
    units=[]
    for chapter in manifest['chapters']:
        text=(ROOT/chapter['file']).read_text()
        if digest(text.encode())!=chapter['sha256']: raise RuntimeError('Script changed: '+chapter['file'])
        spoken,changes=speak(text)
        paragraphs=[x for x in spoken.strip().split('\n\n') if x]
        groups=[];current=[]
        for paragraph in paragraphs:
            if len(paragraph)>3200: raise RuntimeError('Long paragraph requires editorial split')
            if current and len('\n\n'.join(current+[paragraph]))>2900:
                groups.append(current);current=[]
            current.append(paragraph)
        if current:groups.append(current)
        if len(groups)>1 and len('\n\n'.join(groups[-1]))<450:
            if len('\n\n'.join(groups[-2]+groups[-1]))<=3200:
                tail=groups.pop()
                groups[-1].extend(tail)
            elif len(groups[-2])>1:
                groups[-1].insert(0,groups[-2].pop())
        rendered=['\n\n'.join(g) for g in groups]
        assert ' '.join('\n\n'.join(rendered).split())==' '.join(spoken.split()), chapter['title']
        for i,body in enumerate(rendered):
            ident=f"{chapter['id']:03d}-{i+1:02d}"
            units.append({'id':ident,'chapter_id':chapter['id'],'chapter_title':chapter['title'],
                          'chapter_kind':chapter['kind'],'text':body,
                          'previous_text':rendered[i-1][-1200:] if i else None,
                          'next_text':rendered[i+1][:1200] if i+1<len(rendered) else None,
                          'characters':len(body),'text_sha256':digest(body.encode()),
                          'voice_id':VOICE,'model_id':MODEL,
                          'voice_settings':{'stability':0.5,'similarity_boost':0.75},
                          'source_aliases':changes if i==0 else []})
    data={'created':now(),'voice_id':VOICE,'model_id':MODEL,'credit_cap':CAP,
          'total_characters':sum(x['characters'] for x in units),'chapters':manifest['chapters'],'units':units}
    write_json(ROOT/'render-plan.json',data)
    say(f"Planned {len(units)} segments / {len(manifest['chapters'])} chapters / {data['total_characters']:,} characters.")
    return data

def key():
    value=os.environ.get('ELEVENLABS_API_KEY','')
    p=ROOT/'.env'
    if not value and p.exists():
        if p.stat().st_mode&0o077: raise RuntimeError('Credential file must be mode 0600')
        for line in p.read_text().splitlines():
            if line.startswith('ELEVENLABS_API_KEY='): value=line.split('=',1)[1].strip()
    if not value: raise RuntimeError('No approved ElevenLabs credential is configured')
    return value

def request(path,payload=None,content_type='application/json',timeout=240):
    headers={'xi-api-key':key(),'User-Agent':'Dionysus-Audiobook-Production/1.0'}
    data=None
    if payload is not None:
        data=json.dumps(payload).encode() if content_type=='application/json' else payload
        headers['Content-Type']=content_type
    req=urllib.request.Request('https://api.elevenlabs.io'+path,data=data,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            return json.loads(response.read()),dict(response.headers)
    except urllib.error.HTTPError as e:
        # No request headers or credential-bearing request object is logged.
        body=e.read(2000).decode(errors='replace').replace(key(),'[REDACTED]')
        raise RuntimeError(f'ElevenLabs HTTP {e.code}: {body}') from None

def preflight():
    voice,_=request('/v1/voices/'+VOICE)
    if 'ARCHIVED' in voice.get('name','').upper(): raise RuntimeError('Refusing archived voice')
    models,_=request('/v1/models')
    model=next((x for x in models if x['model_id']==MODEL),None)
    if not model or not model.get('can_do_text_to_speech'):raise RuntimeError('Required model unavailable')
    subscription,_=request('/v1/user/subscription')
    brief={'checked_at':now(),'voice_id':VOICE,'voice_name':voice.get('name'),'category':voice.get('category'),
           'model':model,'subscription':{k:subscription.get(k) for k in ['tier','character_count','character_limit','next_character_count_reset_unix','status']}}
    write_json(ROOT/'review/api-preflight.json',brief)
    say(json.dumps({k:v for k,v in brief.items() if k not in ('model',)},ensure_ascii=False))

def reserve(unit):
    with LOCK:
        path=ROOT/'render-ledger.json'
        data=read_json(path) if path.exists() else {'cap':CAP,'reserved_characters':0,'attempts':[]}
        if data['reserved_characters']+unit['characters']>CAP:raise RuntimeError('Production credit cap reached')
        data['reserved_characters']+=unit['characters']
        entry={'id':unit['id'],'time':now(),'characters':unit['characters'],'text_sha256':unit['text_sha256'],'status':'reserved'}
        data['attempts'].append(entry);write_json(path,data)

def pcm_wav(audio):
    if audio[:4]==b'RIFF':return audio
    if len(audio)%2:raise RuntimeError('PCM payload has an odd byte count')
    result=io.BytesIO()
    with wave.open(result,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes(audio)
    return result.getvalue()

def wave_stats(path):
    with wave.open(str(path),'rb') as w:
        if (w.getnchannels(),w.getsampwidth(),w.getframerate())!=(1,2,44100):raise RuntimeError('Unexpected WAV format: '+str(path))
        values=array.array('h',w.readframes(w.getnframes()));duration=len(values)/44100
    if not values:raise RuntimeError('Empty audio')
    peak=max(abs(x) for x in values)/32768
    rms=math.sqrt(sum((x/32768)**2 for x in values)/len(values))
    return {'duration':duration,'peak_dbfs':20*math.log10(max(peak,1e-12)),
            'rms_dbfs':20*math.log10(max(rms,1e-12)),
            'clipped_samples':sum(abs(x)>=32760 for x in values),'frames':len(values)}

def render_text(unit):
    text=unit['text'];path=ROOT/'review/phoneme-overrides.json'
    overrides=read_json(path).get(unit['id'],{}) if path.exists() else {}
    for word,phoneme in overrides.items():
        text=re.sub(r'(?<!\w)'+re.escape(word)+r'(?!\w)',phoneme,text)
    return text

def render_unit(unit,retake=False):
    dest=ROOT/'raw'/unit['id'];dest.mkdir(parents=True,exist_ok=True)
    takes=sorted(dest.glob('take-[0-9][0-9].json'))
    if takes and not retake:
        prior=read_json(takes[-1]);audio=dest/prior['audio_file']
        if prior['text_sha256']!=unit['text_sha256']:raise RuntimeError('Previously generated text differs: '+unit['id'])
        if prior.get('render_text_sha256',prior['text_sha256'])!=digest(render_text(unit).encode()):
            raise RuntimeError('Render pronunciation changed: '+unit['id'])
        if audio.exists() and digest(audio.read_bytes())==prior['audio_sha256']:
            say('reuse '+unit['id']);return prior
        raise RuntimeError('Incomplete cached audio: '+unit['id'])
    take=max([int(x.stem.split('-')[1]) for x in takes],default=0)+1;actual_text=render_text(unit);reserve({**unit,'characters':len(actual_text)})
    payload={'text':actual_text,'model_id':unit['model_id'],'voice_settings':unit['voice_settings'],
             'apply_text_normalization':'on','seed':(int(unit['text_sha256'][:8],16)+take-1)%(2**32)}
    for context in ['previous_text','next_text']:
        if unit.get(context):payload[context]=unit[context]
    if unit['model_id']!='eleven_multilingual_v2':payload['language_code']='en'
    started=time.monotonic()
    result,headers=request('/v1/text-to-speech/'+VOICE+'/with-timestamps?output_format=pcm_44100',payload)
    data=pcm_wav(base64.b64decode(result.pop('audio_base64')))
    audio_name=f'take-{take:02d}.wav';(dest/audio_name).write_bytes(data)
    record={'unit_id':unit['id'],'created':now(),'audio_file':audio_name,'audio_sha256':digest(data),
            'text_sha256':unit['text_sha256'],'render_text_sha256':digest(payload['text'].encode()),'request':payload,'voice_id':VOICE,
            'request_id':headers.get('request-id',headers.get('Request-Id')),
            'character_cost':headers.get('character-cost'),'elapsed':round(time.monotonic()-started,1),
            'timing':result,'stats':wave_stats(dest/audio_name),'status':'generated_not_proofed'}
    write_json(dest/f'take-{take:02d}.json',record)
    write_json(dest/'selected.json',{'take':take,'metadata':f'take-{take:02d}.json','audio':audio_name,'status':'candidate'})
    say(f"generated {unit['id']} {record['stats']['duration']:.1f}s")
    return record

def select_units(data,chapters):
    if not chapters:return data['units']
    choices={int(x) for x in chapters.split(',')}
    return [x for x in data['units'] if x['chapter_id'] in choices]

def render(data,chapters=None,workers=2,retake=False):
    selected=select_units(data,chapters);by_chapter={}
    for unit in selected:by_chapter.setdefault(unit['chapter_id'],[]).append(unit)
    def chapter_job(units):
        for unit in units:render_unit(unit,retake)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        jobs=[pool.submit(chapter_job,units) for units in by_chapter.values()]
        for job in concurrent.futures.as_completed(jobs):job.result()

def selected_record(unit):
    dest=ROOT/'raw'/unit['id'];selection=read_json(dest/'selected.json');record=read_json(dest/selection['metadata'])
    if record['text_sha256']!=unit['text_sha256']:raise RuntimeError('Selected take has stale script')
    if record.get('render_text_sha256',record['text_sha256'])!=digest(render_text(unit).encode()):
        raise RuntimeError('Selected take has stale script')
    return dest,record

def transcribe_unit(unit):
    dest,record=selected_record(unit);out=dest/(Path(record['audio_file']).stem+'-transcript.json')
    if out.exists():
        if read_json(out).get('_audio_sha256')==record['audio_sha256']: return
        raise RuntimeError('Cached transcript belongs to different audio')
    audio=(dest/record['audio_file']).read_bytes()
    boundary='Dionysus'+uuid.uuid4().hex
    fields={'model_id':'scribe_v2','language_code':'en','diarize':'false','tag_audio_events':'true','timestamps_granularity':'word'}
    pieces=[]
    for name,value in fields.items():pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{unit["id"]}.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()+audio+b'\r\n')
    pieces.append(f'--{boundary}--\r\n'.encode())
    result,_=request('/v1/speech-to-text',b''.join(pieces),'multipart/form-data; boundary='+boundary,timeout=600)
    result['_audio_sha256']=record['audio_sha256'];write_json(out,result)
    say('transcribed '+unit['id'])

def normalize(text):
    text=re.sub(r'\bc\.\s*(?=\d)','circa ',text)
    text=re.sub(r'\b(\d{1,2}):00\s*([AP]M)\b',r'\1 \2',text,flags=re.I)
    text=re.sub(r'\b([ap])\.\s*m\.',r'\1m',text,flags=re.I)
    text=re.sub(r'(\d{4}s?)[–-](?=\d{4}|present)',r'\1 to ',text,flags=re.I)
    decades={'20':'twenties','30':'thirties','40':'forties','50':'fifties','60':'sixties','70':'seventies','80':'eighties','90':'nineties','00':'hundreds','10':'tens'}
    text=re.sub(r'\b(1[1-9]|20)([0-9]0)s\b',lambda m:number_words(int(m[1]))+' '+decades[m[2]],text)
    text=re.sub(r'\b(Interlude|Act) I\b',r'\1 one',text)
    text=re.sub(r'(?<=\d),(?=\d{3}(?:\D|$))','',text)
    text=re.sub(r'([$€£])(\d+(?:[.,]\d+)?)(\+)?(\s+(?:million|billion|trillion))?(\+)?',
                lambda m:m[2]+(' plus' if m[3] else '')+(m[4] or '')+(' plus' if m[5] else '')+' '+{'$':'dollar','€':'euro','£':'pound'}[m[1]],text)
    text=text.replace('%',' percent ')
    roman={'II':'two','III':'three','IV':'four','V':'five','VI':'six','VII':'seven','VIII':'eight','IX':'nine','X':'ten'}
    text=re.sub(r'\b(?:II|III|IV|V|VI|VII|VIII|IX)\b',lambda m:roman[m[0]],text)
    text=text.replace('—',' ').replace('–',' ').replace('’',"'")
    text=unicodedata.normalize('NFKD',text).encode('ascii','ignore').decode().lower()
    text=text.replace('&',' and ').replace("'",'')
    text=re.sub(r'\bdollars\b','dollar',text)
    text=re.sub(r'\beuros\b','euro',text)
    text=re.sub(r'\bhundred and\b','hundred',text)
    text=re.sub(r'\bthousand and\b','thousand',text)
    text=re.sub(r'\bdionysus\s*program\s*(?:dot|\.)\s*com\b','dionysusprogramcom',text)
    text=re.sub(r'\bx86\b','x eighty six',text)
    for pattern,replacement in [(r'\banti[ -]social\b','antisocial'),(r'\bcon[ -]way\b','conway'),
      (r'\brun[ -]time\b','runtime'),(r'\bx\s+b\s+e\b','xbe'),(r'\ba\s+g\s+i\b','agi'),
      (r'\ba\s+i\b','ai'),(r'\bg\s+p\s+t\b','gpt'),(r'\bb\s+c\s+m\s+i\b','bcmi'),
      (r'\bnon[ -]commercial\b','noncommercial'),(r'\bno[ -]?derivatives\b','noderivatives')]:
        text=re.sub(pattern,replacement,text)
    # Compare written numerals with their ordinary spoken form, including years.
    text=re.sub(r'\b(\d+)\.(\d+)\b',lambda m:number_words(int(m[1]))+' point '+' '.join(number_words(int(x)) for x in m[2]),text)
    def number(m):
        n=int(m[0])
        if 1100<=n<=1999 and n%100:return number_words(n//100)+(' oh ' if n%100<10 else ' ')+number_words(n%100)
        if 2010<=n<=2099:return 'twenty '+number_words(n%100)
        return number_words(n)
    def ordinal(m):
        parts=number_words(int(m[1])).split()
        endings={'one':'first','two':'second','three':'third','five':'fifth','eight':'eighth','nine':'ninth','twelve':'twelfth'}
        last=parts[-1];parts[-1]=endings.get(last,last[:-1]+'ieth' if last.endswith('y') else last+'th')
        return ' '.join(parts)
    text=re.sub(r'\b(\d+)(?:st|nd|rd|th)\b',ordinal,text)
    text=re.sub(r'\b\d+\b',number,text)
    text=re.sub(r'\b(\d+)([a-z])\b',lambda m:number_words(int(m[1]))+' '+m[2],text)
    text=re.sub(r'\btwo thousand (?:and )?(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b',r'twenty \1',text)
    return re.findall(r'[a-z0-9]+',text)

def number_words(n):
    small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
    tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
    if n<20:return small[n]
    if n<100:return tens[n//10]+(' '+small[n%10] if n%10 else '')
    if n<1000:return small[n//100]+' hundred'+(' '+number_words(n%100) if n%100 else '')
    if n<1000000:return number_words(n//1000)+' thousand'+(' '+number_words(n%1000) if n%1000 else '')
    return str(n)

def check_unit(unit):
    dest,record=selected_record(unit)
    transcript=read_json(dest/(Path(record['audio_file']).stem+'-transcript.json'))
    if transcript['_audio_sha256']!=record['audio_sha256']:raise RuntimeError('Stale transcript')
    expected=normalize(unit['text']);heard=normalize(transcript['text']);matcher=difflib.SequenceMatcher(None,expected,heard,autojunk=False)
    changes=[];errors=0
    for tag,a,b,c,d in matcher.get_opcodes():
        if tag=='equal':continue
        errors+=max(b-a,d-c)
        changes.append({'kind':tag,'expected':' '.join(expected[a:b]),'heard':' '.join(heard[c:d]),
                        'context':' '.join(expected[max(0,a-7):min(len(expected),b+7)])})
    words=[w for w in transcript.get('words',[]) if w.get('type')=='word']
    gaps=[{'after':a['text'],'before':b['text'],'seconds':round(b['start']-a['end'],2)} for a,b in zip(words,words[1:]) if b['start']-a['end']>2.5]
    wpm=len(expected)/record['stats']['duration']*60
    report={'id':unit['id'],'chapter':unit['chapter_title'],'duration':record['stats']['duration'],
            'words_per_minute':round(wpm,1),'word_difference_ratio':round(errors/max(1,len(expected)),4),
            'changes':changes,'long_gaps':gaps,'clipped_samples':record['stats']['clipped_samples'],
            'status':'requires_review' if changes or gaps or not 100<=wpm<=205 else 'automated_checks_passed'}
    write_json(ROOT/'review/segments'/f"{unit['id']}.json",report);return report

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['plan','preflight','render','transcribe','check'])
    parser.add_argument('--chapters');parser.add_argument('--workers',type=int,default=2)
    parser.add_argument('--retake',action='store_true')
    parser.add_argument('--plan-file',default='render-plan.json')
    args=parser.parse_args()
    if args.action=='plan':plan();return
    if args.action=='preflight':preflight();return
    data=read_json(ROOT/args.plan_file);units=select_units(data,args.chapters)
    if args.action=='render':render(data,args.chapters,args.workers,args.retake)
    elif args.action=='transcribe':
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for result in pool.map(transcribe_unit,units):pass
    elif args.action=='check':
        reports=[check_unit(u) for u in units];write_json(ROOT/'review/transcript-checks.json',reports)
        say(json.dumps({'segments':len(reports),'requires_review':sum(x['status']=='requires_review' for x in reports)},ensure_ascii=False))

if __name__=='__main__':
    with operation_lock(): main()
