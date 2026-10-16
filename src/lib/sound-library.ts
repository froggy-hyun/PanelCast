import crypto from 'node:crypto';
import type { SoundAsset } from './types';
import { inspectWavBuffer, wrapPcm16MonoAsWav } from './audio-utils';

interface SoundAssetSeed {
  soundAssetId: string;
  titleKo: string;
  titleEn: string;
  category: string;
  keywordsKo: string[];
  keywordsEn: string[];
  durationMs: number;
  synthFn: (sampleRateHz: number, numSamples: number) => Int16Array;
}

const SAMPLE_RATE_HZ = 24000;

const SEEDS: SoundAssetSeed[] = [
  {
    soundAssetId: 'sfx_system_chime',
    titleKo: '시스템 알림창 팝업음',
    titleEn: 'System Notification Chime',
    category: 'system',
    keywordsKo: ['띠링', '띵', '시스템', '알림', '팝업', '퀘스트', '스킬', '상태창', '레벨업'],
    keywordsEn: ['ding', 'chime', 'system', 'popup', 'notification', 'quest', 'window'],
    durationMs: 420,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const freq = t < 0.16 ? 880 : 1318.5;
        const env = Math.exp(-t * 6.5);
        pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 14000 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_heavy_impact',
    titleKo: '묵직한 타격 및 폭발음',
    titleEn: 'Heavy Impact & Slam',
    category: 'impact',
    keywordsKo: ['쿵', '쾅', '퍼엉', '퍽', '투쾅', '쿠구궁', '충돌', '폭발', '주먹'],
    keywordsEn: ['boom', 'thud', 'slam', 'crash', 'impact', 'punch', 'explosion'],
    durationMs: 520,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 7.2);
        const sub = Math.sin(2 * Math.PI * (110 * Math.exp(-t * 3.5)) * t);
        const noise = Math.sin(i * 12.9898) * 0.35;
        pcm[i] = Math.round((sub * 0.75 + noise) * 18000 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_blade_slash',
    titleKo: '날카로운 검기 및 베기음',
    titleEn: 'Sharp Blade Slash',
    category: 'slash',
    keywordsKo: ['서걱', '챙', '카앙', '베기', '검', '단검', '창', '스윽', '푸슉'],
    keywordsEn: ['slash', 'slice', 'clang', 'sword', 'blade', 'cut'],
    durationMs: 360,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n) * Math.exp(-t * 4.5);
        const sweep = Math.sin(2 * Math.PI * (600 + t * 2400) * t);
        pcm[i] = Math.round(sweep * 13000 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_wind_whoosh',
    titleKo: '빠른 돌진 및 바람 가르는 소리',
    titleEn: 'Fast Dash & Wind Whoosh',
    category: 'whoosh',
    keywordsKo: ['휙', '휘익', '슈욱', '팟', '파앗', '돌진', '회피', '도약', '바람'],
    keywordsEn: ['whoosh', 'swish', 'dash', 'dodge', 'leap', 'wind'],
    durationMs: 380,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n);
        const tone = Math.sin(2 * Math.PI * (240 + 320 * env) * t);
        pcm[i] = Math.round(tone * 11500 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_footsteps_urgent',
    titleKo: '다급한 발걸음 소리',
    titleEn: 'Urgent Footsteps',
    category: 'footsteps',
    keywordsKo: ['터벅', '타탓', '뚜벅', '발소리', '달리기', '걸음', '성큼'],
    keywordsEn: ['step', 'footsteps', 'running', 'walk', 'dash'],
    durationMs: 480,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const localT = t % 0.16;
        const env = Math.exp(-localT * 24);
        const thump = Math.sin(2 * Math.PI * 145 * localT);
        pcm[i] = Math.round(thump * 15000 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_heartbeat_tension',
    titleKo: '긴박한 심장 박동음',
    titleEn: 'Tense Heartbeat Pulse',
    category: 'heartbeat',
    keywordsKo: ['두근', '쿵쾅', '심장', '긴장', '덜컥', '불안', '압박'],
    keywordsEn: ['thump', 'heartbeat', 'pulse', 'tension', 'dread'],
    durationMs: 600,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const beat1 = t < 0.22 ? Math.exp(-t * 14) * Math.sin(2 * Math.PI * 68 * t) : 0;
        const beat2 =
          t >= 0.24 && t < 0.5
            ? Math.exp(-(t - 0.24) * 16) * Math.sin(2 * Math.PI * 58 * (t - 0.24))
            : 0;
        pcm[i] = Math.round((beat1 + beat2 * 0.85) * 17000);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_energy_surge',
    titleKo: '마력 각성 및 오라 증폭음',
    titleEn: 'Mana Awakening & Aura Surge',
    category: 'magic',
    keywordsKo: ['우웅', '화아아', '파지지', '스파크', '마력', '오라', '각성', '빛', '스킬발동'],
    keywordsEn: ['hum', 'aura', 'magic', 'awakening', 'spark', 'glow', 'power'],
    durationMs: 560,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n);
        const carrier =
          Math.sin(2 * Math.PI * (220 + t * 180) * t) +
          0.5 * Math.sin(2 * Math.PI * (440 + t * 360) * t);
        pcm[i] = Math.round(carrier * 9500 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_door_creak',
    titleKo: '무거운 문이나 게이트 열리는 소리',
    titleEn: 'Heavy Gate & Door Opening',
    category: 'door',
    keywordsKo: ['끼익', '철컥', '드르륵', '덜컹', '문', '게이트', '던전'],
    keywordsEn: ['creak', 'click', 'door', 'gate', 'unlock'],
    durationMs: 460,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 4.2);
        const mod = Math.sin(2 * Math.PI * 18 * t);
        const wave = Math.sin(2 * Math.PI * (190 + 35 * mod) * t);
        pcm[i] = Math.round(wave * 13500 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_crowd_murmur',
    titleKo: '주변 술렁임 및 정적 속 울림',
    titleEn: 'Ambient Crowd & Echo',
    category: 'crowd',
    keywordsKo: ['웅성', '수군', '술렁', '와아', '함성', '속삭임'],
    keywordsEn: ['murmur', 'crowd', 'chatter', 'whisper'],
    durationMs: 500,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n);
        const chord =
          Math.sin(2 * Math.PI * 165 * t) +
          Math.sin(2 * Math.PI * 207.65 * t) +
          Math.sin(2 * Math.PI * 246.94 * t);
        pcm[i] = Math.round((chord / 3) * 11000 * env);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_glass_shatter',
    titleKo: '유리 파편 및 결계 파열음',
    titleEn: 'Barrier & Glass Shatter',
    category: 'shatter',
    keywordsKo: ['쨍그랑', '파창', '와장창', '금이', '균열', '깨짐', '파편'],
    keywordsEn: ['shatter', 'crack', 'break', 'glass', 'barrier'],
    durationMs: 440,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 8.0);
        const chime =
          Math.sin(2 * Math.PI * 1760 * t) +
          0.7 * Math.sin(2 * Math.PI * 2349 * t) +
          0.5 * Math.sin(2 * Math.PI * 3136 * t);
        pcm[i] = Math.round((chime / 2.2) * 14500 * env);
      }
      return pcm;
    },
  },
];

