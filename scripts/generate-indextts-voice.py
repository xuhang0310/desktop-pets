"""Author Jingjing's local samples with IndexTTS-2; never used by the app at runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / 'voice-lab' / 'dafeiyu-indextts2'
PACK = ROOT / 'assets' / 'voice-dafeiyu-indextts2'
MASTERS = LAB / 'pack-masters'
REPORT = LAB / 'pack-generation-report.json'
INSTALL = Path(r'D:\workspace\index-tts2')
FFMPEG = Path(r'C:\ffmpeg\bin\ffmpeg.exe')
REFERENCE = LAB / 'reference-opening.wav'
SETTINGS = {
    'model': 'IndexTTS-2', 'checkpoint': 'checkpoints_2', 'fp16': True,
    'use_qwen_emo': False, 'use_random': False, 'max_text_tokens_per_segment': 120,
    'seed_base': 20261007, 'mp3_filter': 'loudnorm=I=-18:TP=-2:LRA=7',
    'mp3_quality': 2, 'sample_rate': 22050,
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, data):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--line', action='append', help='Select a line ID; repeat to select several.')
    parser.add_argument('--force', action='store_true', help='Regenerate selected samples even if unchanged.')
    args = parser.parse_args()
    manifest = json.loads((PACK / 'manifest.json').read_text(encoding='utf-8'))
    lines = manifest['lines']
    ids = {line['id'] for line in lines}
    if args.line and set(args.line) - ids:
        parser.error('Unknown voice line ID')
    for path in (REFERENCE, FFMPEG, INSTALL / 'checkpoints_2/config.yaml'):
        if not path.is_file():
            raise FileNotFoundError(path)
    MASTERS.mkdir(parents=True, exist_ok=True)
    reference_hash = sha256(REFERENCE)
    report = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.exists() else {}
    report.update({'settings': SETTINGS, 'reference_sha256': reference_hash,
                   'reference': str(REFERENCE), 'model_directory': str(INSTALL / 'checkpoints_2')})
    samples = report.setdefault('samples', {})
    pending = []
    for index, line in enumerate(lines):
        if args.line and line['id'] not in args.line:
            continue
        fingerprint = hashlib.sha256(json.dumps({
            'text': line['text'], 'reference': reference_hash, 'settings': SETTINGS,
            'seed': SETTINGS['seed_base'] + index,
        }, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        previous = samples.get(line['id'], {})
        wav = MASTERS / (line['id'] + '.wav')
        mp3 = PACK / (line['id'] + '.mp3')
        if (not args.force and previous.get('fingerprint') == fingerprint
                and wav.is_file() and mp3.is_file()
                and previous.get('wav_sha256') == sha256(wav)
                and previous.get('mp3_sha256') == sha256(mp3)):
            print('UNCHANGED ' + line['id'], flush=True)
            continue
        pending.append((index, line, fingerprint, wav, mp3))
    if not pending:
        print('ALL_SELECTED_SAMPLES_READY', flush=True)
        return

    os.environ.update(HF_HOME=str(INSTALL / '.hf-cache'), HF_HUB_OFFLINE='1',
                      TRANSFORMERS_OFFLINE='1', USE_MODELSCOPE='false', OMP_NUM_THREADS='8')
    sys.path.insert(0, str(INSTALL))
    os.chdir(INSTALL)
    import numpy as np
    import soundfile as sf
    import torch
    from indextts.infer_v2 import IndexTTS2
    torch.set_num_threads(8)
    if not torch.cuda.is_available():
        raise RuntimeError('Local authoring requires the installed CUDA GPU.')
    report['device'] = torch.cuda.get_device_name(0)
    started = time.perf_counter()
    print(f'LOADING_MODEL pending={len(pending)}', flush=True)
    tts = IndexTTS2(cfg_path=str(INSTALL / 'checkpoints_2/config.yaml'),
                    model_dir=str(INSTALL / 'checkpoints_2'), use_fp16=True,
                    use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
    report['load_seconds'] = round(time.perf_counter() - started, 3)

    def validate(data, rate):
        duration = len(data) / rate
        peak = float(np.max(np.abs(data)))
        rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
        clipped = float(np.mean(np.abs(data) >= .999))
        if not (np.isfinite(data).all() and .5 < duration < 20 and rms > .002 and clipped < .001):
            raise ValueError(f'Invalid audio: duration={duration}, rms={rms}, clipped={clipped}')
        return {'seconds': round(duration, 3), 'sample_rate': rate,
                'peak': peak, 'rms': rms, 'clipped_fraction': clipped}

    for index, line, fingerprint, wav, mp3 in pending:
        seed = SETTINGS['seed_base'] + index
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        temporary_wav = wav.with_suffix('.tmp.wav')
        temporary_mp3 = mp3.with_suffix('.tmp.mp3')
        begin = time.perf_counter()
        tts.infer(spk_audio_prompt=str(REFERENCE), text=line['text'], output_path=str(temporary_wav),
                  use_random=False, max_text_tokens_per_segment=120, verbose=False)
        elapsed = time.perf_counter() - begin
        data, rate = sf.read(temporary_wav)
        wav_stats = validate(data, rate)
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
                        '-i', str(temporary_wav), '-map_metadata', '-1', '-ac', '1',
                        '-af', SETTINGS['mp3_filter'], '-ar', str(SETTINGS['sample_rate']),
                        '-codec:a', 'libmp3lame', '-q:a', str(SETTINGS['mp3_quality']),
                        str(temporary_mp3)], check=True)
        decoded = subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error',
                                  '-i', str(temporary_mp3), '-f', 'f32le', '-acodec', 'pcm_f32le',
                                  '-ac', '1', '-ar', str(SETTINGS['sample_rate']), 'pipe:1'],
                                 check=True, capture_output=True)
        mp3_stats = validate(np.frombuffer(decoded.stdout, dtype='<f4'), SETTINGS['sample_rate'])
        temporary_wav.replace(wav)
        temporary_mp3.replace(mp3)
        result = {'id': line['id'], 'text': line['text'], 'seed': seed, 'fingerprint': fingerprint,
                  'wav': wav_stats, 'mp3': mp3_stats, 'synthesis_seconds': round(elapsed, 3),
                  'wav_sha256': sha256(wav), 'mp3_sha256': sha256(mp3)}
        samples[line['id']] = result
        write_json(REPORT, report)
        print('SAMPLE_READY ' + json.dumps({'id': line['id'], 'seconds': mp3_stats['seconds'],
                                          'synthesis_seconds': result['synthesis_seconds'],
                                          'completed': len(samples), 'total': len(lines)}), flush=True)
    print('ALL_SELECTED_SAMPLES_READY', flush=True)


if __name__ == '__main__':
    main()
