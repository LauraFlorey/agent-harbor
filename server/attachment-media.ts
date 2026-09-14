import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "./config.ts";
import { buildAgentEnvironment } from "./agent-environment.ts";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
function binary(name: string): string {
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    if (existsSync(join(dir, name))) return join(dir, name);
  }
  return name;
}
export async function mediaInfo(path: string) {
  try {
    const { stdout } = await exec(binary("ffprobe"), ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path], { timeout: 20_000, maxBuffer: 64_000 });
    const info = JSON.parse(stdout);
    const duration = Number(info.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 4 * 3600) throw new Error("Invalid duration");
    return { duration, audio: info.streams?.some((s: { codec_type: string }) => s.codec_type === "audio") === true, video: info.streams?.some((s: { codec_type: string }) => s.codec_type === "video") === true };
  } catch { throw new Error("This media file could not be opened. FFmpeg is required for audio and video."); }
}
export async function videoFrame(path: string, seconds: number, output: string, signal?: AbortSignal) {
  await exec(binary("ffmpeg"), ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-ss", String(seconds), "-i", path, "-frames:v", "1", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-q:v", "4", "-y", output], { timeout: 30_000, maxBuffer: 64_000, env: buildAgentEnvironment(), signal });
}
export async function transcribeMedia(path: string, dir: string, start: number, duration: number, signal?: AbortSignal): Promise<string> {
  const model = join(DATA_DIR, "media-models", "ggml-base.bin");
  if (!existsSync(model)) throw new Error("Local transcription needs a Whisper model installed in Agent Harbor's media-models folder.");
  const stem = join(dir, `transcript-${start}-${duration}`);
  try { return await fs.readFile(stem + ".txt", "utf8"); } catch { /* not cached */ }
  const temporary = stem + "-" + randomUUID();
  const wav = temporary + ".wav";
  try {
    await exec(binary("ffmpeg"), ["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-ss", String(start), "-i", path, "-t", String(duration), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-y", wav], { timeout: 60_000, maxBuffer: 64_000, env: buildAgentEnvironment(), signal });
    await exec(binary("whisper-cli"), ["-m", model, "-f", wav, "-l", "auto", "-otxt", "-of", temporary, "-np"], { timeout: 240_000, maxBuffer: 2_000_000, env: buildAgentEnvironment(), signal });
    const text = await fs.readFile(temporary + ".txt", "utf8");
    await fs.chmod(temporary + ".txt", 0o600);
    await fs.rename(temporary + ".txt", stem + ".txt");
    return text.trim() || "No intelligible speech was detected.";
  } finally { await fs.unlink(wav).catch(() => {}); await fs.unlink(temporary + ".txt").catch(() => {}); }
}
