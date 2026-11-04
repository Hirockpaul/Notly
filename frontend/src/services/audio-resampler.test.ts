import { describe, expect, it } from "vitest";

import { float32ToPcm16, resampleAudio } from "./audio-resampler";

describe("float32ToPcm16", () => {
  it("clips samples and converts the full signed 16-bit range", () => {
    const result = float32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]));
    expect(Array.from(result)).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  });
});

describe("resampleAudio", () => {
  it("resamples 500 milliseconds from 48 kHz to 16 kHz", () => {
    const result = resampleAudio(new Float32Array(24000), 48000, 16000);
    expect(result).toHaveLength(8000);
  });

  it("uses linear interpolation when changing sample rates", () => {
    const result = resampleAudio(new Float32Array([0, 1, 0, -1]), 4, 8);
    expect(Array.from(result)).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
  });

  it("rejects invalid sample rates", () => {
    expect(() => resampleAudio(new Float32Array([0]), 0, 16000)).toThrow(RangeError);
  });
});
