#!/usr/bin/env python3
"""Create a chaptered M4B and a portable chapter-MP3 distribution archive."""
import csv
import json
import shutil
import subprocess
import zipfile
from pathlib import Path
import master as m
import produce as p
from settings import TOOLS

ROOT=p.ROOT;D=m.DELIVERY
def escape(s):return str(s).replace('\\','\\\\').replace('=','\\=').replace(';','\\;').replace('#','\\#').replace('\n','\\\n')
def timestamp(seconds):
    h=int(seconds)//3600;minute=(int(seconds)%3600)//60;sec=int(seconds)%60
    return f'{h:02d}:{minute:02d}:{sec:02d}'

def main():
    plan=p.read_json(ROOT/'render-plan.json');chapters=plan['chapters']
    reports=[p.read_json(ROOT/'review/masters'/(m.chapter_stem(c)+'.json')) for c in chapters]
    if any(r['status']!='passed' for r in reports):raise RuntimeError('Master QC has unresolved failures')
    for c,r in zip(chapters,reports):
        units=[u for u in plan['units'] if u['chapter_id']==c['id']]
        signature=p.digest(json.dumps([(u['text_sha256'],p.selected_record(u)[1]['audio_sha256']) for u in units]).encode())
        if signature!=r['source_signature']:raise RuntimeError('Stale chapter master: '+str(c['id']))
        if p.digest((ROOT/r['mp3']).read_bytes())!=r['sha256']:raise RuntimeError('MP3 checksum mismatch: '+str(c['id']))
    textreview=p.read_json(ROOT/'review/editorial-review.json')
    if textreview['missing'] or textreview['unresolved']:raise RuntimeError('Transcript review is not complete')
    ffmeta=[';FFMETADATA1','title=The Dionysus Program: Rites of Renewal','album=The Dionysus Program: Rites of Renewal',
       'artist=Sean Devine','album_artist=Sean Devine','composer=Sean Devine','genre=Audiobook','date='+str(p.read_json(ROOT/'source/edition.json')['year']),
       'copyright='+p.read_json(ROOT/'source/edition.json')['copyright'],
       'comment=Complete audiobook. Narrated in the author’s digitally generated voice using ElevenLabs.',
       'description=Rites of Renewal. Written by Sean Devine. Digital voice narration using the author’s selected voice clone.']
    concat=['ffconcat version 1.0'];start=0;tracks=[]
    for c,r in zip(chapters,reports):
        end=start+r['frames']
        ffmeta+=['[CHAPTER]','TIMEBASE=1/44100','START='+str(start),'END='+str(end),'title='+escape(c['title'])]
        wav=ROOT/r['wav'];concat.append("file '"+str(wav).replace("'","'\\''")+"'")
        tracks.append({'number':c['id']+1,'title':c['title'],'start_seconds':start/44100,'duration_seconds':r['duration'],'file':Path(r['mp3']).name})
        start=end
    (ROOT/'assembly/book.ffmetadata').write_text('\n'.join(ffmeta)+'\n')
    (ROOT/'assembly/book.ffconcat').write_text('\n'.join(concat)+'\n')
    book=D/'The Dionysus Program.m4b'
    m.ff(['-f','concat','-safe','0','-i',ROOT/'assembly/book.ffconcat','-i',D/'cover.jpg','-i',ROOT/'assembly/book.ffmetadata',
       '-map','0:a:0','-map','1:v:0','-map_metadata','2','-map_chapters','2','-af','volume=-0.7dB','-c:a','aac','-b:a','128k','-ac','1','-ar','44100',
       '-c:v','copy','-disposition:v:0','attached_pic','-movflags','+faststart',book])
    info=m.probe(book)
    if len(info.get('chapters',[]))!=len(chapters):raise RuntimeError('Chapter count mismatch')
    duration=float(info['format']['duration'])
    if abs(duration-start/44100)>.15:raise RuntimeError('Duration mismatch')
    book_measurement=m.measure(book)
    if book_measurement['true_peak_dbtp']>-3 or not -23<=book_measurement['rms_dbfs']<=-18:
        raise RuntimeError('Final AAC level check failed: '+json.dumps(book_measurement))
    sample=D/'The Dionysus Program - Preview.mp3'
    # First complete Preface segment ends on the book’s insurance-policy aphorism.
    preface=next(c for c in chapters if c['title']=='Preface')
    units=[u for u in plan['units'] if u['chapter_id']==preface['id']]
    _,record=p.selected_record(units[0]);first=reports[preface['id']]['edits'][0]
    sample_end=.65+first['retained_frames']/44100+.15
    m.ff(['-i',ROOT/reports[preface['id']]['wav'],'-af',f'atrim=end={sample_end},asetpts=PTS-STARTPTS,apad=pad_dur=0.8','-c:a','libmp3lame','-b:a','192k',
          '-metadata','title=The Dionysus Program — Preview','-metadata','artist=Sean Devine',sample])
    with (D/'chapters.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=tracks[0].keys());writer.writeheader();writer.writerows(tracks)
    metadata={'title':'The Dionysus Program','subtitle':'Rites of Renewal','author':'Sean Devine',
      'narrator':'Sean Devine (digitally generated voice)','language':'en-US','edition':'Complete audiobook',
      'publisher':'Sean Devine','publication_year':p.read_json(ROOT/'source/edition.json')['year'],'copyright':p.read_json(ROOT/'source/edition.json')['copyright'],
      'digital_voice':True,'voice_provider':'ElevenLabs','voice_id':p.VOICE,'model_id':p.MODEL,
      'duration_seconds':duration,'chapters':tracks,'cover':'cover.jpg',
      'source_sha256':p.read_json(ROOT/'manifest.json')['source_hashes']['essay.md'],
      'description':'Knowledge changes faster than organizations can adapt. The Dionysus Program is a field manual for turning error into better structure without destroying trust. Sean Devine examines Run Time and Ritual Time, the social cost of renewal, and the problem of maintaining shared intent as artificial intelligence multiplies agency. Includes the mathematical thought experiment, practical appendices, and fifty-eight imagined letters to the editor.'}
    p.write_json(D/'metadata.json',metadata)
    shutil.copyfile(ROOT/'review/cover-prompt.txt',D/'Cover prompt.txt')
    chosen=[p.selected_record(u)[1] for u in plan['units']]
    if any(r['voice_id']!=p.VOICE for r in chosen):raise RuntimeError('Unexpected voice in selected takes')
    notes=['PRODUCTION AND QUALITY REPORT','',
      'The Dionysus Program: Rites of Renewal','Author: Sean Devine',
      'Voice: Sean Devine — newer saved clone (sean-devine-voice-90s.mp3)',
      'ElevenLabs voice ID: '+p.VOICE,'Speech model: '+p.MODEL,
      'Dedication: Esthergen pronounced Esther + Jen, as explicitly confirmed by the author.','',
      f'Complete runtime: {timestamp(duration)}',f'Indexed sections: {len(chapters)}',f'Selected narration segments: {len(chosen)}',
      'Source manuscript SHA-256: '+metadata['source_sha256'],'',
      'REVIEW METHOD',
      'Each segment was independently transcribed with Scribe v2 and compared with the prepared narration script.',
      'Detected differences were reviewed; disputed passages also received short independent Scribe v3 or v1 checks.',
      'Selected wording and pronunciation pickups replaced the affected takes. Original takes remain in the production workspace.',
      'Every final MP3 passed the measured level, peak, sample-rate, channel-count, bitrate and duration checks.',
      'The M4B passed chapter-count, duration and decoded audio-level checks. The ZIP passed CRC validation.',
      'This review combines automated recognition, editorial review of discrepancies, and signal/format tests; it is not a full human listening certification.','',
      'FINAL FORMATS',
      'M4B: AAC, 128 kbps target, mono, 44.1 kHz; embedded chapters and cover.',
      'Chapter MP3s: constant 192 kbps, mono, 44.1 kHz; embedded metadata and compact cover art.',
      'Lossless masters: 24-bit mono WAV, 44.1 kHz, retained in ../masters/wav/.',
      'Square cover: 3000 × 3000 JPEG. Adapted from the existing cover with built-in image_gen; final prompt is in Cover prompt.txt.','',
      f'M4B integrated loudness: {book_measurement["integrated_lufs"]:.2f} LUFS',
      f'M4B true peak: {book_measurement["true_peak_dbtp"]:.2f} dBTP',
      f'MP3 RMS range: {min(r["measurement"]["rms_dbfs"] for r in reports):.2f} to {max(r["measurement"]["rms_dbfs"] for r in reports):.2f} dBFS',
      f'Maximum MP3 true peak: {max(r["measurement"]["true_peak_dbtp"] for r in reports):.2f} dBTP','',
      'ADAPTATION',
      'The canonical manuscript is unchanged. Equations and tables were verbalized for listening, acronyms expanded where useful, and print-only navigation omitted.',
      'The complete book includes all 58 imagined letters and its sources. The fiction disclaimer remains in the letters introduction.',
      'The older clone was retained, labeled ARCHIVED (older clone), and filed in Archived Voices.']
    (D/'Production and quality report.txt').write_text('\n'.join(notes)+'\n')
    template=(TOOLS/'player_template.html').read_text()
    (D/'Listen.html').write_text(template.replace('__BOOK_METADATA__',json.dumps(metadata,ensure_ascii=False).replace('</','<\\/')))
    guide=['THE DIONYSUS PROGRAM — RITES OF RENEWAL','Written by Sean Devine',
      'Narrated in Sean Devine’s digitally generated voice using ElevenLabs.','',
      f'Complete audiobook · {timestamp(duration)} · {len(chapters)} indexed sections','',
      'LISTEN','Open “The Dionysus Program.m4b” in an audiobook player for bookmarks and chapter navigation.',
      'The MP3 archive contains one numbered file per section; keep filenames in order.',
      'The preview is a complete opening passage from the Preface.','',
      'COMPANION','Read the book, equations, source references, and interactive simulation at https://dionysusprogram.com/.',
      'The narration speaks equations and tables in words; navigation-only print elements are omitted.',
      'The 58 letters are imagined critiques, as disclosed in their introduction.','',
      'DISTRIBUTION','Use cover.jpg, metadata.json, chapters.csv, and the numbered MP3 files.',
      'Declare the narration as digital/AI voice wherever the platform asks. Spotify for Authors accepts digital voice narration.',
      'ACX requires its own authorization for synthetic narration; these files alone do not establish eligibility.',
      'Direct distribution can use the M4B and MP3 archive. No retailer upload has been performed.','',
      'SOURCES','https://support.spotify.com/us/authors/article/digital-voice-narration/',
      'https://support.spotify.com/us/authors/article/uploading-audiobooks/',
      'https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements','',
      'CONTENTS',*[f"{t['number']:02d}  {timestamp(t['start_seconds'])}  {t['title']}" for t in tracks]]
    (D/'Read me.txt').write_text('\n'.join(guide)+'\n')
    with zipfile.ZipFile(D/'The Dionysus Program - MP3 Chapters.zip','w',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
        for r in reports:z.write(ROOT/r['mp3'],'The Dionysus Program/'+Path(r['mp3']).name)
        for name in ['cover.jpg','metadata.json','chapters.csv','Read me.txt']:
            z.write(D/name,'The Dionysus Program/'+name)
    files=[f for f in D.iterdir() if f.is_file() and f.name not in ('cover-source.png','SHA256SUMS.txt')]
    (D/'SHA256SUMS.txt').write_text(''.join(p.digest(f.read_bytes())+'  '+f.name+'\n' for f in sorted(files)))
    with zipfile.ZipFile(D/'The Dionysus Program - MP3 Chapters.zip') as z:
        if z.testzip():raise RuntimeError('Archive integrity failure')
    p.write_json(ROOT/'review/package-validation.json',{'created':p.now(),'m4b_duration':duration,'m4b_chapters':len(info['chapters']),
      'mp3_files':len(reports),'archive_crc_passed':True,'source_frames':start,'m4b_measurement':book_measurement,'files':{f.name:f.stat().st_size for f in files}})
    print(json.dumps({'duration':duration,'chapters':len(chapters),'book':str(book)}))

if __name__=='__main__':main()
