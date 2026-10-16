import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PanelCast | 시각장애인 독자를 위한 배리어프리 웹툰 오디오북 플랫폼',
  description:
    '웹툰 원고를 컷별 장면 해설, 다중 캐릭터 보이스, 검증된 음향 효과로 변환하는 배리어프리 웹툰 출판 및 감상 플랫폼',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <a href="#main-content" className="skip-link">
          본문으로 건너뛰기 (Skip to main content)
        </a>
        {children}
      </body>
    </html>
  );
}
