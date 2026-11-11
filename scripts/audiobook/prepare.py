#!/usr/bin/env python3
"""Create an auditable listening script from the pinned Pandoc AST.

No audio is generated. No canonical manuscript or published artifact is edited.
Unknown semantic node types or math expressions stop the build.
"""
import hashlib
import json
import re
import subprocess
import unicodedata
from pathlib import Path

from settings import REPO as ROOT, WORK as OUT
import os
import shutil
PANDOC = Path(os.environ.get('PANDOC_BIN', ROOT / '.tools/pandoc-3.6.4/bin/pandoc'))
edits = []

MATH = {
    't': 't', 't+1': 't plus one', '0': 'zero', '1': 'one',
    'S': 'S', 'R': 'R', 'L': 'L', 'C': 'C', 'G': 'G', 'D': 'D',
    r'\mu': 'mu', r'\beta': 'beta', r'\rho': 'rho', r'\tau': 'tau',
    r'\alpha': 'alpha', r'\gamma': 'gamma', r'\delta': 'delta',
    r'\kappa': 'kappa', r'\lambda': 'lambda', r'\epsilon': 'epsilon',
    r'\Omega': 'omega', r'\Phi': 'phi', r'\bar{S}': 'S bar',
    'C^*': 'C star', 'R_0': 'R zero', r'\Delta S_t': 'delta S at time t',
    r'\mu^{\text{env}}': 'environmental mu',
    r'\mu^{\text{choice}}': 'chosen mu',
    r'5\times': 'five times', r'\approx 0.02': 'approximately zero point zero two',
    r'\approx 0.05': 'approximately zero point zero five',
    r'\approx 0.10': 'approximately zero point one zero',
    r'\approx 0.20': 'approximately zero point two zero',
    r'\approx 0.50': 'approximately zero point five zero',
    r'\approx 1.5': 'approximately one point five',
    r'\beta_t \ge 0.1': 'beta at time t is greater than or equal to zero point one',
    r'L \cdot C': 'L times C',
    r'1 + \lambda \beta': 'one plus lambda times beta',
    r'\alpha \beta G': 'alpha times beta times G',
    r'\alpha \cdot \beta \cdot G': 'alpha times beta times G',
    r'\gamma D': 'gamma times D', r'\gamma \cdot D': 'gamma times D',
    r'\alpha \beta G > \gamma D': 'alpha times beta times G is greater than gamma times D',
    r'\min(L \cdot C, R)': 'the minimum of L times C and R',
    r'\kappa \cdot \text{Theater} / \beta': 'kappa times theater, divided by beta',
    r'\text{Overflow}^2 \cdot \tau': 'overflow squared, times tau',
    r'\text{Overflow}^2 \times \tau': 'overflow squared, times tau',
    r'(1-\delta)^t': 'one minus delta, raised to the power t',
    r'1-\rho': 'one minus rho',
    r'= \max(0, L \cdot C - R)': 'equals the greater of zero and L times C minus R',
    r'= \max(0, \mu - \Omega)': 'equals the greater of zero and mu minus omega',
    r'\mu_t = \mu^{\text{env}}_t + \mu^{\text{choice}}_t':
        'At time t, total melt equals environmental melt plus chosen melt.',
    r'\Omega_t = \min(L_t \cdot C_t, \quad R_t)':
        'At time t, metabolic capacity equals the smaller of ritual capacity times stewardship integrity, and trust.',
    r'\text{Theater}_t = \max(0, \quad (L_t \cdot C_t) - R_t)':
        'At time t, the theater gap equals the greater of zero and ritual capacity times stewardship integrity minus trust.',
    r'\text{Overflow}_t = \max(0, \quad \mu_t - \Omega_t)':
        'At time t, overflow equals the greater of zero and total melt minus metabolic capacity.',
    r'G_t = \min(\mu_t, \Omega_t) \cdot (1 + \lambda \cdot \beta_t)':
        'At time t, growth equals the smaller of total melt and metabolic capacity, multiplied by the quantity one plus lambda times beauty.',
    r'D_t = \mathrm{Overflow}_t^2 \cdot \tau_t + (\kappa \cdot \mathrm{Theater}_t) / \beta_t':
        'At time t, decay equals overflow squared times the toxicity penalty, plus kappa times the theater gap divided by beauty.',
    r'\Delta S_t = G_t - D_t': 'The change in explanatory reach at time t equals growth minus decay.',
    r'S_{t+1} = S_t + \Delta S_t': 'Explanatory reach in the next cycle equals current explanatory reach plus its change in this cycle.',
    r'R_{t+1} = \max(0, \quad R_t + \alpha \cdot \beta_t \cdot G_t - \gamma \cdot D_t)':
        'Trust in the next cycle equals the greater of zero and the following quantity: current trust, plus alpha times beauty times growth, minus gamma times decay.',
    r'C_{t+1} = 1.0': 'Stewardship integrity in the next cycle equals one',
    r'C_{t+1} = C_t (1-\delta)': 'Stewardship integrity in the next cycle equals current integrity multiplied by one minus delta',
    r'\mathbb{E}[C_{t+1} \mid C_t] = \rho \cdot 1 + (1-\rho) \cdot C_t (1-\delta)':
        'The expected integrity in the next cycle, given current integrity, equals rho times one, plus one minus rho, multiplied by current integrity, multiplied by one minus delta.',
    r'C^* = \rho / (1 - (1-\rho)(1-\delta))':
        'Steady-state expected integrity, C star, equals rho divided by the quantity: one minus the product of one minus rho and one minus delta.',
    r'\bar{S}_{t+1} = \bar{S}_t + \mu^{\text{env}}_t':
        'The competitive threshold in the next cycle equals the current threshold plus environmental melt in this cycle.',
    r'\bar{S}_t = S_0 + \Sigma_{i=0}^{t-1} \mu^{\text{env}}_i':
        'The competitive threshold at time t equals initial explanatory reach plus the sum of environmental melt over cycles zero through t minus one.',
    r'R_t \leq 0': 'Trust at time t is less than or equal to zero',
    r'R_t > 0': 'Trust at time t is greater than zero',
    r'S_t < \bar{S}_t': 'Explanatory reach at time t is less than the competitive threshold',
    r'S_t \geq \bar{S}_t': 'Explanatory reach at time t is greater than or equal to the competitive threshold',
    r'A_t \cdot V^a_t > Coh_t \Rightarrow \text{marginal agency turns negative}':
        'If deployed agency times agency variety exceeds coherence capacity, marginal agency turns negative.',
    r'V^r_t \geq V^a_t \quad \text{for action that must remain within shared essential variables}':
        'Regulatory variety must be greater than or equal to agency variety for action that must remain within shared essential variables.',
    r'\Phi_t = \mathrm{max}(0, \Delta S_t) / \mathrm{max}(\epsilon, R_t - R_{t+1})':
        'Epimetabolic rate at time t equals the greater of zero and the change in explanatory reach, divided by the greater of epsilon and current trust minus next-cycle trust.',
}
for symbol in ['S','R','L','C','G','D','A','F','H','I','Coh',r'\mu',r'\beta',r'\tau',r'\Omega',r'\text{Theater}',r'\text{Overflow}']:
    base = {r'\text{Theater}':'theater',r'\text{Overflow}':'overflow','Coh':'coherence'}.get(symbol,MATH.get(symbol,symbol))
    MATH[symbol+'_t'] = base+' at time t'
