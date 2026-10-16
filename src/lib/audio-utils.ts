import crypto from 'crypto';

export interface WavInspectionResult {
  isValidWav: boolean;
  sampleRate: number;
  sampleRateHz: number;
  numChannels: number;
  bitsPerSample: number;
  dataByteLength: number;
  durationSec: number;
  durationMs: number;
  peakAmplitude: number; // 0.0 ~ 1.0
  hasClipping: boolean;
  hasExcessiveSilence: boolean;
  sha256: string;
}

// 이미 WAV 헤더가 있는지 검사하고, raw PCM이면 단일 WAV 헤더만 부착 (중복 헤더 부착 금지)
export function ensureValidWavBuffer(
  rawBuffer: Buffer,
  mimeType: string = 'audio/wav',
  defaultSampleRate: number = 24000
): Buffer {
  if (
    rawBuffer.length >= 44 &&
    rawBuffer.toString('ascii', 0, 4) === 'RIFF' &&
    rawBuffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return rawBuffer;
  }

  let sampleRate = defaultSampleRate;
  const rateMatch = mimeType.match(/rate=(\d+)/i);
  if (rateMatch) {
    const parsed = parseInt(rateMatch[1], 10);
    if (parsed >= 8000 && parsed <= 96000) {
      sampleRate = parsed;
    }
  }

  const evenLength = rawBuffer.length % 2 === 0 ? rawBuffer.length : rawBuffer.length - 1;
  const pcmData = rawBuffer.subarray(0, evenLength);
  return wrapPcm16MonoAsWav(pcmData, sampleRate);
}

export function wrapPcm16MonoAsWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// WAV 바이트 헤더·길이·음량·클리핑 검사
export function inspectWavBuffer(buffer: Buffer): WavInspectionResult {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return {
      isValidWav: false,
      sampleRate: 0,
      sampleRateHz: 0,
      numChannels: 0,
      bitsPerSample: 0,
      dataByteLength: 0,
      durationSec: 0,
      durationMs: 0,
      peakAmplitude: 0,
      hasClipping: false,
      hasExcessiveSilence: true,
      sha256,
    };
  }

  let offset = 12;
  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataByteLength = buffer.length - 44;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 24 <= buffer.length) {
      numChannels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataByteLength = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  const bytesPerSample = Math.max(1, (bitsPerSample / 8) * numChannels);
  const totalFrames = Math.floor(dataByteLength / bytesPerSample);
  const durationSec = sampleRate > 0 ? Number((totalFrames / sampleRate).toFixed(2)) : 0;
  const durationMs = sampleRate > 0 ? Math.round((totalFrames / sampleRate) * 1000) : 0;

  let maxSample = 0;
  let clippedSamples = 0;
  let silentFrames = 0;
  const total16Samples = Math.floor(dataByteLength / 2);

  if (bitsPerSample === 16 && total16Samples > 0) {
    for (let i = 0; i < total16Samples; i++) {
      const pos = dataOffset + i * 2;
      if (pos + 2 > buffer.length) break;
      const val = Math.abs(buffer.readInt16LE(pos));
      if (val > maxSample) maxSample = val;
      if (val >= 32700) clippedSamples++;
      if (val < 120) silentFrames++;
    }
  }

  const peakAmplitude = Number((maxSample / 32768).toFixed(4));
  const hasClipping = total16Samples > 0 && clippedSamples / total16Samples > 0.005;
  const hasExcessiveSilence = total16Samples > 0 && silentFrames / total16Samples > 0.96;

  return {
    isValidWav: durationSec > 0.05 && dataByteLength > 0,
    sampleRate,
    sampleRateHz: sampleRate,
    numChannels,
    bitsPerSample,
    dataByteLength,
    durationSec,
    durationMs,
    peakAmplitude,
    hasClipping,
    hasExcessiveSilence,
    sha256,
  };
}

// 과도한 피크 클리핑 방지용 소프트 노멀라이저 (필요 시 적용)
export function normalizeWavBuffer(buffer: Buffer, targetPeak: number = 0.82): Buffer {
  const info = inspectWavBuffer(buffer);
  if (!info.isValidWav || info.bitsPerSample !== 16 || info.peakAmplitude <= 0.01) {
    return buffer;
  }
  if (info.peakAmplitude <= 0.92 && info.peakAmplitude >= 0.25) {
    return buffer;
  }

  const out = Buffer.from(buffer);
  const scale = Math.min(2.5, (targetPeak * 32767) / (info.peakAmplitude * 32768));
  const dataStart = out.length - info.dataByteLength;
  const count = Math.floor(info.dataByteLength / 2);
  for (let i = 0; i < count; i++) {
    const pos = dataStart + i * 2;
    const raw = out.readInt16LE(pos);
    const scaled = Math.max(-32600, Math.min(32600, Math.round(raw * scale)));
    out.writeInt16LE(scaled, pos);
  }
  return out;
}
