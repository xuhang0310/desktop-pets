"""Prepare A-voice training labels; --generate explicitly runs the local teacher model."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("approved_a", ROOT / "scripts/generate-approved-a-voice.py")
approved_a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(approved_a)
OUT = ROOT / "voice-lab/dafeiyu-sovits-dataset"

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def write_json(file, data):
    temporary = file.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(file)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate", action="store_true", help="Generate missing corpus audio on GPU. Otherwise only export existing approved WAVs.")
    parser.add_argument("--line", action="append", help="Select corpus IDs, e.g. train-001; repeat for several.")
    parser.add_argument("--force", action="store_true", help="Regenerate selected corpus WAVs. Never rewrites the production voice pack.")
    args = parser.parse_args()
    corpus = json.loads((ROOT / "scripts/sovits-corpus.json").read_text(encoding="utf-8"))
    rows = [{"id": f"train-{index:03d}", "text": text} for index, text in enumerate(corpus, 1)]
    if args.line and set(args.line) - {row["id"] for row in rows}:
        parser.error("Unknown corpus ID")
    if any(not isinstance(row["text"], str) or not 1 <= len(row["text"]) <= 120 or any(c in row["text"] for c in "|\r\n") for row in rows):
        raise ValueError("Invalid corpus")
    reference_hash = digest(approved_a.REFERENCE)
    manifest = json.loads((approved_a.PACK / "manifest.json").read_text(encoding="utf-8"))
    if reference_hash != manifest["reference_sha256"]:
        raise ValueError("The approved A reference has changed")
    OUT.mkdir(parents=True, exist_ok=True)
    wav_dir = OUT / "wavs"
    wav_dir.mkdir(exist_ok=True)
    report_path = OUT / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    report.update(reference_sha256=reference_hash, teacher_settings=approved_a.SETTINGS, sample_rate=32000)
    samples = report.setdefault("samples", {})
    import numpy as np
    import soundfile as sf

    def convert(source, target):
        temporary = target.with_suffix(".tmp.wav")
        subprocess.run([str(approved_a.FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                        "-ac", "1", "-ar", "32000", "-c:a", "pcm_s16le", str(temporary)], check=True)
        data, rate = sf.read(temporary)
        seconds = len(data) / rate
        if not np.isfinite(data).all() or not .5 < seconds < 20 or np.sqrt(np.mean(data ** 2)) < .002:
            temporary.unlink(missing_ok=True)
            raise ValueError("Invalid generated WAV")
        temporary.replace(target)
        return round(seconds, 3)

    # Reuse normalized A masters; the production MP3s and their manifest are never changed.
    for row in manifest["lines"]:
        source = approved_a.MASTERS / (row["id"] + ".wav")
        if not source.is_file():
            continue
        line_id = "approved-" + row["id"]
        target = wav_dir / (line_id + ".wav")
        fingerprint = hashlib.sha256((digest(source) + row["text"]).encode()).hexdigest()
        previous = samples.get(line_id, {})
        if target.exists() and previous.get("fingerprint") == fingerprint and previous.get("sha256") == digest(target):
            continue
        seconds = convert(source, target)
        samples[line_id] = {"text": row["text"], "fingerprint": fingerprint, "sha256": digest(target), "seconds": seconds, "source": "approved-A-master"}

    pending = []
    for row in rows:
        if args.line and row["id"] not in args.line:
            continue
        target = wav_dir / (row["id"] + ".wav")
        fingerprint = hashlib.sha256(json.dumps({"text": row["text"], "reference": reference_hash, "settings": approved_a.SETTINGS}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        previous = samples.get(row["id"], {})
        if not args.force and target.is_file() and previous.get("fingerprint") == fingerprint and previous.get("sha256") == digest(target):
            continue
        pending.append((row, target, fingerprint))
    write_json(report_path, report)
    write_json(OUT / "corpus.json", {"speaker": "jingjing", "language": "zh", "lines": rows})
    if args.generate and pending:
        # Uses exactly the approved A teacher settings, not the archived first clone.
        import sys
        os.environ.update(HF_HOME=str(approved_a.INSTALL / ".hf-cache"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", USE_MODELSCOPE="false", OMP_NUM_THREADS="8")
        sys.path.insert(0, str(approved_a.INSTALL))
        os.chdir(approved_a.INSTALL)
        import torch
        from indextts.infer_v2 import IndexTTS2
        torch.set_num_threads(8)
        seed = approved_a.SETTINGS["seed_before_model_load"]
        random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
        tts = IndexTTS2(cfg_path=str(approved_a.INSTALL / "checkpoints_2/config.yaml"), model_dir=str(approved_a.INSTALL / "checkpoints_2"), use_fp16=True, use_cuda_kernel=False, use_deepspeed=False, use_qwen_emo=False)
        random_state, numpy_state = random.getstate(), np.random.get_state()
        torch_state, cuda_states = torch.get_rng_state(), torch.cuda.get_rng_state_all()
        for row, target, fingerprint in pending:
            random.setstate(random_state); np.random.set_state(numpy_state)
            torch.set_rng_state(torch_state); torch.cuda.set_rng_state_all(cuda_states)
            raw = OUT / (row["id"] + "-raw.wav")
            normalized = OUT / (row["id"] + "-normalized.wav")
            start = time.perf_counter()
            tts.infer(spk_audio_prompt=str(approved_a.REFERENCE), text=row["text"], output_path=str(raw), use_random=False, max_text_tokens_per_segment=120, verbose=False)
            subprocess.run([str(approved_a.FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw), "-af", approved_a.SETTINGS["filter"], "-ar", "22050", "-c:a", "pcm_s16le", str(normalized)], check=True)
            seconds = convert(normalized, target)
            samples[row["id"]] = {"text": row["text"], "fingerprint": fingerprint, "sha256": digest(target), "seconds": seconds, "synthesis_seconds": round(time.perf_counter() - start, 3), "source": "IndexTTS-2-A"}
            write_json(report_path, report)
            print("READY " + row["id"], flush=True)
    valid = []
    for line_id, sample in samples.items():
        wav = wav_dir / (line_id + ".wav")
        if wav.is_file() and sample.get("sha256") == digest(wav):
            valid.append(f"{wav}|jingjing|zh|{sample['text']}")
    temporary = OUT / "dataset.list.tmp"
    temporary.write_text("\n".join(valid) + "\n", encoding="utf-8")
    temporary.replace(OUT / "dataset.list")
    print(json.dumps({"ready": len(valid), "corpus_total": len(rows), "missing_corpus": sum(row["id"] not in samples for row in rows), "seconds": round(sum(s.get("seconds", 0) for s in samples.values()), 3), "gpu_generation_requested": args.generate}, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
