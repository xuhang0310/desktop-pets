"""Two audition candidates only. Never changes the desktop voice pack."""
import gc
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
INSTALL = Path(r'D:\workspace\index-tts2')
FFMPEG = Path(r'C:\ffmpeg\bin\ffmpeg.exe')
TEXT = '你天天跟GPT聊天，不跟你好了！'
REFERENCE = ROOT / 'reference-voice-only.wav'
SOURCE_START = 1.74
SOURCE_END = 4.98

os.environ.update(HF_HOME=str(INSTALL / '.hf-cache'), HF_HUB_OFFLINE='1',
                  TRANSFORMERS_OFFLINE='1', USE_MODELSCOPE='false', OMP_NUM_THREADS='8')
sys.path.insert(0, str(INSTALL))
os.chdir(INSTALL)

import librosa
import numpy as np
import soundfile as sf
import torch
import torchaudio
from indextts.infer_v2 import IndexTTS2

torch.set_num_threads(8)


def convert(source, output, filters, sample_rate=22050, trim=None):
    command = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source)]
    if trim:
        command += ['-ss', str(trim[0]), '-t', str(trim[1] - trim[0])]
    command += ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', str(sample_rate), '-af', filters]
    if output.suffix == '.mp3':
        command += ['-codec:a', 'libmp3lame', '-q:a', '2']
    else:
        command += ['-codec:a', 'pcm_s16le']
    subprocess.run(command + [str(output)], check=True)


def features(path):
    y, sr = librosa.load(path, sr=16000, mono=True)
    f0, voiced, probability = librosa.pyin(y, sr=sr, fmin=100, fmax=700, frame_length=1024, hop_length=160)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=160)[0]
    speech = rms > rms.max() * .055
    valid = voiced & (probability >= .15) & speech & np.isfinite(f0)
    if valid.sum() < 10:
        raise ValueError('Insufficient speech frames')
    spectrum = np.abs(librosa.stft(y, n_fft=1024, hop_length=160)) ** 2
    frequencies = librosa.fft_frequencies(sr=sr, n_fft=1024)
    mid = np.mean(spectrum[(frequencies >= 700) & (frequencies < 1500)][:, speech])
    levels = {}
    for name, low, high in [('body', 150, 650), ('presence', 1800, 4500)]:
        energy = np.mean(spectrum[(frequencies >= low) & (frequencies < high)][:, speech])
        levels[name] = float(10 * np.log10((energy + 1e-12) / (mid + 1e-12)))
    active = np.flatnonzero(speech)
    data, rate = sf.read(path)
    return {'duration': len(y) / sr, 'speech_span': (active[-1] - active[0]) * .01,
            'f0_hz_p10_median_p90': np.percentile(f0[valid], [10, 50, 90]).tolist(),
            'relative_band_db': levels, 'peak': float(np.max(np.abs(data))),
            'clipped_fraction': float(np.mean(np.abs(data) >= .999))}


def speaker_embedding(camp, path):
    audio, sr = torchaudio.load(str(path))
    audio = torchaudio.functional.resample(audio.mean(dim=0, keepdim=True), sr, 16000)
    feature = torchaudio.compliance.kaldi.fbank(audio, num_mel_bins=80, dither=0, sample_frequency=16000)
    feature -= feature.mean(dim=0, keepdim=True)
    with torch.inference_mode():
        return torch.nn.functional.normalize(camp(feature.unsqueeze(0)).float(), dim=-1)


convert(ROOT.parent / 'source-audio.wav', REFERENCE, 'loudnorm=I=-20:TP=-2:LRA=7',
        sample_rate=24000, trim=(SOURCE_START, SOURCE_END))
convert(REFERENCE, ROOT / '00-video-reference.mp3', 'loudnorm=I=-18:TP=-2:LRA=7')
random.seed(20261007)
np.random.seed(20261007)
torch.manual_seed(20261007)
tts = IndexTTS2(cfg_path=str(INSTALL / 'checkpoints_2/config.yaml'),
                model_dir=str(INSTALL / 'checkpoints_2'), use_fp16=True,
                use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
begin = time.perf_counter()
tts.infer(spk_audio_prompt=str(REFERENCE), text=TEXT, output_path=str(ROOT / 'A-recloned-master.wav'),
          use_random=False, max_text_tokens_per_segment=120, verbose=False)
elapsed = time.perf_counter() - begin
camp = tts.campplus_model.to('cpu')
del tts
gc.collect()
torch.cuda.empty_cache()
convert(ROOT / 'A-recloned-master.wav', ROOT / 'A-recloned.wav', 'loudnorm=I=-18:TP=-2:LRA=7')
ref = features(REFERENCE)
candidate_a = features(ROOT / 'A-recloned.wav')
pitch = float(np.clip(ref['f0_hz_p10_median_p90'][1] / candidate_a['f0_hz_p10_median_p90'][1], .90, 1.16))
tempo = float(np.clip(candidate_a['speech_span'] / ref['speech_span'], .90, 1.15))
body_gain = float(np.clip(ref['relative_band_db']['body'] - candidate_a['relative_band_db']['body'], -3, 3))
presence_gain = float(np.clip(ref['relative_band_db']['presence'] - candidate_a['relative_band_db']['presence'], -3, 3))
calibration_filter = (
    f'rubberband=pitch={pitch:.6f}:tempo={tempo:.6f}:formant=shifted:pitchq=quality,'
    f'equalizer=f=300:t=q:w=0.7:g={body_gain:.4f},'
    f'equalizer=f=2800:t=q:w=0.7:g={presence_gain:.4f},'
    'loudnorm=I=-18:TP=-2:LRA=7'
)
convert(ROOT / 'A-recloned-master.wav', ROOT / 'B-reference-matched.wav', calibration_filter)
candidate_b = features(ROOT / 'B-reference-matched.wav')
reference_embedding = speaker_embedding(camp, REFERENCE)
for name, stats in [('A-recloned', candidate_a), ('B-reference-matched', candidate_b)]:
    if not (.5 < stats['duration'] < 15 and stats['clipped_fraction'] < .001):
        raise ValueError('Invalid audition: ' + name)
    similarity = (speaker_embedding(camp, ROOT / (name + '.wav')) * reference_embedding).sum().item()
    stats['campplus_cosine_to_reference'] = similarity
    convert(ROOT / (name + '.wav'), ROOT / (name + '.mp3'), 'anull')
report = {'text': TEXT, 'source_interval_seconds': [SOURCE_START, SOURCE_END], 'seed': 20261007,
          'model': 'IndexTTS-2', 'reference': ref, 'A': candidate_a, 'B': candidate_b,
          'B_filter': calibration_filter, 'generation_seconds': elapsed,
          'note': 'Auditions only. Cosine similarity is a diagnostic, not a percentage or a perceptual guarantee. The desktop pack has not been changed.'}
(ROOT / 'audition-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print('TWO_AUDITIONS_READY ' + json.dumps(report, ensure_ascii=False), flush=True)
