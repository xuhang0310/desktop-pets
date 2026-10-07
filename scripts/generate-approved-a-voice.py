"""Author the user-selected IndexTTS-2 A pack; the companion only plays local MP3s."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / 'voice-lab/dafeiyu-indextts2/calibration'
PACK = ROOT / 'assets/voice-dafeiyu-indextts2-a'
MASTERS = LAB / 'pack-a-masters'
REPORT = LAB / 'pack-a-generation-report.json'
REFERENCE = LAB / 'reference-voice-only.wav'
INSTALL = Path(r'D:\workspace\index-tts2')
FFMPEG = Path(r'C:\ffmpeg\bin\ffmpeg.exe')
SETTINGS = {
    'model': 'IndexTTS-2', 'checkpoint': 'checkpoints_2', 'selected_version': 'A',
    'reference_interval_seconds': [1.74, 4.98], 'fp16': True,
    'use_qwen_emo': False, 'use_cuda_kernel': False, 'use_deepspeed': False,
    'use_random': False, 'max_text_tokens_per_segment': 120,
    'seed_before_model_load': 20261007, 'filter': 'loudnorm=I=-18:TP=-2:LRA=7',
    'sample_rate': 22050, 'pitch_tempo_eq_changes': False,
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--line', action='append', help='Select line IDs; repeat for several.')
    parser.add_argument('--force', action='store_true', help='Regenerate selected clips, including approved ones.')
    args = parser.parse_args()
    manifest = json.loads((PACK / 'manifest.json').read_text(encoding='utf-8'))
    lines = manifest['lines']
    if args.line and set(args.line) - {line['id'] for line in lines}:
        parser.error('Unknown line ID')
    reference_hash = sha256(REFERENCE)
    if reference_hash != manifest['reference_sha256']:
        raise ValueError('Reference changed; update the manifest only after selecting the intended voice.')
    MASTERS.mkdir(parents=True, exist_ok=True)
    report = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.exists() else {}
    report.update(settings=SETTINGS, reference_sha256=reference_hash)
    samples = report.setdefault('samples', {})
    import numpy as np
    import soundfile as sf

    def validate(data, rate):
        duration = len(data) / rate
        rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
        clipped = float(np.mean(np.abs(data) >= .999))
        if not (np.isfinite(data).all() and .5 < duration < 15 and rms > .002 and clipped < .001):
            raise ValueError(f'Invalid audio: duration={duration}, rms={rms}, clipping={clipped}')
        return {'seconds': round(duration, 3), 'sample_rate': rate,
                'peak': float(np.max(np.abs(data))), 'rms': rms, 'clipped_fraction': clipped}

    def record(line, fingerprint, wav, mp3, source, elapsed=None):
        wav_stats = validate(*sf.read(wav))
        decoded = subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-i', str(mp3),
                                  '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', '22050', 'pipe:1'],
                                 check=True, capture_output=True)
        mp3_stats = validate(np.frombuffer(decoded.stdout, dtype='<f4'), 22050)
        if abs(wav_stats['seconds'] - mp3_stats['seconds']) > .08:
            raise ValueError('Encoded duration differs from WAV')
        samples[line['id']] = {'text': line['text'], 'fingerprint': fingerprint, 'source': source,
                               'wav': wav_stats, 'mp3': mp3_stats, 'synthesis_seconds': elapsed,
                               'wav_sha256': sha256(wav), 'mp3_sha256': sha256(mp3)}
        write_json(REPORT, report)
        print('SAMPLE_READY ' + json.dumps({'id': line['id'], 'source': source,
                                          'seconds': mp3_stats['seconds'], 'completed': len(samples),
                                          'total': len(lines)}, ensure_ascii=False), flush=True)

    # Reuse the exact bytes the user auditioned, provided settings and text still match.
    approved = {}
    batch = LAB / 'approved-a-batch-01'
    batch_report = json.loads((batch / 'generation-report.json').read_text(encoding='utf-8'))
    if batch_report['settings'] == dict(SETTINGS, reference_sha256=reference_hash):
        for line_id, entry in batch_report['samples'].items():
            wav, mp3 = batch / (line_id + '.wav'), batch / (line_id + '.mp3')
            if sha256(wav) == entry['wav_sha256'] and sha256(mp3) == entry['mp3_sha256']:
                approved[line_id] = (entry['text'], wav, mp3, 'approved-a-batch-01')
        quote = next(line for line in json.loads((batch / 'review-manifest.json').read_text(encoding='utf-8'))['lines']
                     if line['id'] == 'poke-3')
        wav, mp3 = LAB / 'A-recloned.wav', LAB / 'A-recloned.mp3'
        if sha256(mp3) == quote['sha256']:
            approved['poke-3'] = (quote['text'], wav, mp3, 'user-selected-A-original-quote')

    pending = []
    for line in lines:
        if args.line and line['id'] not in args.line:
            continue
        fingerprint = hashlib.sha256(json.dumps({'text': line['text'], 'reference': reference_hash,
                                                  'settings': SETTINGS}, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        wav, mp3 = MASTERS / (line['id'] + '.wav'), PACK / (line['id'] + '.mp3')
        previous = samples.get(line['id'], {})
        if (not args.force and previous.get('fingerprint') == fingerprint and wav.is_file() and mp3.is_file()
                and previous.get('wav_sha256') == sha256(wav) and previous.get('mp3_sha256') == sha256(mp3)):
            print('UNCHANGED ' + line['id'], flush=True)
            continue
        existing = approved.get(line['id'])
        if not args.force and existing and existing[0] == line['text']:
            shutil.copy2(existing[1], wav)
            shutil.copy2(existing[2], mp3)
            record(line, fingerprint, wav, mp3, existing[3])
        else:
            pending.append((line, fingerprint, wav, mp3))
    if not pending:
        print('ALL_SELECTED_A_SAMPLES_READY', flush=True)
        return

    os.environ.update(HF_HOME=str(INSTALL / '.hf-cache'), HF_HUB_OFFLINE='1',
                      TRANSFORMERS_OFFLINE='1', USE_MODELSCOPE='false', OMP_NUM_THREADS='8')
    sys.path.insert(0, str(INSTALL))
    os.chdir(INSTALL)
    import torch
    from indextts.infer_v2 import IndexTTS2
    torch.set_num_threads(8)
    random.seed(SETTINGS['seed_before_model_load'])
    np.random.seed(SETTINGS['seed_before_model_load'])
    torch.manual_seed(SETTINGS['seed_before_model_load'])
    print(f'LOADING_A_MODEL pending={len(pending)}', flush=True)
    tts = IndexTTS2(cfg_path=str(INSTALL / 'checkpoints_2/config.yaml'),
                    model_dir=str(INSTALL / 'checkpoints_2'), use_fp16=True,
                    use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
    random_state, numpy_state = random.getstate(), np.random.get_state()
    torch_state, cuda_states = torch.get_rng_state(), torch.cuda.get_rng_state_all()
    for line, fingerprint, wav, mp3 in pending:
        random.setstate(random_state)
        np.random.set_state(numpy_state)
        torch.set_rng_state(torch_state)
        torch.cuda.set_rng_state_all(cuda_states)
        raw = MASTERS / (line['id'] + '-raw.wav')
        temporary_wav, temporary_mp3 = wav.with_suffix('.tmp.wav'), mp3.with_suffix('.tmp.mp3')
        begin = time.perf_counter()
        tts.infer(spk_audio_prompt=str(REFERENCE), text=line['text'], output_path=str(raw),
                  use_random=False, max_text_tokens_per_segment=120, verbose=False)
        elapsed = round(time.perf_counter() - begin, 3)
        validate(*sf.read(raw))
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                        '-map_metadata', '-1', '-ac', '1', '-ar', '22050', '-af', SETTINGS['filter'],
                        '-codec:a', 'pcm_s16le', str(temporary_wav)], check=True)
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(temporary_wav),
                        '-map_metadata', '-1', '-ac', '1', '-ar', '22050', '-codec:a', 'libmp3lame',
                        '-q:a', '2', str(temporary_mp3)], check=True)
        record(line, fingerprint, temporary_wav, temporary_mp3, 'generated-with-approved-A-settings', elapsed)
        temporary_wav.replace(wav)
        temporary_mp3.replace(mp3)
    print('ALL_SELECTED_A_SAMPLES_READY', flush=True)


if __name__ == '__main__':
    main()
