import { NextRequest, NextResponse } from 'next/server';
import {
  ENSURED_SOUND_LIBRARY,
  ensureSoundLibraryLoaded,
  getSoundAssetBuffer,
} from '@/lib/sound-library';
import { getEpisode, getRevision, readBinaryAsset } from '@/lib/store';
import { verifyPublisherRequest } from '@/lib/auth';
import { generateHighContrastWebtoonImage } from '@/lib/pipeline';

function buildRangeResponse(
  req: NextRequest,
  buffer: Buffer,
  contentType: string,
  cacheControl: string,
): NextResponse {
  const totalLength = buffer.byteLength;
  const rangeHeader = req.headers.get('range');

  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

    if (
      !Number.isNaN(start) &&
      !Number.isNaN(end) &&
      start >= 0 &&
      end < totalLength &&
      start <= end
    ) {
      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunk.byteLength),
          'Content-Range': `bytes ${start}-${end}/${totalLength}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': cacheControl,
        },
      });
    }
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(totalLength),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ assetPath: string[] }> },
) {
  const { assetPath } = await context.params;
  if (!assetPath || assetPath.length === 0) {
    return NextResponse.json({ error: 'Asset path required' }, { status: 400 });
  }

  // 1. 검증된 사운드 라이브러리 에셋 (/api/assets/sfx/[soundAssetId])
  if (assetPath[0] === 'sfx' && assetPath[1]) {
    await ensureSoundLibraryLoaded();
    const soundAssetId = assetPath[1].replace(/\.wav$/i, '');
    const assetMeta = ENSURED_SOUND_LIBRARY.find((s) => s.soundAssetId === soundAssetId);
    const buf = getSoundAssetBuffer(soundAssetId);
    if (!assetMeta || !buf) {
      return NextResponse.json({ error: 'Sound effect asset not found' }, { status: 404 });
    }
    return buildRangeResponse(
      req,
      buf,
      assetMeta.mimeType,
      'public, max-age=31536000, immutable',
    );
  }

  // 2. 에피소드 리비전 에셋 (/api/assets/[episodeId]/[revisionId]/[kind]/[id])
  if (assetPath.length >= 4) {
    const [episodeId, revisionId, kind, rawId] = assetPath;
    const episode = await getEpisode(episodeId);
    const revision = await getRevision(episodeId, revisionId);
    if (!episode || !revision) {
      return NextResponse.json({ error: 'Episode or revision not found' }, { status: 404 });
    }

    const isPublishedRevision =
      revision.status === 'published' || episode.publishedRevisionId === revisionId;

    if (!isPublishedRevision) {
      const auth = verifyPublisherRequest(req);
      if (!auth.authorized) {
        return NextResponse.json(
          { error: 'Draft asset access denied for unauthenticated user.' },
          { status: 403 },
        );
      }
    }

    const cleanId = rawId.replace(/\.(wav|jpg|jpeg|png|webp)$/i, '');

    if (kind === 'audio') {
      const audioAsset = revision.audioAssets.find((a) => a.audioAssetId === cleanId);
      if (!audioAsset) {
        return NextResponse.json({ error: 'Audio asset not found' }, { status: 404 });
      }
      const buf = await readBinaryAsset(audioAsset.storageUri);
      return buildRangeResponse(
        req,
        buf,
        audioAsset.mimeType || 'audio/wav',
        isPublishedRevision ? 'public, max-age=3600' : 'private, no-store',
      );
    }

    if (kind === 'source') {
      const requestedHighContrast =
        req.nextUrl.searchParams.get('contrast') === 'high' || cleanId.endsWith('_hc');
      const normalizedSourceId = cleanId.replace(/_hc$/i, '');
      const srcImage = revision.sourceImages.find(
        (s) => s.sourceImageId === normalizedSourceId,
      );
      if (!srcImage) {
        return NextResponse.json({ error: 'Source image not found' }, { status: 404 });
      }
      if (requestedHighContrast) {
        if (srcImage.highContrastStorageUri) {
          try {
            const hcBuf = await readBinaryAsset(srcImage.highContrastStorageUri);
            return buildRangeResponse(
              req,
              hcBuf,
              srcImage.mimeType,
              isPublishedRevision ? 'public, max-age=3600' : 'private, no-store',
            );
          } catch {
            // 저장된 고대비 파일이 없는 경우 원본에서 즉시 변환
          }
        }
        const origBuf = await readBinaryAsset(srcImage.storageUri);
        const hcBuf = await generateHighContrastWebtoonImage(origBuf, srcImage.mimeType);
        return buildRangeResponse(
          req,
          hcBuf,
          srcImage.mimeType,
          isPublishedRevision ? 'public, max-age=3600' : 'private, no-store',
        );
      }
      const buf = await readBinaryAsset(srcImage.storageUri);
      return buildRangeResponse(
        req,
        buf,
        srcImage.mimeType,
        isPublishedRevision ? 'public, max-age=3600' : 'private, no-store',
      );
    }

    if (kind === 'tile') {
      const tile = revision.tiles.find((t) => t.tileId === cleanId);
      if (!tile) {
        return NextResponse.json({ error: 'Tile image not found' }, { status: 404 });
      }
      const buf = await readBinaryAsset(tile.storageUri);
      return buildRangeResponse(req, buf, 'image/jpeg', 'private, no-store');
    }
  }

  return NextResponse.json({ error: 'Unsupported asset path' }, { status: 404 });
}
