#!/usr/bin/env python3
"""Independently transcribe a short disputed passage with Scribe v3."""
import argparse
import io
import uuid
import wave
import produce as p
ap=argparse.ArgumentParser();ap.add_argument('unit');ap.add_argument('phrase');ap.add_argument('--before',type=float,default=2);ap.add_argument('--after',type=float,default=5);a=ap.parse_args()
unit=next(u for u in p.read_json(p.ROOT/'render-plan.json')['units'] if u['id']==a.unit)
dest,record=p.selected_record(unit);alignment=record['timing']['alignment']
text=''.join(alignment['characters']);pos=text.lower().find(a.phrase.lower())
if pos<0:raise RuntimeError('Phrase absent from timing alignment')
start=max(0,alignment['character_start_times_seconds'][pos]-a.before)
end=min(record['stats']['duration'],alignment['character_end_times_seconds'][pos+len(a.phrase)-1]+a.after)
with wave.open(str(dest/record['audio_file']),'rb') as w:
    w.setpos(round(start*44100));audio=w.readframes(round((end-start)*44100))
buf=io.BytesIO()
with wave.open(buf,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes(audio)
boundary='Dionysus'+uuid.uuid4().hex;pieces=[]
for name,value in {'model_id':'scribe_v3','language_code':'en','diarize':'false','timestamps_granularity':'word','no_verbatim':'false'}.items():
    pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="verify.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()+buf.getvalue()+b'\r\n')
pieces.append(f'--{boundary}--\r\n'.encode())
result,_=p.request('/v1/speech-to-text',b''.join(pieces),'multipart/form-data; boundary='+boundary)
result.update(_source_sha256=record['audio_sha256'],_start=start,_end=end,_phrase=a.phrase)
target=p.ROOT/'review/clips'/(a.unit+'-'+p.digest((a.phrase+str(a.before)+str(a.after)).encode())[:8]+'.json')
p.write_json(target,result);print(result['text'])
