#!/usr/bin/env python3
"""Assemble lossless chapters, level speech, export and measure listening files."""
import argparse
import array
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import wave
import produce as p

ROOT=p.ROOT
DELIVERY=ROOT/'delivery'
WORK=ROOT/'assembly'
RATE=44100

def ff(args):
    r=subprocess.run(['ffmpeg','-hide_banner','-nostdin','-y',*map(str,args)],capture_output=True,text=True)
    if r.returncode:raise RuntimeError(r.stderr[-3500:])
    return r.stderr

def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-show_chapters','-of','json',str(path)],text=True))

def measure(path):
    result=ff(['-i',path,'-vn','-af','loudnorm=I=-20:TP=-3.5:LRA=7:print_format=json','-f','null','-'])
    loud=json.loads(re.findall(r'\{\s*"input_i".*?\}',result,re.S)[-1])
    result=ff(['-i',path,'-vn','-af','astats=metadata=0:reset=0','-f','null','-'])
    rms=re.findall(r'RMS level dB: ([-\d.inf]+)',result)
    return {'integrated_lufs':float(loud['input_i']),'true_peak_dbtp':float(loud['input_tp']),
            'loudness_range_lu':float(loud['input_lra']),'rms_dbfs':float(rms[-1]),'loudnorm':loud}

def chapter_stem(ch):return f"{ch['id']:03d}-"+Path(ch['file']).stem.split('-',1)[1]

def assemble(ch,units):
    WORK.mkdir(exist_ok=True);out=WORK/(chapter_stem(ch)+'.wav')
    edits=[]
    with wave.open(str(out),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
        w.writeframes(b'\0\0'*round(.65*RATE))
        for index,u in enumerate(units):
            dest,record=p.selected_record(u)
            with wave.open(str(dest/record['audio_file']),'rb') as src:
                data=src.readframes(src.getnframes())
            samples=array.array('h',data)
            # Trim only exterior near-digital silence. Keep 120 ms breathing room.
            first=next((i for i,v in enumerate(samples) if abs(v)>18),0)
            last=next((len(samples)-1-i for i,v in enumerate(reversed(samples)) if abs(v)>18),len(samples)-1)
            start=max(0,first-round(.12*RATE));end=min(len(samples),last+round(.12*RATE)+1)
            w.writeframes(data[start*2:end*2])
            if index+1<len(units):w.writeframes(b'\0\0'*round(.40*RATE))
            edits.append({'unit':u['id'],'source_sha256':record['audio_sha256'],
                          'trim_start_seconds':start/RATE,'trim_end_seconds':(len(samples)-end)/RATE,
                          'retained_frames':end-start})
        w.writeframes(b'\0\0'*round(1.3*RATE))
    return out,edits

def master_chapter(ch,units):
    stem=chapter_stem(ch)
    reportfile=ROOT/'review/masters'/(stem+'.json')
    wav=ROOT/'masters/wav'/(stem+'.wav');mp3=DELIVERY/'mp3'/(stem+'.mp3')
    signature=p.digest(json.dumps([(u['text_sha256'],p.selected_record(u)[1]['audio_sha256']) for u in units]).encode())
    if reportfile.exists() and wav.exists() and mp3.exists():
        old=p.read_json(reportfile)
        if old.get('source_signature')==signature:return old
    wav.parent.mkdir(parents=True,exist_ok=True);mp3.parent.mkdir(parents=True,exist_ok=True)
    raw,edits=assemble(ch,units)
    initial=measure(raw);m=initial['loudnorm']
    normalizer=('loudnorm=I=-20:TP=-3.5:LRA=7:measured_I='+m['input_i']+
       ':measured_TP='+m['input_tp']+':measured_LRA='+m['input_lra']+
       ':measured_thresh='+m['input_thresh']+':offset='+m['target_offset']+':linear=true')
    ff(['-i',raw,'-af',normalizer,'-ar',RATE,'-ac',1,'-c:a','pcm_s24le',wav])
    args=['-i',wav]
    cover=DELIVERY/'cover.jpg'
    if cover.exists():args+=['-i',cover,'-map','0:a:0','-map','1:v:0','-c:v','copy','-disposition:v','attached_pic']
    args+=['-c:a','libmp3lame','-b:a','192k','-ar',RATE,'-ac',1,'-id3v2_version','3',
       '-metadata','title='+ch['title'],'-metadata','album=The Dionysus Program: Rites of Renewal',
       '-metadata','artist=Sean Devine','-metadata',f"track={ch['id']+1}/{len(p.read_json(ROOT/'render-plan.json')['chapters'])}",'-metadata','genre=Audiobook',
       '-metadata','date='+str(p.read_json(ROOT/'source/edition.json')['year']),'-metadata','copyright='+p.read_json(ROOT/'source/edition.json')['copyright'],
       '-metadata','comment=Narrated in Sean Devine’s digitally generated voice using ElevenLabs.',mp3]
    ff(args)
    result=measure(mp3);info=probe(mp3)
    audio=next(s for s in info['streams'] if s['codec_type']=='audio')
    with wave.open(str(raw),'rb') as w:frames=w.getnframes()
    checks={'rms':-23<=result['rms_dbfs']<=-18,'true_peak':result['true_peak_dbtp']<=-3,
            'sample_rate':audio['sample_rate']=='44100','mono':audio['channels']==1,
            'bitrate':int(audio['bit_rate'])>=192000,'duration':frames/RATE<7200}
    report={'id':ch['id'],'title':ch['title'],'source_signature':signature,'edits':edits,
            'frames':frames,'duration':frames/RATE,'measurement':result,'checks':checks,
            'wav':str(wav.relative_to(ROOT)),'mp3':str(mp3.relative_to(ROOT)),
            'sha256':p.digest(mp3.read_bytes()),'status':'passed' if all(checks.values()) else 'requires_review'}
    p.write_json(reportfile,report)
    p.say(f"mastered {ch['id']:03d} {report['status']} {result['rms_dbfs']:.1f} RMS {result['true_peak_dbtp']:.1f} TP")
    return report

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--chapters');ap.add_argument('--workers',type=int,default=3)
    a=ap.parse_args();data=p.read_json(ROOT/'render-plan.json')
    choices={int(x) for x in a.chapters.split(',')} if a.chapters else None
    jobs=[(c,[u for u in data['units'] if u['chapter_id']==c['id']]) for c in data['chapters'] if not choices or c['id'] in choices]
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        reports=list(pool.map(lambda args:master_chapter(*args),jobs))
    p.write_json(ROOT/'review/mastering-summary.json',reports)

if __name__=='__main__':main()
