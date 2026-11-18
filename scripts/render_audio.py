"""Render the original Grand Theft Liquidity music and surf loops with Python and FFmpeg."""

from array import array
from functools import lru_cache
from math import cos, exp, pi, sin, sqrt, tanh, tau
from pathlib import Path
from random import Random
import subprocess
import sys
from tempfile import TemporaryDirectory
import wave

RATE = 44100
BPM = 104
BEAT = 60 / BPM
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "audio"


class Track:
    def __init__(self, seconds):
        self.frames = round(RATE * seconds)
        self.left = array("f", [0]) * self.frames
        self.right = array("f", [0]) * self.frames

    def add(self, samples, at, level, pan=0):
        position = round(at * RATE) % self.frames
        left = level * sqrt((1 - pan) / 2)
        right = level * sqrt((1 + pan) / 2)
        for sample in samples:
            self.left[position] += sample * left
            self.right[position] += sample * right
            position += 1
            if position == self.frames:
                position = 0

    def encode(self, filename, title, bitrate, target_peak):
        peak = max(abs(min(self.left)), max(self.left), abs(min(self.right)), max(self.right))
        pcm = array("h")
        gain = target_peak * 32767 / peak
        for left, right in zip(self.left, self.right):
            pcm.append(round(left * gain))
            pcm.append(round(right * gain))
        if sys.byteorder == "big":
            pcm.byteswap()
        with TemporaryDirectory(prefix="gtl-audio-") as work:
            wav = Path(work) / "loop.wav"
            with wave.open(str(wav), "wb") as stream:
                stream.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
                stream.writeframes(pcm)
            output = OUTPUT / (filename + ".part")
            subprocess.run([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(wav), "-c:a", "libmp3lame", "-b:a", bitrate,
                "-metadata", f"title={title}", "-f", "mp3", str(output),
            ], check=True)
            output.replace(OUTPUT / filename)


@lru_cache(maxsize=96)
def instrument(kind, midi, held):
    hz = 440 * 2 ** ((midi - 69) / 12)
    release = {"keys": 0.37, "bass": 0.085, "pluck": 0.23, "vibes": 0.35}[kind]
    attack = 0.012 if kind == "keys" else 0.006
    samples = array("f")
    for frame in range(round((held + release) * RATE)):
        t = frame / RATE
        phase = tau * hz * t
        envelope = min(1, t / attack)
        envelope *= max(0, 1 - max(0, t - held) / release) ** 2
        if kind == "keys":
            # A soft tine and slightly inharmonic attack give the electric keys some bite.
            modulation = 0.22 + 0.92 * exp(-9.8 * t)
            tone = 0.76 * sin(phase + modulation * sin(2.009 * phase))
            tone += 0.17 * sin(2.002 * phase) * exp(-7 * t)
            tone *= exp(-0.9 * t) * (0.91 + 0.09 * cos(tau * 4.3 * t))
        elif kind == "bass":
            tone = tanh(1.17 * (sin(phase) + 0.29 * sin(2 * phase) + 0.1 * sin(3 * phase)))
            tone *= 0.62 + 0.38 * exp(-7 * t)
        elif kind == "pluck":
            tone = (0.61 * sin(phase) + 0.27 * sin(2.003 * phase) + 0.19 * sin(3 * phase))
            tone *= exp(-9.5 * t)
        else:
            tone = (0.79 * sin(phase + 0.13 * sin(4.012 * phase)) + 0.13 * sin(2 * phase))
            tone *= exp(-3.8 * t)
        samples.append(envelope * tone)
    return samples


def drums():
    rng = Random(702)
    kick, rim, hat = array("f"), array("f"), array("f")
    phase = low = 0
    for frame in range(round(0.29 * RATE)):
        t = frame / RATE
        raw = rng.uniform(-1, 1)
        low += 0.14 * (raw - low)
        phase += tau * (48 + 99 * exp(-27 * t)) / RATE
        attack = min(1, t / 0.0035)
        kick.append(attack * (sin(phase) * exp(-17 * t) + 0.13 * raw * exp(-105 * t)))
        rim.append(attack * (0.37 * sin(tau * 197 * t) * exp(-51 * t) + 0.48 * (raw - low) * exp(-29 * t)))
        hat.append(attack * (raw - low) * exp(-61 * t))
    return kick, rim, hat