MATH.update({r'V^a_t':'agency variety at time t',r'V^r_t':'regulatory variety at time t',
             r'\mu^{\text{env}}_t':'environmental mu at time t',
             r'\mu^{\text{choice}}_t':'chosen mu at time t'})

def clean(text):
    text = text.replace('→', ', then ').replace('≥', ' greater than or equal to ')
    return re.sub(r'[ \t]+',' ',text).strip()

def spoken_heading(text):
    numbers={'I':'one','II':'two','III':'three','IV':'four','V':'five','VI':'six','VII':'seven','VIII':'eight','IX':'nine','X':'ten'}
    text=re.sub(r'\b(Act|Interlude) (I{1,3})\b',lambda m:m[1]+' '+numbers[m[2]],text)
    text=re.sub(r'^(I|II|III|IV|V|VI|VII|VIII|IX|X)\. ',lambda m:numbers[m[1]].capitalize()+'. ',text)
    return text.rstrip('.')+'.'

def inline(nodes):
    out=[]
    for n in nodes:
        typ, c = n['t'], n.get('c')
        if typ=='Str': out.append(c)
        elif typ in ('Space','SoftBreak','LineBreak'): out.append(' ')
        elif typ in ('Emph','Strong','Strikeout','SmallCaps','Superscript','Subscript'): out.append(inline(c))
        elif typ=='Span': out.append(inline(c[1]))
        elif typ=='Cite': out.append(inline(c[1]))
        elif typ=='Quoted': out.append('“'+inline(c[1])+'”')
        elif typ=='Code': out.append(c[1])
        elif typ=='Link':
            label=inline(c[1]); target=c[2][0]
            if label in ('See simulation','Historical cases','Free','Amazon'):
                edits.append({'kind':'navigation_link','label':label,'target':target}); continue
            out.append(label)
        elif typ=='Math':
            if c[1] not in MATH: raise ValueError('Unmapped math: '+c[1])
            spoken=MATH[c[1]]
            edits.append({'kind':'math','original':c[1],'spoken':spoken})
            out.append(spoken)
        elif typ=='RawInline':
            if c[0] not in ('html','tex','latex'): raise ValueError('Unknown raw inline '+str(c))
            if re.fullmatch(r'<[^>]+>',c[1]): continue
            raise ValueError('Semantic raw inline requires review '+str(c))
        else: raise ValueError('Unhandled inline '+typ)
    return clean(''.join(out))

