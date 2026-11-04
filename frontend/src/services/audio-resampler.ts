const PCM_16_MAX = 0x7fff;
const PCM_16_MIN = -0x8000;

export function resampleAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new RangeError("Sample rates must be positive numbers.");
  }

  if (samples.length === 0 || sourceSampleRate === targetSampleRate) {
    return samples.slice();
  }

  const outputLength = Math.max(
    1,
    Math.round(samples.length * (targetSampleRate / sourceSampleRate)),
  );
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), samples.length - 1);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const fraction = sourcePosition - leftIndex;
    output[index] = samples[leftIndex] + (samples[rightIndex] - samples[leftIndex]) * fraction;
  }

  return output;
}

export function float32ToPcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? Math.round(sample * -PCM_16_MIN) : Math.round(sample * PCM_16_MAX);
  }

  return output;
}
