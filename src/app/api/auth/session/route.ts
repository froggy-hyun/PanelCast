import { NextRequest, NextResponse } from 'next/server';
import { getExpectedPublisherToken, verifyPublisherRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = verifyPublisherRequest(req);
  return NextResponse.json({
    authenticated: auth.authorized,
    role: auth.authorized ? 'publisher' : 'reader',
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string };
    const provided = body.token?.trim() ?? '';
    const expected = getExpectedPublisherToken();

    if (!provided || provided !== expected) {
      return NextResponse.json(
        { error: '유효하지 않은 작가/출판사 인증 토큰입니다.' },
        { status: 401 },
      );
    }

    const res = NextResponse.json({ authenticated: true, role: 'publisher' });
    res.cookies.set('panelcast_publisher_token', expected, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
    return res;
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ authenticated: false, role: 'reader' });
  res.cookies.delete('panelcast_publisher_token');
  return res;
}
