import type { Metadata } from 'next';
import './globals.css';
import { IntroSplash } from '@/components/IntroSplash';

export const metadata: Metadata = {
  title: 'PanelCast | 배리어프리 웹툰 오디오북 & 출판 스튜디오',
  description:
    '세로 스크롤 웹툰 원고를 컷별 장면 해설, 등장인물 다중 보이스, 검증된 음향 효과로 변환하는 배리어프리 웹툰 출판 및 감상 플랫폼',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600;700&display=swap"
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          본문으로 건너뛰기 (Skip to main content)
        </a>
        <IntroSplash />
        {children}
      </body>
    </html>
  );
}
