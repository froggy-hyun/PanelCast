import type { Character, DeduplicatedPanel, LocaleCode, Panel } from './types';

export interface PrebuiltVoiceMetadata {
  voiceName: string;
  genderHint: 'male' | 'female' | 'neutral';
  timbreKo: string;
  timbreEn: string;
}

export const PREBUILT_VOICES: PrebuiltVoiceMetadata[] = [
  {
    voiceName: 'Kore',
    genderHint: 'neutral',
    timbreKo: '차분하고 신뢰감 있는 내레이터 보이스',
    timbreEn: 'Calm and authoritative narrator voice',
  },
  {
    voiceName: 'Puck',
    genderHint: 'male',
    timbreKo: '젊고 기민한 청년 주인공 보이스',
    timbreEn: 'Agile and energetic young male lead voice',
  },
  {
    voiceName: 'Charon',
    genderHint: 'male',
    timbreKo: '중후하고 위압감 있는 저음 보이스',
    timbreEn: 'Deep and commanding baritone voice',
  },
  {
    voiceName: 'Zephyr',
    genderHint: 'female',
    timbreKo: '맑고 단단한 여성 주연 보이스',
    timbreEn: 'Clear and resolute female lead voice',
  },
  {
    voiceName: 'Fenrir',
    genderHint: 'male',
    timbreKo: '거칠고 강렬한 전투/라이벌 보이스',
    timbreEn: 'Fierce and intense warrior voice',
  },
  {
    voiceName: 'Aoede',
    genderHint: 'female',
    timbreKo: '신비롭고 지적인 여성/시스템 보이스',
    timbreEn: 'Mystical and poised female/system voice',
  },
  {
    voiceName: 'Leda',
    genderHint: 'female',
    timbreKo: '부드럽고 따뜻한 감성 보이스',
    timbreEn: 'Warm and expressive emotional voice',
  },
  {
    voiceName: 'Orus',
    genderHint: 'male',
    timbreKo: '단호하고 냉철한 전략가 보이스',
    timbreEn: 'Sharp and composed strategist voice',
  },
];

function normalizeSpeakerKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s\-_()[\]{}.,!?'"“”‘’]+/g, '')
    .trim();
}

