#!/usr/bin/env python3
"""Resumable render/transcribe/check pass. Includes opening and closing credits."""
import concurrent.futures
import threading
import produce as p
from settings import REPO

def main():
    data=p.read_json(p.ROOT/'render-plan.json')
    manifest=p.read_json(p.ROOT/'manifest.json')
    for name,sha in manifest['source_hashes'].items():
        if p.digest((REPO/name).read_bytes())!=sha: raise RuntimeError('Source changed: '+name)
    chapters={}
    for u in data['units']: chapters.setdefault(u['chapter_id'],[]).append(u)
    progress={'started':p.now(),'total_segments':len(data['units']),'completed':{},'errors':{}}
    lock=threading.Lock()
    def one(units):
        for u in units:
            try:
                p.render_unit(u);p.transcribe_unit(u);report=p.check_unit(u)
                with lock:
                    progress['completed'][u['id']]=report
                    p.write_json(p.ROOT/'review/full-progress.json',progress)
            except Exception as e:
                with lock:
                    progress['errors'][u['id']]=str(e)
                    p.write_json(p.ROOT/'review/full-progress.json',progress)
                p.say('FAILED '+u['id']+': '+str(e));return
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: list(pool.map(one,chapters.values()))
    progress['finished']=p.now();p.write_json(p.ROOT/'review/full-progress.json',progress)
    if progress['errors']: raise RuntimeError('Some chapters failed; inspect review/full-progress.json before resuming')
    p.say('All segments generated and transcribed. Editorial review remains required.')

if __name__=='__main__':
    with p.operation_lock(): main()
