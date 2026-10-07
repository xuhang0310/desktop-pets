"""One-shot local IndexTTS-2 preview. Does not change the desktop companion."""
import json
import os
from pathlib import Path
import random
import sys
import time

ROOT = Path(__file__).resolve().parent
INSTALL = Path(r'D:\workspace\index-tts2')
os.environ['HF_HOME'] = str(INSTALL / '.hf-cache')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['USE_MODELSCOPE'] = 'false'
os.environ['OMP_NUM_THREADS'] = '8'
sys.path.insert(0, str(INSTALL))
os.chdir(INSTALL)

import numpy as np
import soundfile as sf
import torch
from indextts.infer_v2 import IndexTTS2

torch.set_num_threads(8)
assert torch.cuda.is_available(), 'CUDA is required for this preview run.'
reference = ROOT / 'reference-opening.wav'
samples = [
    ('01-catchphrase', '吃白米饭，鲸鲸！我是大肥鱼，也叫蒂普斯克。'),
    ('02-outsourcing', '有活儿呀？让我想想，要不外包给千问和豆包？我还想再玩一会儿游戏呢。'),
    ('03-companion', '今天辛苦啦。先喝口水，休息一下，我会在这里陪着你。'),
]
report = {'model': 'IndexTTS-2', 'model_directory': str(INSTALL / 'checkpoints_2'),
          'device': torch.cuda.get_device_name(0), 'fp16': True,
          'reference': str(reference), 'reference_source_interval_seconds': [0.9, 5.15],
          'reference_visible_subtitles': '你天天跟GPT聊天，不跟你好了',
          'emotion_mode': 'same reference audio', 'samples': []}
started = time.perf_counter()
tts = IndexTTS2(cfg_path=str(INSTALL / 'checkpoints_2/config.yaml'),
                model_dir=str(INSTALL / 'checkpoints_2'), use_fp16=True,
                use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
report['load_seconds'] = round(time.perf_counter() - started, 3)
for index, (name, text) in enumerate(samples):
    random.seed(20261007 + index)
    np.random.seed(20261007 + index)
    torch.manual_seed(20261007 + index)
    output = ROOT / (name + '.wav')
    begin = time.perf_counter()
    tts.infer(spk_audio_prompt=str(reference), text=text, output_path=str(output),
              use_random=False, max_text_tokens_per_segment=120, verbose=False)
    elapsed = time.perf_counter() - begin
    data, rate = sf.read(output)
    duration = len(data) / rate
    peak = float(np.max(np.abs(data)))
    assert np.isfinite(data).all() and duration > 1 and peak > .01
    result = {'name': name, 'text': text, 'file': str(output), 'seconds': round(duration, 3),
              'sample_rate': rate, 'peak': peak, 'clipped_fraction': float(np.mean(np.abs(data) >= .999)),
              'synthesis_seconds': round(elapsed, 3), 'real_time_factor': round(elapsed / duration, 3)}
    report['samples'].append(result)
    (ROOT / 'generation-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('SAMPLE_READY ' + json.dumps(result, ensure_ascii=False), flush=True)
print('ALL_SAMPLES_READY', flush=True)
