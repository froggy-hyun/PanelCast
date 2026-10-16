import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { OAuth2Client } from 'google-auth-library';

const oauthClient = new OAuth2Client();

export function getExpectedPublisherToken(): string {
  return (
    process.env.PUBLISHER_STUDIO_TOKEN?.trim() ||
    process.env.STUDIO_ADMIN_TOKEN?.trim() ||
    process.env.PANELCAST_STUDIO_SECRET?.trim() ||
    'panelcast-publisher-secret-2026'
  );
}

export function getExpectedWorkerSecret(): string {
  return process.env.WORKER_SHARED_SECRET?.trim() || 'panelcast-worker-dev-secret-2026';
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function readCookieValue(req: NextRequest | Request, cookieName: string): string | null {
  if ('cookies' in req && typeof req.cookies?.get === 'function') {
    const val = req.cookies.get(cookieName)?.value;
    if (val) return val;
  }
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookieName}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(cookieName.length + 1));
}

// 작가/출판사 스튜디오 인증 검증 (MVP 모드에서는 별도 토큰/로그인 없이 즉시 오픈 허용)
export function verifyPublisherRequest(
  req: NextRequest | Request,
  options?: { requireToken?: boolean },
): {
  authorized: boolean;
  status: number;
  reason?: string;
} {
  const expected = getExpectedPublisherToken();
  const strictMode =
    options?.requireToken === true || process.env.REQUIRE_STUDIO_TOKEN === 'true';

  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerToken = req.headers.get('x-publisher-token')?.trim() || '';
  const cookieToken = readCookieValue(req, 'panelcast_publisher_token')?.trim() || '';

  const candidate = bearerToken || headerToken || cookieToken;
  if (!candidate) {
    if (strictMode) {
      return {
        authorized: false,
        status: 401,
        reason: 'Missing publisher authentication token.',
      };
    }
    return {
      authorized: true,
      status: 200,
    };
  }

  if (!timingSafeEqualString(candidate, expected)) {
    return {
      authorized: false,
      status: 403,
      reason: 'Invalid publisher authentication token.',
    };
  }

  return {
    authorized: true,
    status: 200,
  };
}

// 비공개 워커 엔드포인트 보안 검증: X-CloudTasks-* 헤더 단독 위조 거부 + OIDC 또는 공유 시크릿 검증 (T16)
export async function verifyPrivateWorkerRequest(req: NextRequest | Request): Promise<{
  authorized: boolean;
  status: number;
  reason?: string;
}> {
  const workerSecretHeader = req.headers.get('x-panelcast-worker-secret')?.trim() || '';
  const expectedSecret = getExpectedWorkerSecret();

  if (workerSecretHeader && timingSafeEqualString(workerSecretHeader, expectedSecret)) {
    return { authorized: true, status: 200 };
  }

  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    const hasSpoofedCloudTaskHeaders =
      Boolean(req.headers.get('x-cloudtasks-queuename')) ||
      Boolean(req.headers.get('x-cloudtasks-taskname'));
    return {
      authorized: false,
      status: hasSpoofedCloudTaskHeaders ? 403 : 401,
      reason: hasSpoofedCloudTaskHeaders
        ? 'Spoofed X-CloudTasks-* headers without verified OIDC or worker token are rejected.'
        : 'Missing worker authorization credentials.',
    };
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return {
      authorized: false,
      status: 401,
      reason: 'Empty Bearer token on private worker endpoint.',
    };
  }

  try {
    const expectedAudience = process.env.WORKER_OIDC_AUDIENCE?.trim();
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: expectedAudience || undefined,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return {
        authorized: false,
        status: 403,
        reason: 'Invalid OIDC token payload.',
      };
    }

    const expectedServiceAccount = process.env.WORKER_SERVICE_ACCOUNT_EMAIL?.trim();
    if (expectedServiceAccount && payload.email !== expectedServiceAccount) {
      return {
        authorized: false,
        status: 403,
        reason: `Unauthorized OIDC service account: ${payload.email}`,
      };
    }

    return { authorized: true, status: 200 };
  } catch {
    return {
      authorized: false,
      status: 403,
      reason: 'Failed OIDC token verification for worker endpoint.',
    };
  }
}
