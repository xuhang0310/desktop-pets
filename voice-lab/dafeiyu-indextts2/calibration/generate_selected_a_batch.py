"""Generate the next three approved-A auditions, without changing the app's audio."""
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
OUTPUT = ROOT / 'approved-a-batch-01'
INSTALL = Path(r'D:\workspace\index-tts2')
FFMPEG = Path(r'C:\ffmpeg\bin\ffmpeg.exe')
REFERENCE = ROOT / 'reference-voice-only.wav'
LINE_IDS = ('hello-1', 'pat-1', 'rice')
SEED = 20261007


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main():
    manifest = json.loads((PROJECT / 'assets/voice-dafeiyu-indextts2/manifest.json').read_text(encoding='utf-8'))
    by_id = {line['id']: line for line in manifest['lines']}
    lines = [by_id[line_id] for line_id in LINE_IDS]
    OUTPUT.mkdir(exist_ok=True)
    settings = {'model': 'IndexTTS-2', 'checkpoint': 'checkpoints_2', 'selected_version': 'A',
                'reference_sha256': digest(REFERENCE), 'reference_interval_seconds': [1.74, 4.98],
                'fp16': True, 'use_qwen_emo': False, 'use_cuda_kernel': False, 'use_deepspeed': False,
                'use_random': False, 'max_text_tokens_per_segment': 120,
                'seed_before_model_load': SEED, 'filter': 'loudnorm=I=-18:TP=-2:LRA=7',
                'sample_rate': 22050, 'pitch_tempo_eq_changes': False}
    report_path = OUTPUT / 'generation-report.json'
    report = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {}
    if report and (report['settings'] != settings or report['lines'] != lines):
        raise RuntimeError('Batch inputs changed; preserve this review batch and use a new batch directory.')
    report.update(settings=settings, lines=lines, production_replaced=False)
    results = report.setdefault('samples', {})
    pending = []
    for line in lines:
        previous = results.get(line['id'], {})
        mp3 = OUTPUT / (line['id'] + '.mp3')
        wav = OUTPUT / (line['id'] + '.wav')
        if (mp3.is_file() and wav.is_file() and previous.get('mp3_sha256') == digest(mp3)
                and previous.get('wav_sha256') == digest(wav)):
            print('UNCHANGED ' + line['id'], flush=True)
        else:
            pending.append(line)
    if not pending:
        print('THREE_A_AUDITIONS_READY', flush=True)
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
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    tts = IndexTTS2(cfg_path=str(INSTALL / 'checkpoints_2/config.yaml'),
                    model_dir=str(INSTALL / 'checkpoints_2'), use_fp16=True,
                    use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
    # A's seed was set before model loading. Preserve that same starting RNG state for each line.
    random_state, numpy_state = random.getstate(), np.random.get_state()
    torch_state, cuda_states = torch.get_rng_state(), torch.cuda.get_rng_state_all()

    def validate(data, rate):
        seconds = len(data) / rate
        rms = float(np.sqrt(np.mean(data.astype(np.float64) ** 2)))
        clipped = float(np.mean(np.abs(data) >= .999))
        if not (np.isfinite(data).all() and .5 < seconds < 15 and rms > .002 and clipped < .001):
            raise ValueError('Audio validation failed')
        return {'seconds': round(seconds, 3), 'sample_rate': rate,
                'peak': float(np.max(np.abs(data))), 'rms': rms, 'clipped_fraction': clipped}

    for line in pending:
        random.setstate(random_state)
        np.random.set_state(numpy_state)
        torch.set_rng_state(torch_state)
        torch.cuda.set_rng_state_all(cuda_states)
        master = OUTPUT / (line['id'] + '-master.wav')
        wav = OUTPUT / (line['id'] + '.wav')
        mp3 = OUTPUT / (line['id'] + '.mp3')
        started = time.perf_counter()
        tts.infer(spk_audio_prompt=str(REFERENCE), text=line['text'], output_path=str(master),
                  use_random=False, max_text_tokens_per_segment=120, verbose=False)
        elapsed = time.perf_counter() - started
        validate(*sf.read(master))
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master),
                        '-map_metadata', '-1', '-ac', '1', '-ar', '22050', '-af', settings['filter'],
                        '-codec:a', 'pcm_s16le', str(wav)], check=True)
        wav_stats = validate(*sf.read(wav))
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                        '-map_metadata', '-1', '-ac', '1', '-ar', '22050', '-codec:a', 'libmp3lame',
                        '-q:a', '2', str(mp3)], check=True)
        decoded = subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-i', str(mp3),
                                  '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', '22050', 'pipe:1'],
                                 check=True, capture_output=True)
        mp3_stats = validate(np.frombuffer(decoded.stdout, dtype='<f4'), 22050)
        if abs(wav_stats['seconds'] - mp3_stats['seconds']) > .08:
            raise ValueError('Encoded audio duration mismatch')
        results[line['id']] = {'text': line['text'], 'wav': wav_stats, 'mp3': mp3_stats,
                               'synthesis_seconds': round(elapsed, 3),
                               'wav_sha256': digest(wav), 'mp3_sha256': digest(mp3)}
        write_json(report_path, report)
        print('SAMPLE_READY ' + json.dumps({'id': line['id'], 'seconds': mp3_stats['seconds'],
                                          'completed': len(results), 'total': len(lines)}, ensure_ascii=False), flush=True)
    print('THREE_A_AUDITIONS_READY', flush=True)


if __name__ == '__main__':
    main()