const SOUND_BUFFER_CACHE = new Map<string, Buffer>();
export const ENSURED_SOUND_LIBRARY: SoundAsset[] = [];

function initializeLibrarySynchronously() {
  if (ENSURED_SOUND_LIBRARY.length > 0) return;

  for (const seed of SEEDS) {
    const numSamples = Math.max(1, Math.round((seed.durationMs / 1000) * SAMPLE_RATE_HZ));
    const samples = seed.synthFn(SAMPLE_RATE_HZ, numSamples);
    const pcmBuf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    const wavBuf = wrapPcm16MonoAsWav(pcmBuf, SAMPLE_RATE_HZ);
    const meta = inspectWavBuffer(wavBuf);
    const sha256 = crypto.createHash('sha256').update(wavBuf).digest('hex');

    SOUND_BUFFER_CACHE.set(seed.soundAssetId, wavBuf);
    ENSURED_SOUND_LIBRARY.push({
      soundAssetId: seed.soundAssetId,
      titleKo: seed.titleKo,
      titleEn: seed.titleEn,
      category: seed.category,
      keywordsKo: seed.keywordsKo,
      keywordsEn: seed.keywordsEn,
      license: 'CC0-1.0',
      mimeType: 'audio/wav',
      durationMs: meta.durationMs || seed.durationMs,
      sampleRateHz: meta.sampleRateHz || SAMPLE_RATE_HZ,
      byteSize: wavBuf.byteLength,
      sha256,
    });
  }
}

initializeLibrarySynchronously();

export async function ensureSoundLibraryLoaded(): Promise<SoundAsset[]> {
  initializeLibrarySynchronously();
  return ENSURED_SOUND_LIBRARY;
}

export function getSoundAssetBuffer(soundAssetId: string): Buffer | null {
  initializeLibrarySynchronously();
  return SOUND_BUFFER_CACHE.get(soundAssetId) ?? null;
}

// 의성어/효과음 텍스트를 검증된 사운드 라이브러리와 매칭하고 신뢰도가 낮으면 text_only 폴백
export function resolveSoundEffectAsset(params: {
  rawTextKo: string;
  meaningKo: string;
  meaningEn: string;
  suggestedCategory?: string;
  confidence?: number;
}): {
  asset?: SoundAsset;
  fallbackMode: 'sound_effect' | 'text_only';
  matchedScore: number;
} {
  initializeLibrarySynchronously();
  const combinedKo = `${params.rawTextKo} ${params.meaningKo}`.toLowerCase();
  const combinedEn = `${params.meaningEn} ${params.suggestedCategory ?? ''}`.toLowerCase();
  const conf = params.confidence ?? 0.85;

  if (conf < 0.6) {
    return { fallbackMode: 'text_only', matchedScore: 0 };
  }

  let bestAsset: SoundAsset | undefined;
  let bestScore = 0;

  for (const asset of ENSURED_SOUND_LIBRARY) {
    let score = 0;
    if (params.suggestedCategory && asset.category === params.suggestedCategory.toLowerCase()) {
      score += 3;
    }
    for (const kw of asset.keywordsKo) {
      if (combinedKo.includes(kw.toLowerCase())) {
        score += 2;
      }
    }
    for (const kw of asset.keywordsEn) {
      if (combinedEn.includes(kw.toLowerCase())) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAsset = asset;
    }
  }

  if (bestAsset && bestScore >= 2) {
    return {
      asset: bestAsset,
      fallbackMode: 'sound_effect',
      matchedScore: bestScore,
    };
  }

  return {
    fallbackMode: 'text_only',
    matchedScore: bestScore,
  };
}
