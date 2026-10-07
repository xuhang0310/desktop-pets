"""Download this user-provided reference with the existing Douyin adapter."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, r'E:\workspace\douyin-video-analysis\backend')
from app.services.douyin import parse_share_text, download_video

ROOT = Path(__file__).resolve().parent
SOURCE = Path(r'E:\workspace\douyin-video-analysis\downloads\jingjing-7691408979201434728')
SOURCE.mkdir(parents=True, exist_ok=True)
video = SOURCE / 'source.mp4'
info = parse_share_text('https://v.douyin.com/qIdt3_8KC0A/')
print('Resolved:', info.video_id, info.title, flush=True)
if not video.exists():
    download_video(info, video)
metadata = {'video_id': info.video_id, 'title': info.title, 'source_url': info.source_url, 'video_path': str(video)}
(ROOT / 'source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
ffmpeg = r'C:\ffmpeg\bin\ffmpeg.exe'
subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(video), '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(ROOT / 'source-audio.wav')], check=True)
frames = ROOT / 'frames'
frames.mkdir(exist_ok=True)
subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(video), '-vf', 'fps=1/4,scale=480:-2', '-q:v', '3', str(frames / '%03d.jpg')], check=True)
print(json.dumps({'source': str(video), 'bytes': video.stat().st_size, 'audio': str(ROOT / 'source-audio.wav'), 'frames': len(list(frames.glob('*.jpg')))}, ensure_ascii=False), flush=True)
