#!/usr/bin/env python3
"""生成 TTS 配音"""
import asyncio, subprocess, json
from pathlib import Path

try:
    import edge_tts
except ImportError:
    print("请先 pip install edge-tts"); exit(1)

SCENES = [
    {"id": "01-opener", "text": "苹果在 WWDC 2026 上发布了全新的 AI 架构。"},
    {"id": "02-what", "text": "Apple Intelligence 全面重写，核心是与 Google 联合开发的苹果基础模型。支持图像理解、图像生成、视觉问答——这才是苹果真正想做的 AI。"},
    {"id": "03-key", "text": "新的系统编排器居中调度，根据你正在用的 App 和当前任务，在所有平台间协调 AI 功能。"},
    {"id": "04-privacy", "text": "沿用端侧处理和私有云计算，第三方可随时验证隐私保障。"},
]

VOICE = "zh-CN-YunyangNeural"
OUTPUT_DIR = Path("d:/claude code mode/Sandbox Project/AI视频工作流/项目/apple-ai-wwdc26/audio")

def get_duration(fp):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(fp)], capture_output=True, text=True)
    return float(r.stdout.strip()) if r.stdout.strip() else 0

async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for i, s in enumerate(SCENES, 1):
        out = OUTPUT_DIR / f"{s['id']}.mp3"
        print(f"[{i}/{len(SCENES)}] {s['id']}...", end=" ", flush=True)
        try:
            c = edge_tts.Communicate(s["text"], VOICE); await c.save(str(out))
            dur = get_duration(out); fr = round(dur * 30)
            results.append({"id": s["id"], "file": f"{s['id']}.mp3", "frames": fr, "duration": round(dur, 2)})
            print(f"{dur:.2f}s ({fr}f)")
        except Exception as e:
            print(f"FAIL: {e}")
    total = sum(r["frames"] for r in results)
    print(f"\n总共: ~{total/30:.0f}s ({total}f)")
    with open(OUTPUT_DIR.parent / "audio-config.json", "w") as f:
        json.dump({"fps": 30, "scenes": results}, f, ensure_ascii=False, indent=2)
    print("配置已写入")

if __name__ == "__main__":
    asyncio.run(main())
