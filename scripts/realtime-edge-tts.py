"""One sentence in via JSON stdin, MP3 bytes out. No files or speech logging."""
import asyncio
import json
import sys

async def main():
    import edge_tts
    request = json.loads(sys.stdin.buffer.read(16384).decode("utf-8"))
    text = request.get("text", "")
    if not isinstance(text, str) or not 1 <= len(text) <= 300:
        raise ValueError("Invalid sentence")
    voice = edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural",
        rate=request.get("rate", "+0%"), pitch="+0Hz")
    async for part in voice.stream():
        if part["type"] == "audio":
            sys.stdout.buffer.write(part["data"])
            sys.stdout.buffer.flush()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        sys.stderr.write("Speech synthesis unavailable\n")
        sys.exit(1)
