"""Measure reference versus clone before selecting a voice calibration."""
import json
from pathlib import Path
import time

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'calibration'
OUTPUT.mkdir(exist_ok=True)


def measure(path):
    y, sr = librosa.load(str(path), sr=16000, mono=True)
    f0, voiced, probability = librosa.pyin(y, sr=sr, fmin=65, fmax=700,
                                        frame_length=1024, hop_length=160)
    reliable = f0[voiced & (probability >= .15) & np.isfinite(f0)]
    if len(reliable) < 10:
        raise ValueError('Not enough voiced frames: ' + str(path))
    return {'file': str(path), 'duration': round(len(y) / sr, 3),
            'voiced_fraction': round(float(np.mean(voiced)), 3),
            'reliable_frames': len(reliable),
            'f0_hz_p10_median_p90': np.round(np.percentile(reliable, [10, 50, 90]), 2).tolist()}


if __name__ == '__main__':
    files = [ROOT / 'reference-opening.wav', ROOT / '01-catchphrase.wav',
             ROOT / 'pack-masters/hello-1.wav', ROOT / 'pack-masters/pat-1.wav',
             ROOT / 'pack-masters/who.wav']
    results = []
    for path in files:
        result = measure(path)
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        (OUTPUT / 'baseline-pitch.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
