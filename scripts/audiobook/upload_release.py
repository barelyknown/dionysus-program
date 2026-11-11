#!/usr/bin/env python3
"""Host finished audio outside Git history. Draft first; publish only explicitly."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[2]

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def gh(*args, capture=False):
    return subprocess.check_output(['gh', *args], text=True) if capture else subprocess.run(['gh', *args], check=True)

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--work', type=Path, default=REPO/'editorial/audiobook')
    ap.add_argument('--tag', required=True)
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--prepare-only', action='store_true')
    a = ap.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', a.tag):
        raise RuntimeError('Use a simple release tag without slashes')
    if a.prepare_only and a.publish: raise RuntimeError('Choose prepare-only or publish')
    work = a.work.resolve()
    delivery = work/'delivery'
    review = json.loads((work/'review/editorial-review.json').read_text())
    if review['missing'] or review['unresolved']:
        raise RuntimeError('Resolve audio review before uploading')
    qc = json.loads((work/'review/package-validation.json').read_text())
    if not qc['archive_crc_passed']:
        raise RuntimeError('Package CRC validation failed')
    manifest = json.loads((work/'manifest.json').read_text())
    metadata = json.loads((delivery/'metadata.json').read_text())
    if len(metadata['chapters']) != qc['mp3_files']:
        raise RuntimeError('Chapter count mismatch')
    assets = work/'release-assets'/a.tag
    assets.mkdir(parents=True, exist_ok=True)
    mapping = {
        'The Dionysus Program.m4b': 'dionysus-program.m4b',
        'The Dionysus Program - MP3 Chapters.zip': 'dionysus-program-mp3.zip',
        'The Dionysus Program - Preview.mp3': 'preview.mp3',
        'cover.jpg': 'cover.jpg', 'metadata.json': 'metadata.json',
        'chapters.csv': 'chapters.csv', 'Read me.txt': 'read-me.txt',
    }
    expected = {}
    for line in (delivery/'SHA256SUMS.txt').read_text().splitlines():
        checksum, filename = line.split('  ', 1)
        expected[filename] = checksum
    paths = []
    for original, name in mapping.items():
        source = delivery/original
        if sha(source) != expected[original]:
            raise RuntimeError('Delivery checksum mismatch: '+original)
        target = assets/name
        if not target.exists():
            os.link(source, target)
        if sha(target) != expected[original]:
            raise RuntimeError('Existing release asset differs: '+name)
        paths.append(target)
    for chapter in metadata['chapters']:
        source = delivery/'mp3'/chapter['file']
        reports = list((work/'review/masters').glob(f"{chapter['number']-1:03d}-*.json"))
        if len(reports) != 1 or sha(source) != json.loads(reports[0].read_text())['sha256']:
            raise RuntimeError('Chapter checksum mismatch: '+chapter['file'])
        target = assets/source.name
        if not target.exists(): os.link(source, target)
        if sha(target) != sha(source): raise RuntimeError('Existing chapter differs')
        paths.append(target)
    sums = assets/'sha256sums.txt'
    sums.write_text(''.join(sha(p)+'  '+p.name+'\n' for p in sorted(paths)))
    paths.append(sums)
    if a.prepare_only:
        print(json.dumps({'directory':str(assets),'files':len(paths),'bytes':sum(p.stat().st_size for p in paths),'network_used':False}))
        return
    repo = gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner', capture=True).strip()
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/releases', capture=True))
    releases = [release for page in pages for release in page]
    release = next((r for r in releases if r['tag_name'] == a.tag), None)
    if release and not release['draft']:
        raise RuntimeError('Release is already published; use a new edition tag')
    notes = assets/'release-notes.md'
    notes.write_text('The complete audiobook of **The Dionysus Program: Rites of Renewal**, written by Sean Devine and narrated in his digitally generated voice using ElevenLabs.\n\n'
                     '92 sections · 9 hours 11 minutes. Download the M4B for an audiobook app, or the MP3 ZIP for individual chapter files. Numbered MP3s support the website player.\n\n'
                     'Audio source revision: `'+manifest['source_commit']+'`. The book includes the appendices, 58 imagined letters to the editor, and sources.\n')
    if not release:
        gh('release', 'create', a.tag, '--draft', '--target', manifest['source_commit'],
           '--title', 'The Dionysus Program — Audiobook (November 2026)', '--notes-file', str(notes))
    # Draft releases are found by ID; GitHub's public tag endpoint omits them.
    pages = json.loads(gh('api', '--paginate', '--slurp', f'repos/{repo}/releases', capture=True))
    release = next(r for page in pages for r in page if r['tag_name'] == a.tag)
    release_id = release['id']
    # Only resume assets whose remote digest matches; never replace a published file.
    remote = {p['name']:p for p in release['assets']}
    pending = []
    for p in paths:
        if p.name in remote:
            if remote[p.name].get('digest') != 'sha256:'+sha(p):
                raise RuntimeError('Remote digest mismatch: '+p.name)
        else: pending.append(str(p))
    if pending: gh('release', 'upload', a.tag, *pending)
    release = json.loads(gh('api', f'repos/{repo}/releases/{release_id}', capture=True))
    remote = {p['name']:p for p in release['assets']}
    for p in paths:
        if p.name not in remote or remote[p.name].get('digest') != 'sha256:'+sha(p):
            raise RuntimeError('Uploaded asset verification failed: '+p.name)
    if a.publish: gh('release', 'edit', a.tag, '--draft=false', '--latest=false')
    print(json.dumps({'url':release['html_url'], 'assets':len(paths), 'published':a.publish}))

if __name__ == '__main__': main()
