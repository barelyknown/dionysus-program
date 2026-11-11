#!/usr/bin/env python3
"""Use compact embedded cover art without changing any MP3 audio packets."""
import concurrent.futures
import subprocess
from pathlib import Path
import master as m
import produce as p

def audio_hash(path):
    return subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-'],text=True).strip()

cover=p.ROOT/'assembly/embedded-cover.jpg'
m.ff(['-i',m.DELIVERY/'cover.jpg','-vf','scale=1000:1000','-q:v','3','-frames:v','1',cover])
def one(path):
    report=p.read_json(path);mp3=p.ROOT/report['mp3'];temp=mp3.with_suffix('.retag.mp3')
    before=audio_hash(mp3)
    m.ff(['-i',mp3,'-i',cover,'-map','0:a:0','-map','1:v:0','-c:a','copy','-c:v','copy','-map_metadata','0',
          '-id3v2_version','3','-disposition:v:0','attached_pic',temp])
    after=audio_hash(temp)
    if before!=after:raise RuntimeError('Audio packets changed: '+mp3.name)
    temp.replace(mp3);report['sha256']=p.digest(mp3.read_bytes());report['embedded_cover']='1000x1000 JPEG'
    report['audio_packets_sha256']=before;report['retag_audio_unchanged']=True;p.write_json(path,report)
    print('optimized artwork '+mp3.name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(one,sorted((p.ROOT/'review/masters').glob('*.json'))))
