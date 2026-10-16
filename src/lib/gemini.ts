import crypto from 'node:crypto';
import sharp from 'sharp';
import { GoogleGenAI, Type, Modality, ThinkingLevel } from '@google/genai';
import type { LocaleCode, TileAnalysisResult } from './types';
import { ensureValidWavBuffer, inspectWavBuffer, wrapPcm16MonoAsWav } from './audio-utils';

const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-4-argon';
const DEFAULT_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const FALLBACK_TTS_MODEL = process.env.GEMINI_TTS_FALLBACK_MODEL || 'gemini-3.8-flash-lite-tts';

function getGenAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// 결정론적 음향 합성 폴백 (테스트 환경 또는 네트워크 단절 시에도 유효한 RIFF WAV 보장)
function generateDeterministicSpeechWav(text: string, voiceName: string): {
  wavBuffer: Buffer;
  durationMs: number;
  sampleRateHz: number;
  sha256: string;
} {
  const sampleRateHz = 24000;
  const charCount = Math.max(4, text.trim().length);
  const durationMs = Math.min(4800, Math.max(480, charCount * 55));
  const numSamples = Math.round((durationMs / 1000) * sampleRateHz);
  const pcm = new Int16Array(numSamples);

  const hash = crypto.createHash('sha256').update(`${voiceName}:${text}`).digest();
  const baseFreq = 135 + (hash[0] % 110);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRateHz;
    const syllableEnv = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.5 * t);
    const fade =
      i < 480 ? i / 480 : i > numSamples - 720 ? (numSamples - i) / 720 : 1.0;
    const wave =
      0.65 * Math.sin(2 * Math.PI * baseFreq * t) +
      0.25 * Math.sin(2 * Math.PI * (baseFreq * 1.5) * t) +
      0.1 * Math.sin(2 * Math.PI * (baseFreq * 2.0) * t);
    pcm[i] = Math.round(wave * syllableEnv * fade * 9000);
  }

  const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const wavBuffer = wrapPcm16MonoAsWav(pcmBuf, sampleRateHz);
  const sha256 = crypto.createHash('sha256').update(wavBuffer).digest('hex');

  return {
    wavBuffer,
    durationMs,
    sampleRateHz,
    sha256,
  };
}

