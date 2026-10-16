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

// 결정론적 의사 난수 생성기 (동일 시드에서 항상 동일한 SHA-256 WAV 보장)
function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

// 2차 공진 대역통과/저역통과 필터 (바람, 물결, 타격 질감 합성용)
function applyResonantBandpass(
  input: Float64Array,
  sr: number,
  centerFreqFn: (t: number) => number,
  q: number,
): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const t = i / sr;
    const f0 = Math.max(30, Math.min(sr * 0.45, centerFreqFn(t)));
    const w0 = (2 * Math.PI * f0) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;

    const x0 = input[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

const SEEDS: SoundAssetSeed[] = [
  {
    soundAssetId: 'sfx_system_chime',
    titleKo: '시스템 알림창 팝업음',
    titleEn: 'System Notification Chime',
    category: 'system',
    keywordsKo: ['띠링', '띵', '시스템', '알림', '팝업', '퀘스트', '스킬', '상태창', '레벨업', '입장합니다', '업데이트'],
    keywordsEn: ['ding', 'chime', 'system', 'popup', 'notification', 'quest', 'window', 'update'],
    durationMs: 440,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        // 맑고 절제된 크리스탈 UI 2음 차임 (E5 -> B5 + 배음)
        const isSecondNote = t >= 0.11;
        const localT = isSecondNote ? t - 0.11 : t;
        const f1 = isSecondNote ? 987.77 : 659.25;
        const f2 = f1 * 2;
        const f3 = f1 * 3.01;
        const attack = Math.min(1, localT / 0.006);
        const decay = Math.exp(-localT * (isSecondNote ? 8.5 : 13.0));
        const wave =
          Math.sin(2 * Math.PI * f1 * localT) * 0.68 +
          Math.sin(2 * Math.PI * f2 * localT) * 0.24 +
          Math.sin(2 * Math.PI * f3 * localT) * 0.08;
        pcm[i] = Math.round(wave * attack * decay * 9500);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_heavy_impact',
    titleKo: '묵직한 타격 및 폭발음',
    titleEn: 'Heavy Impact & Slam',
    category: 'impact',
    keywordsKo: ['쿵', '쾅', '퍼엉', '퍽', '빠악', '투쾅', '쿠구궁', '충돌', '폭발', '주먹', '박치기', '격돌', '아수라장'],
    keywordsEn: ['boom', 'thud', 'slam', 'crash', 'impact', 'punch', 'explosion', 'headbutt', 'brawl'],
    durationMs: 480,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1002);
      const rawNoise = new Float64Array(n);
      for (let i = 0; i < n; i++) rawNoise[i] = rng();
      const filteredCrunch = applyResonantBandpass(rawNoise, sr, (t) => 380 * Math.exp(-t * 4.5) + 90, 1.2);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const attack = Math.min(1, t / 0.003);
        const subEnv = Math.exp(-t * 8.5);
        const crunchEnv = Math.exp(-t * 14.0);
        // 초기 어택 피치 드롭(150Hz -> 36Hz) + 저역 크런치 노이즈
        const instPhase = 2 * Math.PI * (36 * t + (114 / 16) * (1 - Math.exp(-16 * t)));
        const sub = Math.sin(instPhase) * subEnv;
        const transientClick = t < 0.012 ? filteredCrunch[i] * 1.8 : 0;
        const mix = sub * 0.72 + filteredCrunch[i] * crunchEnv * 0.45 + transientClick * 0.25;
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(mix * attack * 13500)));
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_blade_slash',
    titleKo: '날카로운 검기 및 베기음',
    titleEn: 'Sharp Blade Slash',
    category: 'slash',
    keywordsKo: ['서걱', '챙', '카앙', '베기', '검', '단검', '창', '푸슉', '참격'],
    keywordsEn: ['slash', 'slice', 'clang', 'sword', 'blade', 'cut', 'dagger'],
    durationMs: 340,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1003);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      // 공기를 가르는 고역 스윕 노이즈 + 금속성 공명
      const airSlice = applyResonantBandpass(noise, sr, (t) => 1200 + 2600 * Math.exp(-t * 9), 2.4);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 9.5);
        const metalRing =
          (Math.sin(2 * Math.PI * 2480 * t) * 0.5 + Math.sin(2 * Math.PI * 3920 * t) * 0.35) *
          Math.exp(-t * 15);
        pcm[i] = Math.round((airSlice[i] * 0.85 + metalRing * 0.4) * env * 11000);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_wind_whoosh',
    titleKo: '빠른 도약 및 바람 가르는 소리',
    titleEn: 'Fast Dash & Wind Whoosh',
    category: 'whoosh',
    keywordsKo: ['화악', '휙', '휘익', '슈욱', '돌진', '회피', '도약', '바람', '뛰어내'],
    keywordsEn: ['whoosh', 'swish', 'dash', 'dodge', 'leap', 'wind', 'jump'],
    durationMs: 380,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1004);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      // 실제 바람을 가르는 대역통과 노이즈 스윕 (사인파 사이렌 배제)
      const windBand = applyResonantBandpass(
        noise,
        sr,
        (t) => 260 + 680 * Math.sin((Math.PI * t) / 0.38),
        1.8,
      );
      const lowAir = applyResonantBandpass(noise, sr, () => 140, 1.1);

      for (let i = 0; i < n; i++) {
        const env = Math.sin((Math.PI * i) / n) ** 1.3;
        const sample = (windBand[i] * 0.78 + lowAir[i] * 0.32) * env;
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(sample * 13000)));
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_footsteps_urgent',
    titleKo: '다급한 질주 발걸음 소리',
    titleEn: 'Urgent Running Footsteps',
    category: 'footsteps',
    keywordsKo: ['타닷', '다다다', '타다닷', '뚜벅', '발소리', '달리기', '질주'],
    keywordsEn: ['footsteps', 'running', 'sprint', 'footfalls'],
    durationMs: 480,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1005);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const soleNoise = applyResonantBandpass(noise, sr, () => 420, 1.6);

      const stepOffsets = [0.02, 0.17, 0.32];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let acc = 0;
        for (let s = 0; s < stepOffsets.length; s++) {
          const dt = t - stepOffsets[s];
          if (dt >= 0 && dt < 0.13) {
            const env = Math.exp(-dt * 28);
            const pitch = s % 2 === 0 ? 115 : 128;
            const heelThud = Math.sin(2 * Math.PI * pitch * dt * Math.exp(-dt * 6));
            acc += (heelThud * 0.65 + soleNoise[i] * 0.45) * env;
          }
        }
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(acc * 11500)));
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_heartbeat_tension',
    titleKo: '긴박한 심장 박동 및 긴장감',
    titleEn: 'Tense Heartbeat Pulse',
    category: 'heartbeat',
    keywordsKo: ['두근', '쿵쾅', '심장', '긴장', '덜컥', '불안', '압박', '슬금', '꿀꺽', '일촉즉발'],
    keywordsEn: ['thump', 'heartbeat', 'pulse', 'tension', 'dread', 'gulp', 'sneak'],
    durationMs: 580,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const beat1 =
          t >= 0.02 && t < 0.22
            ? Math.exp(-(t - 0.02) * 16) * Math.sin(2 * Math.PI * 58 * (t - 0.02))
            : 0;
        const beat2 =
          t >= 0.23 && t < 0.48
            ? Math.exp(-(t - 0.23) * 19) * Math.sin(2 * Math.PI * 49 * (t - 0.23))
            : 0;
        pcm[i] = Math.round((beat1 + beat2 * 0.82) * 12500);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_energy_surge',
    titleKo: '마력 각성 및 신비로운 생성음',
    titleEn: 'Mana Awakening & Mystical Growth',
    category: 'magic',
    keywordsKo: ['우웅', '화아아', '파지지', '스파크', '마력', '오라', '각성', '빛', '스킬발동', '쑤욱', '열매', '자라납니다'],
    keywordsEn: ['hum', 'aura', 'magic', 'awakening', 'spark', 'glow', 'power', 'sprout', 'bloom'],
    durationMs: 520,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1007);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const shimmerAir = applyResonantBandpass(noise, sr, (t) => 900 + t * 1100, 3.0);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n) ** 1.2;
        const fBase = 293.66 + t * 65; // D4 위로 부드럽게 피어오르는 하모닉스
        const warmChord =
          Math.sin(2 * Math.PI * fBase * t) * 0.45 +
          Math.sin(2 * Math.PI * (fBase * 1.5) * t) * 0.3 +
          Math.sin(2 * Math.PI * (fBase * 2.0) * t) * 0.15;
        pcm[i] = Math.round((warmChord + shimmerAir[i] * 0.25) * env * 9200);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_earth_rumble',
    titleKo: '심연의 진동 및 거대 구조물 융기음',
    titleEn: 'Deep Tectonic & Underwater Rumble',
    category: 'rumble',
    keywordsKo: ['쿠쿠쿠', '쿠쿠쿠쿠', '드르르', '우르릉', '진동', '수압', '두둥', '솟구쳐', '지진'],
    keywordsEn: ['rumble', 'tremor', 'vibration', 'pressure', 'quake', 'emerge', 'colossal'],
    durationMs: 560,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1008);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const lowRumble = applyResonantBandpass(noise, sr, (t) => 65 + 25 * Math.sin(2 * Math.PI * 6 * t), 1.4);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n) ** 0.85;
        const subDrone =
          Math.sin(2 * Math.PI * 46 * t + 0.4 * Math.sin(2 * Math.PI * 11 * t)) * 0.6 +
          Math.sin(2 * Math.PI * 69 * t) * 0.25;
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round((subDrone + lowRumble[i] * 0.55) * env * 12000)));
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_water_surge',
    titleKo: '흐르는 물줄기 및 폭포수 수류음',
    titleEn: 'Flowing Water & Waterfall Surge',
    category: 'water',
    keywordsKo: ['촤아악', '쏴아아', '졸졸', '졸졸졸', '물보라', '폭포', '물기둥', '첨벙', '분수', '물속'],
    keywordsEn: ['water', 'splash', 'waterfall', 'stream', 'fountain', 'pour', 'torrent', 'cascade'],
    durationMs: 520,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1009);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      // 자연스러운 수류 포먼트 필터링 (저역 물결 + 중역 물보라)
      const bandLow = applyResonantBandpass(noise, sr, (t) => 340 + 90 * Math.sin(2 * Math.PI * 7 * t), 1.5);
      const bandHigh = applyResonantBandpass(noise, sr, (t) => 1150 + 280 * Math.cos(2 * Math.PI * 11 * t), 1.9);

      for (let i = 0; i < n; i++) {
        const env = Math.sin((Math.PI * i) / n) ** 0.9;
        const sample = (bandLow[i] * 0.65 + bandHigh[i] * 0.45) * env;
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(sample * 11500)));
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_light_tap',
    titleKo: '가벼운 접촉 및 물체 착지 폴리음',
    titleEn: 'Crisp Foley Tap & Stop',
    category: 'foley',
    keywordsKo: ['툭', '툭툭', '척', '데굴', '투두둑', '탁', '팍', '밟아'],
    keywordsEn: ['tap', 'pat', 'roll', 'drop', 'step', 'stomp', 'clatter'],
    durationMs: 280,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1010);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const foleyBand = applyResonantBandpass(noise, sr, () => 520, 2.0);

      // 짧고 절제된 2연타 폴리 사운드 (어깨 툭툭, 발걸음 멈춤 척, 작은 물체 구름 데굴/투두둑)
      const hits = [
        { offset: 0.015, gain: 1.0, pitch: 155 },
        { offset: 0.125, gain: 0.68, pitch: 138 },
      ];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let acc = 0;
        for (const h of hits) {
          const dt = t - h.offset;
          if (dt >= 0 && dt < 0.09) {
            const env = Math.exp(-dt * 38);
            const body = Math.sin(2 * Math.PI * h.pitch * dt * Math.exp(-dt * 8));
            acc += (body * 0.55 + foleyBand[i] * 0.45) * env * h.gain;
          }
        }
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(acc * 10500)));
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
    durationMs: 440,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1011);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const woodRes = applyResonantBandpass(noise, sr, (t) => 280 + 60 * Math.sin(2 * Math.PI * 14 * t), 2.5);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const latchClick = t < 0.035 ? Math.exp(-t * 70) * Math.sin(2 * Math.PI * 920 * t) : 0;
        const env = Math.exp(-t * 5.2);
        pcm[i] = Math.round((latchClick * 0.6 + woodRes[i] * env * 0.7) * 11500);
      }
      return pcm;
    },
  },
  {
    soundAssetId: 'sfx_crowd_murmur',
    titleKo: '도심 인파 및 주변 술렁임',
    titleEn: 'Ambient Crowd Commotion',
    category: 'crowd',
    keywordsKo: ['웅성', '수군', '술렁', '바글', '바글바글', '인파', '소란', '속삭임'],
    keywordsEn: ['murmur', 'crowd', 'chatter', 'whisper', 'commotion', 'bustle'],
    durationMs: 520,
    synthFn: (sr, n) => {
      const pcm = new Int16Array(n);
      const rng = createDeterministicRng(1012);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      // 다중 음성 대역 포먼트 필터링으로 자연스러운 군중 웅성거림 구현 (오르간 화음 배제)
      const formant1 = applyResonantBandpass(noise, sr, (t) => 320 + 55 * Math.sin(2 * Math.PI * 5.5 * t), 2.2);
      const formant2 = applyResonantBandpass(noise, sr, (t) => 640 + 110 * Math.cos(2 * Math.PI * 8.3 * t), 2.6);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * i) / n) ** 0.9;
        const mod = 0.78 + 0.22 * Math.sin(2 * Math.PI * 9 * t);
        const sample = (formant1[i] * 0.65 + formant2[i] * 0.45) * env * mod;
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round(sample * 11000)));
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
      const rng = createDeterministicRng(1013);
      const noise = new Float64Array(n);
      for (let i = 0; i < n; i++) noise[i] = rng();
      const crispBurst = applyResonantBandpass(noise, sr, () => 2800, 1.8);

      const shards = [
        { offset: 0.0, freq: 2150, decay: 18 },
        { offset: 0.045, freq: 3120, decay: 24 },
        { offset: 0.095, freq: 2680, decay: 28 },
        { offset: 0.16, freq: 3640, decay: 32 },
      ];
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let shardSum = 0;
        for (const s of shards) {
          const dt = t - s.offset;
          if (dt >= 0) {
            shardSum += Math.exp(-dt * s.decay) * Math.sin(2 * Math.PI * s.freq * dt);
          }
        }
        const initialCrack = crispBurst[i] * Math.exp(-t * 14);
        pcm[i] = Math.max(-32000, Math.min(32000, Math.round((initialCrack * 0.65 + shardSum * 0.35) * 11500)));
      }
      return pcm;
    },
  },
];

