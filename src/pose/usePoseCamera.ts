import { useCallback, useEffect, useRef, useState } from 'react';
import { DETECT_INTERVAL_MS } from '../config.ts';
import type { Landmark } from './guard.ts';
import { getPoseEngine } from './poseEngine.ts';

export type CameraStatus = 'loading' | 'ready' | 'error';
export type FrameHandler = (lm: Landmark[] | null, t: number, aspect: number, video: HTMLVideoElement) => void;

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return '카메라 사용이 막혀 있어요. 주소창 옆 카메라 아이콘에서 "허용"을 눌러 주세요.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '카메라를 찾지 못했어요.';
  if (name === 'NotReadableError') return '다른 프로그램이 카메라를 쓰고 있어요. 다른 창을 닫고 다시 해 주세요.';
  return (err as Error)?.message || '카메라를 켜지 못했어요.';
}

function attach(el: HTMLVideoElement, stream: MediaStream) {
  if (el.srcObject !== stream) el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  void el.play().catch(() => undefined);
}

/**
 * 전면 카메라를 켜고 1초에 약 15번 자세를 인식해 onFrame으로 넘겨 줍니다.
 * 영상은 태블릿 안에서만 쓰고 저장하거나 보내지 않습니다.
 * videoRef는 <video ref={videoRef}>에 붙입니다. 화면이 바뀌어 video가 새로 생겨도 다시 연결됩니다.
 */
export function usePoseCamera(onFrame: FrameHandler, enabled = true) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handlerRef = useRef(onFrame);
  handlerRef.current = onFrame;
  const [status, setStatus] = useState<CameraStatus>('loading');
  const [error, setError] = useState<string>('');
  const [retryKey, setRetryKey] = useState(0);

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) attach(el, streamRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    setStatus('loading');
    setError('');

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('이 브라우저에서는 카메라를 쓸 수 없어요. Edge나 Chrome으로 열어 주세요.');
        }
        const [stream, engine] = await Promise.all([
          navigator.mediaDevices
            .getUserMedia({
              video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false,
            })
            .catch((e) => {
              throw new Error(cameraErrorMessage(e));
            }),
          getPoseEngine(),
        ]);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoElRef.current) attach(videoElRef.current, stream);
        setStatus('ready');

        let last = 0;
        // 느린 태블릿에서는 인식 한 번에 오래 걸려 신호 화면이 버벅일 수 있어서,
        // 인식에 걸린 시간의 1.5배만큼은 쉬었다가 다음 인식을 합니다.
        let gap = DETECT_INTERVAL_MS;
        const loop = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          if (now - last < gap) return;
          const video = videoElRef.current;
          if (!video || video.readyState < 2 || !video.videoWidth) return;
          last = now;
          let lm: Landmark[] | null = null;
          try {
            const res = engine.detectForVideo(video, now);
            lm = (res.landmarks?.[0] as Landmark[] | undefined) ?? null;
          } catch {
            lm = null;
          }
          const cost = performance.now() - now;
          gap = 0.7 * gap + 0.3 * Math.max(DETECT_INTERVAL_MS, cost * 1.5);
          handlerRef.current(lm, now, video.videoWidth / video.videoHeight, video);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoElRef.current) videoElRef.current.srcObject = null;
    };
  }, [enabled, retryKey]);

  return { videoRef, status, error, retry: () => setRetryKey((k) => k + 1) };
}