def render(b):
    typ,c=b['t'],b.get('c')
    if typ in ('Para','Plain'): return [inline(c)]
    if typ=='Header': return [spoken_heading(inline(c[2]))]
    if typ=='Div': return render_many(c[1])
    if typ=='BlockQuote': return render_many(c)
    if typ=='BulletList': return [join_fragments(render_many(item)) for item in c]
    if typ=='OrderedList':
        return [str(i)+'. '+join_fragments(render_many(item)) for i,item in enumerate(c[1],c[0][0])]
    if typ=='HorizontalRule': return []
    if typ=='Table':
        headers=[(' '.join(render_many(cell[4]))) for cell in c[3][1][0][1]]
        lines=['The table has four cases.']
        for body in c[4]:
            for row in body[3]:
                cells=[' '.join(render_many(cell[4])) for cell in row[1]]
                for i in range(1,len(cells)):
                    lines.append(cells[0]+' with '+headers[i].lower()+': '+cells[i]+'.')
        edits.append({'kind':'table_to_cases','spoken':lines})
        return lines
    if typ=='RawBlock':
        fmt,text=c
        if fmt=='html' and 'To host a playful version' in text:
            return ['To host a playful version of this ritual, use It’s So Dumb, with a step-by-step guide, host scripts, prompts, and a session timer. The link is in the companion text.']
        if fmt=='html' and 'Explore the interactive simulation' in text:
            return ['Explore the interactive simulation at dionysus program dot com. The companion text includes the direct link.']
        if fmt in ('latex','tex') and 'For an interactive simulation' in text:
            edits.append({'kind':'duplicate_print_simulation_link','original':text});return []
        if fmt=='html' and re.fullmatch(r'\s*(<[^>]+>\s*)+',text):return []
        if fmt in ('latex','tex') and any(x in text for x in ['\\newpage','\\iffalse','\\fi','\\providecommand','\\begin{samepage}','\\end{samepage}','\\begin{quote}','\\end{quote}']):return []
        raise ValueError('Unhandled semantic raw block '+str(c))
    else: raise ValueError('Unhandled block '+typ)

def render_many(blocks):
    return [p for b in blocks for p in render(b) if p.strip() and p.strip() not in ('—','·')]

def join_fragments(parts):
    # Paragraph boundaries in a list must remain audible after flattening.
    return ' '.join(p if re.search(r'[.!?:;][”\"\u2019\u0027)]?$',p) else p+'.' for p in parts)

def slug(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]+','-',s).strip('-')

def snapshot():
    if (OUT/'raw').exists():
        raise RuntimeError('This edition already has audio. Use a fresh DIONYSUS_AUDIOBOOK_DIR for a new edition.')
    version=subprocess.check_output([str(PANDOC),'--version'],text=True).splitlines()[0]
    if version!='pandoc 3.6.4': raise RuntimeError('Use pinned Pandoc 3.6.4')
    for folder in ['source','chapters','review']: (OUT/folder).mkdir(parents=True,exist_ok=True)
    source=OUT/'source'
    (source/'edition.json').write_text(json.dumps({'year':2026,'copyright':'© 2025–2026 Sean Devine. All rights reserved.'},ensure_ascii=False,indent=2)+'\n')
    for name in ['essay.md','appendix-sources.md','people.csv']:
        shutil.copyfile(ROOT/name,source/name)
    subprocess.run(['node',str(ROOT/'build-letters-to-editor.js'),str(source)],check=True)
    for name,stem in [('essay.md','essay'),('letters-to-editor-appendix.md','letters'),('appendix-sources.md','sources')]:
        subprocess.run([str(PANDOC),str(source/name),'--from=markdown','--to=json','--output='+str(source/(stem+'.ast.json'))],check=True)

