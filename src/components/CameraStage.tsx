import type { ReactNode, Ref, RefObject } from 'react';
import { CameraOff, ScanLine } from 'lucide-react';
import type { CameraStatus } from '../pose/usePoseCamera.ts';
import { Button } from './ui.tsx';

export type Tone = 'none' | 'ok' | 'warn' | 'unknown';

const RING: Record<Tone, string> = {
  none: 'ring-0',
  ok: 'ring-[14px] ring-mint-500',
  warn: 'ring-[14px] ring-warn',
  unknown: 'ring-[14px] ring-defense',
};

/** 거울처럼 뒤집은 카메라 화면 + 관절 그림. 준비 중에는 뼈대(스켈레톤) 화면을 보여 줍니다. */
export function CameraStage({
  videoRef,
  canvasRef,
  status,
  error,
  onRetry,
  tone = 'none',
  className = '',
  children,
}: {
  videoRef: Ref<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: CameraStatus;
  error?: string;
  onRetry?: () => void;
  tone?: Tone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-slate-900 shadow-md ${className}`}>
      <video ref={videoRef} playsInline muted className="mirror absolute inset-0 h-full w-full object-cover" />
      <canvas ref={canvasRef} className="mirror pointer-events-none absolute inset-0 h-full w-full object-cover" />
      {/* 테두리를 영상 위에 그리기 위한 층 */}
      <div className={`pointer-events-none absolute inset-0 rounded-2xl ring-inset transition-all duration-200 ${RING[tone]}`} />

      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-canvas p-8">
          <div className="skeleton h-40 w-40 rounded-full" />
          <div className="w-full max-w-sm space-y-3">
            <div className="skeleton mx-auto h-5 w-3/4 rounded-full" />
            <div className="skeleton mx-auto h-5 w-1/2 rounded-full" />
          </div>
          <div className="flex items-center gap-2 text-lg font-bold text-mint-700">
            <ScanLine className="h-6 w-6 animate-pulse" />
            AI 자세 인식 준비 중
          </div>
          <p className="text-center text-ink-soft">처음 한 번은 조금 걸려요. 카메라 허용을 물으면 "허용"을 눌러 주세요.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas p-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <CameraOff className="h-10 w-10" />
          </div>
          <p className="max-w-md text-lg font-bold">{error}</p>
          {onRetry && (
            <Button onClick={onRetry} size="md">
              다시 시도
            </Button>
          )}
        </div>
      )}

      {status === 'ready' && children}
    </div>
  );
}
