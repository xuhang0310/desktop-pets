import json
from pathlib import Path
import librosa
import numpy as np

root = Path(__file__).resolve().parent
y, sr = librosa.load(root.parent / 'source-audio.wav', sr=16000, duration=6)
f0, voiced, probability = librosa.pyin(y, sr=sr, fmin=65, fmax=700,
                                    frame_length=1024, hop_length=160)
times = librosa.times_like(f0, sr=sr, hop_length=160)
result = []
for start in np.arange(0, 6, .25):
    mask = (times >= start) & (times < start + .25) & voiced & (probability >= .15) & np.isfinite(f0)
    reliable = f0[mask]
    part = y[int(start * sr):int((start + .25) * sr)]
    item = {'start': float(start), 'frames': int(mask.sum()),
            'rms': round(float(np.sqrt(np.mean(part ** 2))), 4),
            'f0_median': round(float(np.median(reliable)), 1) if len(reliable) else None}
    result.append(item)
print(json.dumps(result, indent=2))
(root / 'source-timing.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
