export type LocaleCode = 'ko' | 'en';
export type SupportedLocale = LocaleCode;

export type PublishMode = 'auto_publish' | 'custom';

export type RevisionStatus =
  | 'ingesting'
  | 'analyzing'
  | 'synthesizing'
  | 'validating'
  | 'ready'
  | 'published'
  | 'failed';

export type TaskStatus =
  | 'pending_dispatch'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TaskType = 'tile_analysis' | 'segment_tts' | 'manifest_validation';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceImage {
  sourceImageId: string;
  episodeId: string;
  revisionId: string;
  orderIndex: number;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  globalYStart: number;
  globalYEnd: number;
  storageUri: string;
  highContrastStorageUri?: string;
}

export interface RawTileSegment {
  kind: 'dialogue' | 'narration' | 'sfx' | 'system_popup';
  speakerKey: string;
  speakerNameKo: string;
  speakerNameEn: string;
  isIdentityRevealedInThisCut?: boolean;
  unrevealedLabelKo?: string;
  unrevealedLabelEn?: string;
  genderHint?: 'male' | 'female' | 'neutral';
  ageHint?: 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elder';
  textKo: string;
  textEn: string;
  deliveryStyleKo: string;
  deliveryStyleEn: string;
  suggestedSfxCategory?: string;
  sfxConfidence?: number;
}

export interface RawTilePanel {
  localPanelIndex: number;
  bbox: BoundingBox;
  visualSummaryKo: string;
  visualSummaryEn: string;
  emotionalToneKo: string;
  emotionalToneEn: string;
  continuityNote: string;
  segments: RawTileSegment[];
}

export interface TileAnalysisResult {
  panels: RawTilePanel[];
}

export interface AnalysisTile {
  tileId: string;
  episodeId: string;
  revisionId: string;
  tileIndex: number;
  globalYStart: number;
  globalYEnd: number;
  overlapTopPx: number;
  overlapBottomPx: number;
  width: number;
  height: number;
  sourceImageIds: string[];
  storageUri: string;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  rawResult?: TileAnalysisResult;
}

export interface DeduplicatedPanel {
  sourceTileIndex: number;
  globalYStart: number;
  globalYEnd: number;
  bbox: BoundingBox;
  visualSummaryKo: string;
  visualSummaryEn: string;
  emotionalToneKo: string;
  emotionalToneEn: string;
  continuityNote: string;
  segments: RawTileSegment[];
}

export interface Panel {
  panelId: string;
  episodeId: string;
  revisionId: string;
  orderIndex: number;
  sourceTileId: string;
  sourceImageId: string;
  globalYStart: number;
  globalYEnd: number;
  bbox: BoundingBox;
  visualSummaryKo: string;
  visualSummaryEn: string;
  emotionalToneKo: string;
  emotionalToneEn: string;
  continuityNote: string;
  extraHoldMs: number;
  segmentIds: string[];
  soundCueIds: string[];
}

export interface Segment {
  segmentId: string;
  panelId: string;
  episodeId: string;
  revisionId: string;
  orderIndex: number;
  kind: 'dialogue' | 'narration' | 'sfx' | 'system_popup';
  speakerCharacterId?: string;
  textKo: string;
  textEn: string;
  deliveryStyleKo: string;
  deliveryStyleEn: string;
  pace: 'slow' | 'normal' | 'fast';
  pauseAfterMs: number;
  audioAssetIdByLocale: Partial<Record<LocaleCode, string>>;
  inputHashByLocale: Partial<Record<LocaleCode, string>>;
}

export interface VoiceProfile {
  voiceProfileId: string;
  koVoiceName: string;
  enVoiceName: string;
  stylePromptKo: string;
  stylePromptEn: string;
  speakingRate: number;
  pitchSemitones: number;
}

export interface Character {
  characterId: string;
  episodeId: string;
  revisionId: string;
  canonicalNameKo: string;
  canonicalNameEn: string;
  aliases: string[];
  unrevealedLabelKo: string;
  unrevealedLabelEn: string;
  revealedAtPanelId?: string;
  genderHint: 'male' | 'female' | 'neutral';
  ageHint: 'child' | 'teen' | 'young_adult' | 'middle_aged' | 'elder';
  voiceProfile: VoiceProfile;
}

