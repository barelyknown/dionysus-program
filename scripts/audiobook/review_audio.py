#!/usr/bin/env python3
"""Refresh independent transcript checks; retain explicit editorial decisions."""
import json
import produce as p

ORTHOGRAPHIC={
 ('devine','divine'):'The family name is pronounced like “divine”.',
 ('asabiyyah','asabiyya'):'Equivalent transliteration of the same Arabic term.',
 ('chillul','chilul'):'Equivalent transliteration of the same Hebrew term.',
 ('addition','edition'):'Homophones in this context; spelling cannot be resolved acoustically.',
 ('theresa','teresa'):'Equivalent spelling of the same spoken name.',
 ('rite','right'):'Homophones; the narrated sound preserves the text.',
 ('rites','rights'):'Homophones; the narrated sound preserves the text.',
 ('foreword','forward'):'Homophones in this title; the source title remains Foreword.',
 ('jorgenson','jorgensen'):'Equivalent English pronunciation of the surname; source spelling remains Jorgenson.',
 ('devines','divines'):'Possessive form of Devine has the same pronunciation as Divine.',
 ('acknowledgment','acknowledgement'):'Equivalent English spellings.',
 ('chillul','hilul'):'Alternative transcription of the Hebrew guttural consonant.',
 ('cherem','herem'):'Alternative transliteration of the same Hebrew word.',
 ('jobss','jobs'):'The possessive of Jobs can be pronounced without an extra syllable; ASR omits the possessive spelling.',
 ('mausss','mauss'):'The possessive of a name ending in s can be pronounced without an extra syllable; ASR omits the possessive spelling.',
 ('heraclituss','heraclitus'):'The classical-name possessive can be pronounced without an extra syllable; ASR omits the possessive spelling.',
 ('michelss','michels'):'The possessive of Michels can be pronounced without an extra syllable; ASR omits the possessive spelling.',
 ('blocs','blocks'):'Homophones; the written source refers to voting blocs.',
 ('worshipped','worshiped'):'Equivalent spelling of the same spoken word.',
 ('worshipping','worshiping'):'Equivalent spelling of the same spoken word.',
 ('toward','towards'):'Equivalent preposition; the following word software also makes the final s boundary ambiguous.',
 ('dissents','descents'):'Homophones; the source refers to minor dissents.',
 ('icahn','icon'):'Carl Icahn’s surname has the English pronunciation “icon”.',
 ('you are','youre'):'Equivalent spoken contraction; no change in meaning.',
 ('vary','very'):'Homophones in the selected American English voice.',
 ('howie makem','how we make em'):'The fictional name is pronounced like the phrase; this is a transcript word-boundary difference.',
 ('wurth','wirt'):'German Würth ends in a t sound; English ASR substitutes a phonetic spelling.',
 ('wurths','wirts'):'Possessive of German Würth; the source th is a t sound. Scribe v3 independently recognizes the matching Wurtz’s sound.',
 ('glavkokratiia','glavkakratie'):'Scribe v3 identifies glavkokratiya in the isolated passage; differences reflect transliteration.',
 ('effects','affects'):'Unstressed initial vowels overlap in ordinary speech; the source’s verb effects is preserved in context.',
 ('ren','wren'):'Homophones; the text uses Ren, the Confucian term.',
 ('right','rite'):'Homophones; the source says right.',
 ('irruption','eruption'):'Homophones in ordinary English; the source says irruption.',
 ('zastoy','zastoi'):'Equivalent transliterations of the Russian word.',
 ('modelled','modeled'):'Equivalent spelling of the same spoken word.',
 ('want to','wanna'):'Ordinary spoken contraction in quoted conversational prose.',
 ('ohsumi','osumi'):'Equivalent transliteration of the Japanese surname.',
 ('invariants','invariance'):'The noun forms have the same pronunciation in connected speech.',
 ('jay','j'):'The name Jay and the letter J have the same pronunciation.',
 ('performans','performance'):'The Latin term is rendered with the explicit pronunciation /pərˈfɔːrmæns/; ASR chooses the familiar English spelling for the matching sound.',
}
plan=p.read_json(p.ROOT/'render-plan.json')
decisions_path=p.ROOT/'review/editorial-decisions.json'
decisions=p.read_json(decisions_path) if decisions_path.exists() else {}
reports=[];missing=[];unresolved=[]
for u in plan['units']:
    try:r=p.check_unit(u)
    except FileNotFoundError:missing.append(u['id']);continue
    except RuntimeError as exc:
        if str(exc)=='Selected take has stale script':missing.append(u['id']);continue
        raise
    _, selected = p.selected_record(u)
    for i,c in enumerate(r['changes']):
        token=u['id']+':'+p.digest(json.dumps(c,sort_keys=True).encode())[:12]
        c['review_key']=token
        reason=ORTHOGRAPHIC.get((c['expected'],c['heard']))
        if c['expected'].replace(' ','')==c['heard'].replace(' ',''):
            reason='Only word spacing differs in the independent transcript.'
        if reason:c.update(review='accepted_spelling_equivalence',reason=reason)
        elif token in decisions and decisions[token].get('audio_sha256') == selected['audio_sha256']:
            c.update(decisions[token])
        else:c['review']='unresolved';unresolved.append({'id':u['id'],**c})
    if r['long_gaps']:unresolved.append({'id':u['id'],'gap_review':r['long_gaps']})
    if r['clipped_samples']:unresolved.append({'id':u['id'],'clipped_samples':r['clipped_samples']})
    if not 100<=r['words_per_minute']<=205:unresolved.append({'id':u['id'],'pace_review':r['words_per_minute']})
    r['reviewed_status']='accepted' if not any(x['id']==u['id'] for x in unresolved) else 'requires_review'
    reports.append(r)
p.write_json(p.ROOT/'review/editorial-review.json',{'checked':len(reports),'missing':missing,'unresolved':unresolved,'reports':reports})
print(json.dumps({'checked':len(reports),'missing':len(missing),'unresolved':len(unresolved)},ensure_ascii=False))
for x in unresolved:print(json.dumps(x,ensure_ascii=False))