// Gemini 멀티모달 타일 분석: 컷 경계, 시각 장면 해설, 화자별 대사, 시스템 창, 효과음 추출
export async function analyzeTileWithGemini(params: {
  tileBuffer: Buffer;
  mimeType: string;
  tileIndex: number;
  totalTiles: number;
  episodeTitleKo: string;
}): Promise<{
  result: TileAnalysisResult;
  latencyMs: number;
  modelId: string;
}> {
  const startedAt = Date.now();
  const ai = getGenAiClient();

  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured for tile analysis.');
  }

  let optimizedBuffer = params.tileBuffer;
  let optimizedMimeType = params.mimeType;
  try {
    optimizedBuffer = await sharp(params.tileBuffer)
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    optimizedMimeType = 'image/jpeg';
  } catch {
    // 합성 테스트 버퍼인 경우 원본 유지
  }

  const prompt = `당신은 시각장애인 독자를 위한 배리어프리 웹툰 오디오북 연출가입니다.
제공된 이미지는 웹툰 "${params.episodeTitleKo}"의 전체 ${params.totalTiles}개 세로 타일 중 ${params.tileIndex + 1}번째 타일입니다.

이 타일 이미지에 포함된 웹툰 장면들을 위에서 아래 순서대로 분석하여 핵심적인 2~3개의 주요 장면 컷(panels)으로 응집력 있게 구성해 JSON으로 반환하세요.
규칙:
1. 각 컷의 bbox는 타일 내부 상대 좌표(x: 0~1000, y: 0~1000, width: 100~1000, height: 80~1000)로 표기하세요.
2. visualSummaryKo / visualSummaryEn: 시각장애인 독자가 인물의 표정, 동작, 배경 분위기, 구도를 생생히 그릴 수 있도록 품위 있고 자연스러운 한두 문장으로 서술하세요.
3. segments: 각 컷 안에서 가장 중요한 말풍선 대사(dialogue), 내레이션(narration), 게임/시스템 상태창 팝업(system_popup), 주요 효과음(sfx)을 위에서 아래 읽기 순서대로 최대 1~3개 이내로 핵심만 추출하세요(동일 화자의 연속 말풍선은 자연스럽게 한 세그먼트로 묶어 호흡을 살리세요).
4. 대사의 화자(speakerKey, speakerNameKo, speakerNameEn)를 문맥과 그림을 통해 일관되게 지정하세요(예: 주인공 강진혁은 speakerKey="kang_jinhyuk", speakerNameKo="강진혁", speakerNameEn="Kang Jinhyuk"). 만약 해당 컷 시점에서 아직 정체가 밝혀지지 않은 인물이라면 isIdentityRevealedInThisCut=false로 설정하고 unrevealedLabelKo(예: "정체불명의 목소리", "검은 그림자")와 unrevealedLabelEn을 지정하세요.
5. 한국어 원문을 충실히 읽고, 자연스러운 영어 번역(textEn, visualSummaryEn)을 빈 문자열 없이 함께 작성하세요.`;

  let parsed: TileAnalysisResult | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model: DEFAULT_VISION_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: optimizedMimeType,
                    data: optimizedBuffer.toString('base64'),
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: {
            temperature: 0.2,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              required: ['panels'],
              properties: {
                panels: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: [
                      'localPanelIndex',
                      'bbox',
                      'visualSummaryKo',
                      'visualSummaryEn',
                      'emotionalToneKo',
                      'emotionalToneEn',
                      'continuityNote',
                      'segments',
                    ],
                    properties: {
                      localPanelIndex: { type: Type.INTEGER },
                      bbox: {
                        type: Type.OBJECT,
                        required: ['x', 'y', 'width', 'height'],
                        properties: {
                          x: { type: Type.NUMBER },
                          y: { type: Type.NUMBER },
                          width: { type: Type.NUMBER },
                          height: { type: Type.NUMBER },
                        },
                      },
                      visualSummaryKo: { type: Type.STRING },
                      visualSummaryEn: { type: Type.STRING },
                      emotionalToneKo: { type: Type.STRING },
                      emotionalToneEn: { type: Type.STRING },
                      continuityNote: { type: Type.STRING },
                      segments: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          required: [
                            'kind',
                            'speakerKey',
                            'speakerNameKo',
                            'speakerNameEn',
                            'textKo',
                            'textEn',
                            'deliveryStyleKo',
                            'deliveryStyleEn',
                          ],
                          properties: {
                            kind: {
                              type: Type.STRING,
                              enum: ['dialogue', 'narration', 'sfx', 'system_popup'],
                            },
                            speakerKey: { type: Type.STRING },
                            speakerNameKo: { type: Type.STRING },
                            speakerNameEn: { type: Type.STRING },
                            isIdentityRevealedInThisCut: { type: Type.BOOLEAN },
                            unrevealedLabelKo: { type: Type.STRING },
                            unrevealedLabelEn: { type: Type.STRING },
                            genderHint: {
                              type: Type.STRING,
                              enum: ['male', 'female', 'neutral'],
                            },
                            ageHint: {
                              type: Type.STRING,
                              enum: ['child', 'teen', 'young_adult', 'middle_aged', 'elder'],
                            },
                            textKo: { type: Type.STRING },
                            textEn: { type: Type.STRING },
                            deliveryStyleKo: { type: Type.STRING },
                            deliveryStyleEn: { type: Type.STRING },
                            suggestedSfxCategory: { type: Type.STRING },
                            sfxConfidence: { type: Type.NUMBER },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Vision tile ${params.tileIndex + 1} timeout`)), 25000),
        ),
      ]);

      const rawText = response.text?.trim() || '{"panels":[]}';
      parsed = JSON.parse(rawText) as TileAnalysisResult;
      break;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.warn(
          `[Gemini Vision] Tile ${params.tileIndex + 1}/${params.totalTiles} timed out after ${maxAttempts} attempts; using continuity fallback.`,
        );
      }
    }
  }

  if (!parsed || !Array.isArray(parsed.panels) || parsed.panels.length === 0) {
    parsed = {
      panels: [
        {
          localPanelIndex: 0,
          bbox: { x: 0, y: 0, width: 1000, height: 1000 },
          visualSummaryKo: `${params.tileIndex + 1}번째 구간에서 긴장감 있는 전개와 함께 장면이 이어집니다.`,
          visualSummaryEn: `The tense scene sequence continues across section ${params.tileIndex + 1}.`,
          emotionalToneKo: '긴박하고 집중된 호흡',
          emotionalToneEn: 'Tense and focused pacing',
          continuityNote: 'Fallback panel for transition strip',
          segments: [],
        },
      ],
    };
  }

  return {
    result: parsed,
    latencyMs: Date.now() - startedAt,
    modelId: DEFAULT_VISION_MODEL,
  };
}

import { execSync } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';

let liveTtsCallIndex = 0;
const modelCooldownUntilMs = new Map<string, number>();
let cachedCloudAccessToken: { token: string; expiresAtMs: number } | null = null;
const cloudAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// 대사 본문에서 혹시라도 섞여 들어간 연기 지시문 래퍼를 완전히 제거하여 순수 대사만 추출
export function stripActingDirectionsFromSpokenText(raw: string): string {
  let text = raw.trim();
  text = text.replace(
    /^\[(?:연기\s*지시|Acting\s*Direction)[^\]]*\]\s*(?:다음\s*대사를[^:]*:\s*|Perform\s*only\s*the\s*spoken\s*line[^:]*:\s*)?/i,
    '',
  );
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('“') && text.endsWith('”'))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.trim();
}

async function getCloudTtsAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedCloudAccessToken && cachedCloudAccessToken.expiresAtMs > now + 30_000) {
    return cachedCloudAccessToken.token;
  }

  try {
    const client = await cloudAuth.getClient();
    const tokenRes = await client.getAccessToken();
    if (tokenRes?.token) {
      cachedCloudAccessToken = {
        token: tokenRes.token,
        expiresAtMs: now + 45 * 60_000,
      };
      return tokenRes.token;
    }
  } catch {
    // 로컬 개발 환경에서는 gcloud CLI 토큰 폴백 시도
  }

  try {
    const cliToken = execSync('gcloud auth print-access-token', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).trim();
    if (cliToken) {
      cachedCloudAccessToken = {
        token: cliToken,
        expiresAtMs: now + 30 * 60_000,
      };
      return cliToken;
    }
  } catch {
    // 인증 토큰 없음
  }

  return null;
}

const NEURAL2_VOICE_MAP: Record<
  string,
  {
    ko: { name: string; pitch: number; rate: number };
    en: { name: string; pitch: number; rate: number };
  }
> = {
  Kore: {
    ko: { name: 'ko-KR-Neural2-A', pitch: -0.6, rate: 1.0 },
    en: { name: 'en-US-Neural2-C', pitch: 0.0, rate: 1.0 },
  },
  Puck: {
    ko: { name: 'ko-KR-Neural2-C', pitch: 1.2, rate: 1.04 },
    en: { name: 'en-US-Neural2-D', pitch: 1.0, rate: 1.04 },
  },
  Charon: {
    ko: { name: 'ko-KR-Neural2-C', pitch: -4.0, rate: 0.94 },
    en: { name: 'en-US-Neural2-J', pitch: -3.5, rate: 0.94 },
  },
  Zephyr: {
    ko: { name: 'ko-KR-Neural2-B', pitch: 0.8, rate: 1.02 },
    en: { name: 'en-US-Neural2-F', pitch: 0.8, rate: 1.02 },
  },
  Fenrir: {
    ko: { name: 'ko-KR-Neural2-C', pitch: -1.8, rate: 1.07 },
    en: { name: 'en-US-Neural2-I', pitch: -1.5, rate: 1.07 },
  },
  Aoede: {
    ko: { name: 'ko-KR-Neural2-A', pitch: 2.0, rate: 1.05 },
    en: { name: 'en-US-Neural2-E', pitch: 1.5, rate: 1.05 },
  },
  Leda: {
    ko: { name: 'ko-KR-Neural2-B', pitch: -1.2, rate: 0.96 },
    en: { name: 'en-US-Neural2-H', pitch: -1.0, rate: 0.96 },
  },
  Orus: {
    ko: { name: 'ko-KR-Neural2-C', pitch: 0.0, rate: 1.0 },
    en: { name: 'en-US-Neural2-A', pitch: 0.0, rate: 1.0 },
  },
};

async function synthesizeWithCloudNeural2Tts(params: {
  spokenText: string;
  voiceName: string;
  locale: LocaleCode;
  speakingRate?: number;
}): Promise<{
  wavBuffer: Buffer;
  durationMs: number;
  sampleRateHz: number;
  sha256: string;
  modelId: string;
} | null> {
  const token = await getCloudTtsAccessToken();
  if (!token) return null;

  const profile = NEURAL2_VOICE_MAP[params.voiceName] ?? NEURAL2_VOICE_MAP.Kore;
  const target = params.locale === 'ko' ? profile.ko : profile.en;
  const languageCode = params.locale === 'ko' ? 'ko-KR' : 'en-US';
  const rate = Math.max(
    0.75,
    Math.min(1.35, Number(((params.speakingRate ?? 1.0) * target.rate).toFixed(2))),
  );
  const projectId = process.env.GCP_PROJECT_ID || 'h2gdm-hack26icn-2669';

  try {
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': projectId,
      },
      body: JSON.stringify({
        input: { text: params.spokenText },
        voice: {
          languageCode,
          name: target.name,
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 24000,
          speakingRate: rate,
          pitch: target.pitch,
        },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return null;

    const rawBuf = Buffer.from(data.audioContent, 'base64');
    const wavBuffer = ensureValidWavBuffer(rawBuf, 'audio/wav');
    const inspected = inspectWavBuffer(wavBuffer);
    if (!inspected.isValidWav || inspected.durationMs <= 0) {
      return null;
    }
    const sha256 = crypto.createHash('sha256').update(wavBuffer).digest('hex');
    return {
      wavBuffer,
      durationMs: inspected.durationMs,
      sampleRateHz: inspected.sampleRateHz,
      sha256,
      modelId: `cloud-tts-${target.name}`,
    };
  } catch {
    return null;
  }
}

// Gemini 다중 보이스 TTS 합성 (연기 지시문은 절대 텍스트에 포함하지 않고 순수 대사만 전달)
export async function synthesizeSegmentTtsWithGemini(params: {
  text: string;
  stylePrompt: string;
  voiceName: string;
  locale: LocaleCode;
  speakingRate?: number;
}): Promise<{
  wavBuffer: Buffer;
  durationMs: number;
  sampleRateHz: number;
  sha256: string;
  modelId: string;
}> {
  const ai = getGenAiClient();
  const spokenText = stripActingDirectionsFromSpokenText(params.text);

  if (process.env.PANELCAST_SYNTH_FALLBACK_ONLY === 'true') {
    const fb = generateDeterministicSpeechWav(spokenText, params.voiceName);
    return { ...fb, modelId: 'deterministic-wav-synth' };
  }

  const preferGeminiLive =
    ai && process.env.PANELCAST_PREFER_CLOUD_NEURAL2_TTS !== 'true';

  if (preferGeminiLive) {
    const callIdx = liveTtsCallIndex++;
    const modelsToTry =
      callIdx % 2 === 0
        ? [DEFAULT_TTS_MODEL, FALLBACK_TTS_MODEL]
        : [FALLBACK_TTS_MODEL, DEFAULT_TTS_MODEL];

    for (const modelId of modelsToTry) {
      const cooldownUntil = modelCooldownUntilMs.get(modelId) ?? 0;
      if (Date.now() < cooldownUntil) {
        continue;
      }
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelId,
            // 중요: TTS 모델은 contents의 문자열을 그대로 낭독하므로 오직 순수 대사/해설 본문만 전달
            contents: [{ role: 'user', parts: [{ text: spokenText }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: params.voiceName || 'Kore',
                  },
                },
              },
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TTS request timeout')), 8500),
          ),
        ]);

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const audioPart = parts.find((p) => p.inlineData?.data);

        if (audioPart?.inlineData?.data) {
          const rawBuf = Buffer.from(audioPart.inlineData.data, 'base64');
          const mimeType = audioPart.inlineData.mimeType || 'audio/L16;rate=24000';
          const wavBuffer = ensureValidWavBuffer(rawBuf, mimeType);
          const inspected = inspectWavBuffer(wavBuffer);
          const sha256 = crypto.createHash('sha256').update(wavBuffer).digest('hex');

          if (inspected.isValidWav && inspected.durationMs > 0) {
            return {
              wavBuffer,
              durationMs: inspected.durationMs,
              sampleRateHz: inspected.sampleRateHz,
              sha256,
              modelId,
            };
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          modelCooldownUntilMs.set(modelId, Date.now() + 45_000);
        }
      }
    }
  }

  // Gemini TTS 쿼터 초과 시 Google Cloud Neural2 다중 캐릭터 음성으로 자연스럽게 합성
  const neuralResult = await synthesizeWithCloudNeural2Tts({
    spokenText,
    voiceName: params.voiceName || 'Kore',
    locale: params.locale,
    speakingRate: params.speakingRate,
  });
  if (neuralResult) {
    return neuralResult;
  }

  const fb = generateDeterministicSpeechWav(spokenText, params.voiceName);
  return { ...fb, modelId: 'deterministic-wav-fallback' };
}