// 순수 태도·호흡 의태어(이미 장면 해설이나 대사 연기에 포함되어 별도 효과음이나 TTS 단어로 읽으면 어색한 표현)
const SILENT_MANNER_OR_BREATH_WORDS = new Set([
  '버럭',
  '허억',
  '허억 허억',
  '헉',
  '하아',
  '후우',
  '움찔',
  '흠칫',
  '씨익',
  '피식',
  '부들',
  '부들부들',
  '덜덜',
  '주춤',
  '멍',
  '빤히',
  '지긋',
  '글썽',
]);

export function isSilentMannerOrBreathSfx(rawTextKo: string): boolean {
  const normalized = rawTextKo
    .replace(/[!?.~,·…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SILENT_MANNER_OR_BREATH_WORDS.has(normalized)) {
    return true;
  }
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((tok) => SILENT_MANNER_OR_BREATH_WORDS.has(tok));
}

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

// 의성어/효과음 텍스트와 장면 맥락을 기반으로 적합한 사운드 에셋을 정밀 매칭
export function resolveSoundEffectAsset(params: {
  rawTextKo: string;
  meaningKo: string;
  meaningEn: string;
  visualContextKo?: string;
  suggestedCategory?: string;
  confidence?: number;
}): {
  asset?: SoundAsset;
  fallbackMode: 'sound_effect' | 'text_only';
  matchedScore: number;
} {
  initializeLibrarySynchronously();
  const rawKo = params.rawTextKo.trim().toLowerCase();

  // 호흡/태도 의태어('허억 허억', '버럭' 등)는 발소리 등 엉뚱한 효과음으로 오매칭하지 않음
  if (isSilentMannerOrBreathSfx(rawKo)) {
    return { fallbackMode: 'text_only', matchedScore: 0 };
  }

  const contextKo = `${params.meaningKo} ${params.visualContextKo ?? ''}`.toLowerCase();
  const contextEn = `${params.meaningEn}`.toLowerCase();
  const conf = params.confidence ?? 0.85;

  if (conf < 0.6) {
    return { fallbackMode: 'text_only', matchedScore: 0 };
  }

  let bestAsset: SoundAsset | undefined;
  let bestScore = 0;

  for (const asset of ENSURED_SOUND_LIBRARY) {
    let keywordScore = 0;

    // 1. 실제 만화 효과음 원문(rawTextKo) 키워드 매칭에 가장 높은 가중치(+5) 부여
    for (const kw of asset.keywordsKo) {
      const targetKw = kw.toLowerCase();
      if (rawKo.includes(targetKw)) {
        keywordScore += 5;
      } else if (contextKo.includes(targetKw)) {
        keywordScore += 2;
      }
    }

    for (const kw of asset.keywordsEn) {
      if (contextEn.includes(kw.toLowerCase())) {
        keywordScore += 2;
      }
    }

    // 2. suggestedCategory는 키워드 근거가 있을 때만 보조 가산점(+1)으로 활용 (단독 오매칭 방지)
    const categoryBonus =
      keywordScore > 0 &&
      params.suggestedCategory &&
      asset.category === params.suggestedCategory.toLowerCase()
        ? 1
        : 0;

    const totalScore = keywordScore + categoryBonus;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestAsset = asset;
    }
  }

  if (bestAsset && bestScore >= 4) {
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
