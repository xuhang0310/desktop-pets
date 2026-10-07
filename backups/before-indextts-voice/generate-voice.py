"""Build the bundled voice pack. Requires edge-tts only at authoring time."""
import asyncio
import argparse
import json
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--pack', choices=['voice-dafeiyu', 'voice-human'], default='voice-dafeiyu')
parser.add_argument('--line', action='append', help='Generate only the specified line ID; repeat to select several.')
parser.add_argument('--force', action='store_true', help='Regenerate existing selected clips after changing dialogue.')
args = parser.parse_args()
PACK = ROOT / 'assets' / args.pack
manifest = json.loads((PACK / 'manifest.json').read_text(encoding='utf-8'))
if args.line and set(args.line) - {line['id'] for line in manifest['lines']}:
    parser.error('Unknown voice line ID')

async def main():
    semaphore = asyncio.Semaphore(3)
    async def generate(line):
        output = PACK / (line['id'] + '.mp3')
        if not args.force and output.exists() and output.stat().st_size > 1000:
            return
        async with semaphore:
            for attempt in range(3):
                try:
                    voice = edge_tts.Communicate(line['text'], manifest['voice'],
                        rate=manifest['rate'], pitch=manifest['pitch'])
                    temporary = output.with_suffix('.tmp.mp3')
                    await voice.save(str(temporary))
                    temporary.replace(output)
                    print('saved', output.name, flush=True)
                    return
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1)
    await asyncio.gather(*(generate(line) for line in manifest['lines'] if not args.line or line['id'] in args.line))

asyncio.run(main())
