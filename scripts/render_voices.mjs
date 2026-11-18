import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICES } from "../src/voices.ts";

const output = fileURLToPath(new URL("../public/audio/voice/", import.meta.url));
const missing = Object.entries(VOICES).filter(([id]) => !existsSync(join(output, id + ".mp3")));
const characters = missing.reduce((total, [, line]) => total + [...line.text].length, 0);
const estimatedUsd = characters * 0.03 / 1000;
if (estimatedUsd > 0.05) throw Error("The missing lines exceed the $0.05 render cap.");
console.log(`${missing.length} missing lines, ${characters} characters, estimated US$${estimatedUsd.toFixed(4)}`);
if (process.argv.includes("--dry-run") || missing.length === 0) process.exit(0);

const key = process.env.DEEPGRAM_API_KEY;
if (!key) throw Error("Set DEEPGRAM_API_KEY in the authoring environment.");
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0)
  throw Error("FFmpeg is required to render voice clips.");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "gtl-voice-"));
try {
  for (const [id, line] of missing) {
    const url = new URL("https://api.deepgram.com/v1/speak");
    url.search = new URLSearchParams({
      model: line.model,
      encoding: "linear16",
      container: "wav",
      sample_rate: "24000",
    }).toString();
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: line.text }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const code = String(error?.err_code ?? error?.code ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
      throw Error(`Deepgram returned HTTP ${response.status} for ${id}${code ? ` (${code})` : ""}.`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 2048 || data.toString("ascii", 0, 4) !== "RIFF")
      throw Error(`Deepgram returned invalid audio for ${id}.`);
    const input = join(scratch, id + ".wav");
    const clip = join(output, id + ".mp3.part");
    await writeFile(input, data);
    const encoded = spawnSync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input,
      "-af", "highpass=f=78,lowpass=f=8500,loudnorm=I=-18:TP=-3:LRA=7",
      "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "72k",
      "-f", "mp3", clip,
    ], { encoding: "utf8" });
    if (encoded.status !== 0) {
      await rm(clip, { force: true });
      throw Error(encoded.stderr || `Could not encode ${id}.`);
    }
    await rename(clip, join(output, id + ".mp3"));
    console.log(`Rendered ${id} (${response.headers.get("dg-char-count") ?? [...line.text].length} characters).`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