def sunset():
    # D major, 24 bars. The middle eight drops the lead and leaves room for street sounds.
    chords = {
        "D": (38, [54, 57, 61, 64]),
        "Bm": (35, [54, 57, 59, 62]),
        "G": (31, [55, 59, 62, 66]),
        "A": (33, [55, 57, 62, 64]),
        "Em": (40, [55, 59, 62, 66]),
        "F#m": (42, [54, 57, 61, 64]),
    }
    bars = [
        "D", "Bm", "G", "A", "D", "Bm", "G", "A",
        "Em", "G", "Bm", "A", "Em", "G", "F#m", "A",
        "D", "Bm", "G", "A", "D", "Bm", "G", "A",
    ]
    lead = {
        0: [(1.5, 66), (2.03, 69), (2.76, 71)],
        1: [(0.76, 69), (1.55, 66), (2.55, 62)],
        3: [(1.52, 64), (2, 66), (3.06, 69)],
        4: [(1.1, 66), (1.6, 69), (2.1, 74)],
        6: [(0.5, 71), (1.28, 69), (2.53, 66)],
        7: [(1.55, 64), (2.1, 62)],
        11: [(2.55, 64), (3.14, 66)],
        15: [(2.75, 64), (3.52, 69)],
        16: [(0.51, 66), (1.04, 69), (1.76, 71), (3.05, 74)],
        17: [(0.78, 69), (1.57, 66), (2.4, 62)],
        19: [(1.57, 64), (2.11, 66), (3.06, 69)],
        20: [(0.54, 69), (1.29, 74), (2.53, 76)],
        22: [(0.51, 71), (1.29, 69), (2.52, 66)],
        23: [(1.56, 64), (2.06, 62)],
    }
    track = Track(len(bars) * 4 * BEAT)
    kick, rim, hat = drums()
    rng = Random(277)
    for bar, name in enumerate(bars):
        root, chord = chords[name]
        start = bar * 4 * BEAT
        bridge = 8 <= bar < 16
        for beat, velocity in [(0, 0.23), (1.75, 0.14), (2.51, 0.17), (3.53, 0.085)]:
            track.add(kick, start + BEAT * beat, velocity * (0.85 if bridge else 1))
        for beat in (1.025, 3.031):
            track.add(rim, start + BEAT * beat, 0.22, 0.13)
        if bar % 4 == 3:
            track.add(rim, start + BEAT * 3.71, 0.10, -0.06)
        for hat_index in range(8):
            beat = hat_index / 2 + (0.048 if hat_index % 2 else 0)
            track.add(hat, start + BEAT * beat, rng.uniform(0.055, 0.092), 0.32)

        bass_notes = [(0, root, 0.39), (0.77, root + 12, 0.17), (1.55, root + 7, 0.24),
                      (2.25, root, 0.31), (3.30, root + (12 if bar % 2 else 7), 0.22)]
        for beat, note, seconds in bass_notes:
            track.add(instrument("bass", note, seconds), start + BEAT * beat, 0.205)
        for beat, seconds in [(0.47, 0.47), (2.02, 0.59), (3.13, 0.25)]:
            for voice, note in enumerate(chord):
                pan = -0.42 + voice * 0.23
                track.add(instrument("keys", note, seconds), start + BEAT * beat + voice * 0.004,
                          0.083 if bridge else 0.072, pan)
        for beat in (0.55, 1.57, 2.55, 3.58):
            if bridge and beat in (1.57, 3.58):
                continue
            for voice, note in enumerate(chord[1:3]):
                track.add(instrument("pluck", note + 12, 0.09),
                          start + BEAT * beat + voice * 0.015, 0.063, 0.45)
        for beat, note in lead.get(bar, []):
            attack = start + BEAT * beat
            sample = instrument("vibes", note, 0.22)
            track.add(sample, attack, 0.106, -0.17)
            track.add(sample, attack + BEAT * 0.75, 0.032, 0.45)
    track.encode("sunset-loop.mp3", "Closing Bell at Sunset", "112k", 0.72)


def gull(duration, pitch):
    sound = array("f")
    phase = 0
    for frame in range(round(duration * RATE)):
        t = frame / RATE
        cursor = t / duration
        phase += tau * pitch * (1.18 - 0.44 * cursor + 0.23 * sin(pi * cursor)
                                + 0.047 * sin(tau * 29 * t)) / RATE
        envelope = sin(pi * cursor) ** 1.7
        formants = 0.44 * sin(phase) + 0.34 * sin(phase * 2.02) + 0.15 * sin(phase * 3.02)
        sound.append(envelope * formants)
    return sound


def shoreline():
    seconds = 34
    track = Track(seconds)
    rng = Random(808)
    low = middle = left_air = right_air = 0
    for frame in range(track.frames):
        t = frame / RATE
        phase = tau * t / seconds
        swell = 0.5 + 0.5 * cos(4 * phase + 0.33 * sin(phase))
        wash = (0.5 + 0.5 * cos(4 * phase - 0.59 + 0.33 * sin(phase))) ** 3
        raw = rng.uniform(-1, 1)
        low += 0.027 * (raw - low)
        middle += (0.11 + 0.18 * wash) * (raw - middle)
        left_air += 0.29 * (rng.uniform(-1, 1) - left_air)
        right_air += 0.29 * (rng.uniform(-1, 1) - right_air)
        body = (0.82 * low + 0.26 * (middle - low)) * (0.40 + 0.57 * swell)
        sea_spray = 0.23 + 0.57 * wash
        track.left[frame] = body + 0.22 * sea_spray * left_air
        track.right[frame] = body + 0.22 * sea_spray * right_air
    # Bring the wash across the loop boundary without a jump.
    ramp = round(0.20 * RATE)
    for channel in (track.left, track.right):
        for frame in range(ramp):
            progress = frame / (ramp - 1)
            offset = track.frames - ramp + frame
            channel[offset] = (1 - progress) * channel[offset] + progress * channel[0]
    for at, pitch, pan in [(7.9, 792, 0.54), (20.1, 728, -0.48), (28.6, 843, 0.33)]:
        track.add(gull(0.36, pitch), at, 0.044, pan)
        track.add(gull(0.27, pitch * 0.91), at + 0.39, 0.036, pan + 0.08)
    track.encode("shoreline-loop.mp3", "Sunset Strip Shoreline", "96k", 0.56)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sunset()
    shoreline()
    for filename in ("sunset-loop.mp3", "shoreline-loop.mp3"):
        print(f"{filename}: {(OUTPUT / filename).stat().st_size:,} bytes")