def main():
    snapshot()
    chapters=[]
    for filename,kind in [('essay.ast.json','main'),('letters.ast.json','letters'),('sources.ast.json','sources')]:
        ast=json.loads((OUT/'source'/filename).read_text())
        current=None
        parent_title=''
        for index,b in enumerate(ast['blocks']):
            if b['t']=='Header' and b['c'][0]==2: parent_title=inline(b['c'][2])
            is_chapter=b['t']=='Header' and (b['c'][0]==2 or (kind=='letters' and b['c'][0]==4) or (kind=='main' and parent_title=='Appendix C: Archetypes in History' and b['c'][0]==3))
            if is_chapter:
                title=inline(b['c'][2])
                current={'id':len(chapters)+1,'title':title,'kind':kind,'source_ast':filename,'source_blocks':[],'paragraphs':[]}
                chapters.append(current)
                current['paragraphs'].append(spoken_heading(title))
            elif b['t']=='Header' and kind=='main' and b['c'][0]==1:
                # The standalone cover duplicates the separate opening credits.
                current=None; continue
            else:
                paras=render(b)
                if current is None:
                    if paras: edits.append({'kind':'cover_or_dedication','source':filename,'block':index,'text':paras})
                    continue
                if kind=='letters' and any(p.startswith('Letters index:') for p in paras):
                    edits.append({'kind':'omit_print_letters_index','block':index});continue
                if kind=='letters' and b['t']=='Para' and any(n['t']=='Link' for n in b['c']) and len(b['c'])>100:
                    edits.append({'kind':'omit_print_letters_navigation','block':index});continue
                current['paragraphs'].extend(p for p in paras if p and p.strip(' ·—'))
            if current: current['source_blocks'].append(index)
    # Credits and dedication are explicit rather than interleaved with print cover material.
    opening={'id':0,'title':'Opening credits and dedication','kind':'credits','source_blocks':[],
             'paragraphs':['The Dionysus Program. Rites of Renewal.','Written by Sean Devine.','Read in the author’s digitally generated voice.','To Esthergen.']}
    chapters.insert(0,opening)
    closing={'id':len(chapters),'title':'Closing credits','kind':'credits','source_blocks':[],
             'paragraphs':['This concludes The Dionysus Program. Rites of Renewal.','Written by Sean Devine. Read in the author’s digitally generated voice.','Copyright twenty twenty-five through twenty twenty-six.','The complete text, sources, and interactive simulation are available at dionysus program dot com.']}
    chapters.append(closing)
    previous=json.loads((OUT/'manifest.json').read_text()).get('chapters',[]) if (OUT/'manifest.json').exists() else []
    manifest=[]
    for ch in chapters:
        text='\n\n'.join(ch.pop('paragraphs'))+'\n'
        old='Survival requires Trust at time t is greater than zero and Explanatory reach at time t is greater than or equal to the competitive threshold.'
        new='Survival requires trust at time t to be greater than zero and explanatory reach at time t to be greater than or equal to the competitive threshold.'
        if old in text:
            text=text.replace(old,new)
            edits.append({'kind':'spoken_grammar','original_rendering':old,'spoken':new,
                          'reason':'Preserve mathematical inequalities as grammatical objects of requires.'})
        name=f"{ch['id']:03d}-{slug(ch['title'])}.txt"
        (OUT/'chapters'/name).write_text(text)
        words=len(re.findall(r"\b[\w’'-]+\b",text))
        manifest.append({**ch,'file':'chapters/'+name,'sha256':hashlib.sha256(text.encode()).hexdigest(),'characters':len(text),'words':words,'minutes_at_155_wpm':round(words/155,1),'status':'script_draft_pending_audio_review'})
    inputs=[ROOT/'essay.md',ROOT/'people.csv',ROOT/'appendix-sources.md',ROOT/'build-letters-to-editor.js']
    inputs.extend(sorted((ROOT/'letters_to_editor').glob('*.txt')))
    sources={str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in inputs}
    result={'status':'script_draft_not_generated','source_hashes':sources,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'chapters':manifest,'total_characters':sum(x['characters'] for x in manifest),'total_words':sum(x['words'] for x in manifest)}
    (OUT/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (OUT/'review'/'adaptations.json').write_text(json.dumps(edits,ensure_ascii=False,indent=2)+'\n')
    (OUT/'narration-draft.txt').write_text('\n\n'.join((OUT/x['file']).read_text() for x in manifest))
    current_files={x['file'] for x in manifest}
    for old in previous:
        if old['file'] not in current_files: (OUT/old['file']).unlink(missing_ok=True)
    print(json.dumps({k:v for k,v in result.items() if k in ('status','total_characters','total_words')}))
    print('Chapters:',len(manifest),'Estimated hours at 155 words/minute:',round(result['total_words']/155/60,2))

if __name__=='__main__': main()
