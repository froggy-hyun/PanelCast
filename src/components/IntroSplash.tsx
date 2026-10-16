'use client';

import React, { useEffect, useState } from 'react';

// 웹사이트 최초 접속 시 중앙에서 pc-to-panelcast-anim.gif 로고 애니메이션을 1회 재생하는 인트로 오버레이
export function IntroSplash() {
  const [phase, setPhase] = useState<'playing' | 'fading' | 'done'>('playing');

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => {
      setPhase('fading');
    }, 4350);

    const doneTimer = window.setTimeout(() => {
      setPhase('done');
    }, 4750);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (phase === 'done') {
    return null;
  }

  return (
    <div
      data-testid="intro-splash"
      aria-label="PanelCast 인트로 로고 애니메이션"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#F7F5EF] pointer-events-none transition-opacity duration-300 ease-out ${
        phase === 'fading' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative flex flex-col items-center justify-center px-6">
        <img
          src="/pc-to-panelcast-anim.gif"
          alt="PanelCast 로고 애니메이션"
          data-testid="intro-splash-gif"
          className="w-[320px] sm:w-[460px] md:w-[560px] max-w-[88vw] h-auto object-contain select-none"
        />
      </div>
      <button
        type="button"
        onClick={() => setPhase('done')}
        data-testid="intro-splash-skip"
        className="pointer-events-auto absolute bottom-8 right-8 px-3.5 py-1.5 rounded-full border border-[#D8D2C5] bg-white/80 text-xs font-semibold text-[#4A4740] hover:text-[#141413] hover:border-[#141413] transition-colors"
      >
        인트로 건너뛰기
      </button>
    </div>
  );
}
