#!/usr/bin/env python3
import asyncio, subprocess, json
from pathlib import Path

try:
    import edge_tts
except ImportError:
    print("请先 pip install edge-tts")
    exit(1)

SCENES = [
    {"id": "01-opener", "text": "还在熬夜做 PPT？现在你只需要一句话。"},
    {"id": "02-what", "text": "GordenPPTSkill，一个开源的 AI PPT 生成工具。17 套中文商务模板，支持 DeepSeek、Claude、GPT 所有主流模型。"},
    {"id": "03-features", "text": "信息密度高、排版复杂、真正能用的商务 PPT。一键生成，自动更新模板。国企、互联网大厂都在用。"},
    {"id": "04-cta", "text": "GitHub 1800 星，完全开源。链接在评论区，去试试。"},
]

VOICE = "zh-CN-YunyangNeural"
OUTPUT_DIR = Path("d:/claude code mode/files/gorden-ppt-skill/audio")


def get_duration(file_path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip()) if r.stdout.strip() else 0


async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for i, scene in enumerate(SCENES, 1):
        out = OUTPUT_DIR / f"{scene['id']}.mp3"
        print(f"[{i}/{len(SCENES)}] {scene['id']}...", end=" ", flush=True)
        try:
            c = edge_tts.Communicate(scene["text"], VOICE)
            await c.save(str(out))
            dur = get_duration(out)
            fr = round(dur * 30)
            results.append({"id": scene["id"], "file": f"{scene['id']}.mp3", "frames": fr, "duration": round(dur, 2)})
            print(f"{dur:.2f}s ({fr}f)")
        except Exception as e:
            print(f"FAIL: {e}")

    total_frames = sum(r["frames"] for r in results)
    print(f"\n总共: ~{total_frames/30:.0f}s ({total_frames}f)")

    config = {"fps": 30, "scenes": results}
    cfg_path = OUTPUT_DIR.parent / "audio-config.json"
    with open(cfg_path, "w") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"配置已写入 {cfg_path}")

    print("\n--- Scene config ---")
    for r in results:
        print(f'  {{ id: "{r["id"]}", file: "{r["file"]}", frames: {r["frames"]} }},')
    acc = 0
    for r in results:
        print(f'  {r["id"]}: start={acc}s end={acc+r["frames"]/30:.1f}s')
        acc += r["frames"]


if __name__ == "__main__":
    asyncio.run(main())