// 다중 등장인물 자동 캐스팅 및 스포일러 보호 시점(revealedAtPanelId) 추론 (T03)
export function reconcileEpisodeCast(params: {
  episodeId: string;
  revisionId: string;
  panels: DeduplicatedPanel[];
  existingCharacters?: Character[];
}): {
  characters: Character[];
  speakerKeyToCharacterId: Record<string, string>;
  voicePoolExhausted: boolean;
} {
  const characters: Character[] = [];
  const speakerKeyToCharacterId: Record<string, string> = {};

  // 기존 캐릭터 보존 매핑
  const existingByKey = new Map<string, Character>();
  for (const existing of params.existingCharacters ?? []) {
    existingByKey.set(normalizeSpeakerKey(existing.canonicalNameKo), existing);
    existingByKey.set(normalizeSpeakerKey(existing.canonicalNameEn), existing);
    for (const alias of existing.aliases) {
      existingByKey.set(normalizeSpeakerKey(alias), existing);
    }
  }

  // 1. 기본 해설(Narrator) 및 시스템 알림창(System) 캐릭터 등록
  const ensureNarrator = (): Character => {
    const existingNarrator =
      existingByKey.get(normalizeSpeakerKey('해설')) ||
      existingByKey.get(normalizeSpeakerKey('narrator'));
    if (existingNarrator) {
      return existingNarrator;
    }
    return {
      characterId: 'char_narrator',
      episodeId: params.episodeId,
      revisionId: params.revisionId,
      canonicalNameKo: '해설',
      canonicalNameEn: 'Narrator',
      aliases: ['해설', '내레이션', 'narrator', 'narration'],
      unrevealedLabelKo: '해설',
      unrevealedLabelEn: 'Narrator',
      genderHint: 'neutral',
      ageHint: 'young_adult',
      voiceProfile: {
        voiceProfileId: 'vp_narrator',
        koVoiceName: 'Kore',
        enVoiceName: 'Kore',
        stylePromptKo: '웹툰의 공간감과 인물의 긴장감을 또렷하게 전달하는 차분한 해설 톤',
        stylePromptEn: 'Calm, vivid cinematic narration conveying scene depth and tension',
        speakingRate: 1.0,
        pitchSemitones: 0,
      },
    };
  };

  const narratorChar = ensureNarrator();
  characters.push(narratorChar);
  speakerKeyToCharacterId['narrator'] = narratorChar.characterId;
  speakerKeyToCharacterId['해설'] = narratorChar.characterId;

  const usedVoiceCount = new Map<string, number>();
  usedVoiceCount.set(narratorChar.voiceProfile.koVoiceName, 1);

  const startedUnrevealed = new Set<string>();
  let dynamicCharCounter = 1;
  let voicePoolExhausted = false;

  for (let pIdx = 0; pIdx < params.panels.length; pIdx++) {
    const panel = params.panels[pIdx];
    const panelId = `panel_${String(pIdx + 1).padStart(3, '0')}`;

    for (const seg of panel.segments) {
      if (seg.kind === 'narration') {
        speakerKeyToCharacterId[seg.speakerKey] = narratorChar.characterId;
        continue;
      }

      if (seg.kind === 'system_popup') {
        let sysChar = characters.find((c) => c.characterId === 'char_system');
        if (!sysChar) {
          sysChar = existingByKey.get('system') ?? {
            characterId: 'char_system',
            episodeId: params.episodeId,
            revisionId: params.revisionId,
            canonicalNameKo: '시스템 알림',
            canonicalNameEn: 'System Window',
            aliases: ['system', '시스템', '상태창', '알림창'],
            unrevealedLabelKo: '시스템 알림',
            unrevealedLabelEn: 'System Window',
            genderHint: 'female',
            ageHint: 'young_adult',
            voiceProfile: {
              voiceProfileId: 'vp_system',
              koVoiceName: 'Aoede',
              enVoiceName: 'Aoede',
              stylePromptKo: '정확하고 명료한 게임 시스템 인터페이스 안내 음성',
              stylePromptEn: 'Crisp, resonant game system notification voice',
              speakingRate: 1.04,
              pitchSemitones: 1,
            },
          };
          characters.push(sysChar);
          usedVoiceCount.set(
            sysChar.voiceProfile.koVoiceName,
            (usedVoiceCount.get(sysChar.voiceProfile.koVoiceName) ?? 0) + 1,
          );
        }
        speakerKeyToCharacterId[seg.speakerKey] = sysChar.characterId;
        continue;
      }

      const rawKey = seg.speakerKey || seg.speakerNameKo || 'unknown';
      const normKey = normalizeSpeakerKey(rawKey);
      const normKo = normalizeSpeakerKey(seg.speakerNameKo || rawKey);

      let matched = characters.find(
        (c) =>
          normalizeSpeakerKey(c.canonicalNameKo) === normKo ||
          c.aliases.some(
            (a) => normalizeSpeakerKey(a) === normKey || normalizeSpeakerKey(a) === normKo,
          ),
      );

      if (!matched) {
        const fromExisting = existingByKey.get(normKey) || existingByKey.get(normKo);
        if (fromExisting && !characters.some((c) => c.characterId === fromExisting.characterId)) {
          matched = fromExisting;
          characters.push(matched);
        }
      }

      if (!matched) {
        while (
          characters.some(
            (c) => c.characterId === `char_${String(dynamicCharCounter).padStart(2, '0')}`,
          ) ||
          (params.existingCharacters ?? []).some(
            (c) => c.characterId === `char_${String(dynamicCharCounter).padStart(2, '0')}`,
          )
        ) {
          dynamicCharCounter += 1;
        }
        const charId = `char_${String(dynamicCharCounter).padStart(2, '0')}`;
        dynamicCharCounter += 1;

        const gender = seg.genderHint ?? 'male';
        const candidatePool = PREBUILT_VOICES.filter(
          (v) => v.voiceName !== 'Kore' && (v.genderHint === gender || v.genderHint === 'neutral'),
        );
        const pool = candidatePool.length > 0 ? candidatePool : PREBUILT_VOICES;

        // 아직 사용되지 않은 보이스 우선 배정
        let chosenVoice = pool.find((v) => !usedVoiceCount.has(v.voiceName));
        let speakingRate = 1.0;
        let pitchSemitones = 0;

        if (!chosenVoice) {
          voicePoolExhausted = true;
          chosenVoice = pool[(dynamicCharCounter - 1) % pool.length];
          const reuseTimes = usedVoiceCount.get(chosenVoice.voiceName) ?? 1;
          speakingRate = Number((1.0 + ((reuseTimes % 3) - 1) * 0.08).toFixed(2));
          pitchSemitones = reuseTimes % 2 === 0 ? 2 : -2;
        }

        usedVoiceCount.set(
          chosenVoice.voiceName,
          (usedVoiceCount.get(chosenVoice.voiceName) ?? 0) + 1,
        );

        const nameKo = (seg.speakerNameKo || rawKey || `등장인물 ${dynamicCharCounter}`).trim();
        const nameEn = (seg.speakerNameEn || nameKo).trim();
        const unrevealedKo = (seg.unrevealedLabelKo || '정체불명의 목소리').trim();
        const unrevealedEn = (seg.unrevealedLabelEn || 'Mysterious Voice').trim();
        const startsHidden = seg.isIdentityRevealedInThisCut === false;

        if (startsHidden) {
          startedUnrevealed.add(charId);
        }

        matched = {
          characterId: charId,
          episodeId: params.episodeId,
          revisionId: params.revisionId,
          canonicalNameKo: nameKo,
          canonicalNameEn: nameEn,
          aliases: Array.from(new Set([rawKey, nameKo, nameEn, unrevealedKo, unrevealedEn])),
          unrevealedLabelKo: unrevealedKo,
          unrevealedLabelEn: unrevealedEn,
          revealedAtPanelId: startsHidden ? 'UNREVEALED' : undefined,
          genderHint: gender,
          ageHint: seg.ageHint ?? 'young_adult',
          voiceProfile: {
            voiceProfileId: `vp_${charId}`,
            koVoiceName: chosenVoice.voiceName,
            enVoiceName: chosenVoice.voiceName,
            stylePromptKo: `${nameKo} 캐릭터의 개성과 감정선을 살린 입체적인 연기 톤`,
            stylePromptEn: `Distinctive character voice acting for ${nameEn}`,
            speakingRate,
            pitchSemitones,
          },
        };
        characters.push(matched);
      } else {
        if (seg.speakerNameKo && !matched.aliases.includes(seg.speakerNameKo)) {
          matched.aliases.push(seg.speakerNameKo);
        }
        if (seg.speakerKey && !matched.aliases.includes(seg.speakerKey)) {
          matched.aliases.push(seg.speakerKey);
        }
        // 미공개 상태로 시작했던 인물이 이후 컷에서 정체가 밝혀진 경우 revealedAtPanelId 기록
        if (
          startedUnrevealed.has(matched.characterId) &&
          matched.revealedAtPanelId === 'UNREVEALED' &&
          seg.isIdentityRevealedInThisCut === true
        ) {
          matched.revealedAtPanelId = panelId;
          if (seg.speakerNameKo && seg.speakerNameKo !== matched.unrevealedLabelKo) {
            matched.canonicalNameKo = seg.speakerNameKo.trim();
          }
          if (seg.speakerNameEn && seg.speakerNameEn !== matched.unrevealedLabelEn) {
            matched.canonicalNameEn = seg.speakerNameEn.trim();
          }
        }
      }

      speakerKeyToCharacterId[seg.speakerKey] = matched.characterId;
    }
  }

  if (characters.length > PREBUILT_VOICES.length) {
    voicePoolExhausted = true;
  }

  return {
    characters,
    speakerKeyToCharacterId,
    voicePoolExhausted,
  };
}

// 스포일러 보호: revealedAtPanelId 이전 컷에서는 실명 대신 미공개 호칭(unrevealedLabel) 반환 (T03)
export function resolveSpeakerDisplayNameAtPanel(params: {
  character?: Character;
  panelOrderIndex: number;
  panels: Panel[];
  locale: LocaleCode;
}): string {
  const { character, panelOrderIndex, panels, locale } = params;
  if (!character) {
    return locale === 'ko' ? '해설' : 'Narrator';
  }

  if (character.revealedAtPanelId === 'UNREVEALED') {
    return locale === 'ko'
      ? character.unrevealedLabelKo || '정체불명의 인물'
      : character.unrevealedLabelEn || 'Unidentified Figure';
  }

  if (character.revealedAtPanelId) {
    const revealPanel = panels.find((p) => p.panelId === character.revealedAtPanelId);
    if (revealPanel && panelOrderIndex < revealPanel.orderIndex) {
      return locale === 'ko'
        ? character.unrevealedLabelKo || '정체불명의 인물'
        : character.unrevealedLabelEn || 'Unidentified Figure';
    }
  }

  return locale === 'ko' ? character.canonicalNameKo : character.canonicalNameEn;
}