export interface SoundAsset {
  soundAssetId: string;
  titleKo: string;
  titleEn: string;
  category: string;
  keywordsKo: string[];
  keywordsEn: string[];
  license: 'CC0-1.0' | 'Owned-Synthesized';
  mimeType: 'audio/wav';
  durationMs: number;
  sampleRateHz: number;
  byteSize: number;
  sha256: string;
}

export interface SoundCue {
  cueId: string;
  panelId: string;
  episodeId: string;
  revisionId: string;
  orderIndex: number;
  rawSfxTextKo: string;
  meaningKo: string;
  meaningEn: string;
  soundAssetId?: string;
  confidence: number;
  fallbackMode: 'sound_effect' | 'text_only';
  offsetMs: number;
  gainDb: number;
}

export interface AudioAsset {
  audioAssetId: string;
  episodeId: string;
  revisionId: string;
  segmentId: string;
  locale: LocaleCode;
  voiceName: string;
  inputHash: string;
  mimeType: 'audio/wav';
  byteSize: number;
  durationMs: number;
  sampleRateHz: number;
  sha256: string;
  storageUri: string;
  createdAt: string;
}

export interface ManifestSoundCueEntry {
  cueId: string;
  rawSfxTextKo: string;
  meaning: string;
  soundAssetId?: string;
  audioUrl?: string;
  fallbackMode: 'sound_effect' | 'text_only';
  offsetMs: number;
  gainDb: number;
}

export interface ManifestSegmentEntry {
  segmentId: string;
  orderIndex: number;
  kind: 'dialogue' | 'narration' | 'sfx' | 'system_popup';
  speakerCharacterId?: string;
  speakerDisplayName: string;
  voiceName: string;
  text: string;
  deliveryStyle: string;
  audioAssetId: string;
  audioUrl: string;
  durationMs: number;
  pauseAfterMs: number;
  inputHash: string;
}

export interface ManifestPanelEntry {
  panelId: string;
  orderIndex: number;
  sourceImageId: string;
  imageUrl: string;
  highContrastImageUrl?: string;
  globalYStart: number;
  globalYEnd: number;
  bbox: BoundingBox;
  visualSummary: string;
  emotionalTone: string;
  extraHoldMs: number;
  soundCues: ManifestSoundCueEntry[];
  segments: ManifestSegmentEntry[];
}

export interface PlaybackManifest {
  manifestId: string;
  episodeId: string;
  revisionId: string;
  locale: LocaleCode;
  panels: ManifestPanelEntry[];
  totalPanels: number;
  totalSegments: number;
  totalDurationMs: number;
  createdAt: string;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  panelId?: string;
  segmentId?: string;
  cueId?: string;
  locale?: LocaleCode;
  recoverable: boolean;
}

export interface ValidationReport {
  reportId: string;
  episodeId: string;
  revisionId: string;
  valid: boolean;
  checkedAt: string;
  issues: ValidationIssue[];
  autoCorrectionAttempted: boolean;
  autoCorrectionSucceeded: boolean;
  autoCorrectionNotes: string[];
  stats: {
    panelCount: number;
    segmentCount: number;
    characterCount: number;
    audioAssetCount: number;
    soundCueCount: number;
  };
}

export interface EpisodeTask {
  taskId: string;
  episodeId: string;
  revisionId: string;
  taskType: TaskType;
  status: TaskStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseExpiresAt?: string;
  payload: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  revisionId: string;
  episodeId: string;
  revisionNumber: number;
  status: RevisionStatus;
  publishMode: PublishMode;
  sourceImages: SourceImage[];
  tiles: AnalysisTile[];
  panels: Panel[];
  segments: Segment[];
  characters: Character[];
  soundCues: SoundCue[];
  audioAssets: AudioAsset[];
  manifests: Partial<Record<LocaleCode, PlaybackManifest>>;
  validationReport?: ValidationReport;
  voicePoolExhausted: boolean;
  autoCorrectionApplied: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Episode {
  episodeId: string;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  authorName: string;
  publishedRevisionId?: string;
  activeDraftRevisionId: string;
  publishMode: PublishMode;
  status: RevisionStatus;
  totalStitchedWidth: number;
  totalStitchedHeight: number;
  sourceImageCount: number;
  panelCount: number;
  characterCount: number;
  voicePoolExhausted: boolean;
  coverImageAssetId?: string;
  createdAt: string;
  updatedAt: string;
}
