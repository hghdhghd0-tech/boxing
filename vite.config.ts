import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// 배포 시각(한국 시간). 홈 화면 아래에 작게 보여 주어 태블릿이 새 버전인지 확인할 수 있게 합니다.
const BUILD_ID = process.env.BUILD_ID ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '.');

// base를 './'(상대 경로)로 두면 GitHub Pages 저장소 이름이 무엇이든 그대로 동작합니다.
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // 등록은 src/lib/pwa.ts에서 직접 합니다. (새 버전을 홈 화면에서만 적용하려고)
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: '복싱 셀프코치',
        short_name: '셀프코치',
        description: 'AI 자세 인식으로 복싱 가드를 스스로 점검하는 수업 앱',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#F8FAFC',
        theme_color: '#10B981',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 화면(HTML·JS·CSS·아이콘)만 미리 저장합니다.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['mediapipe/**', 'models/**'],
        cleanupOutdatedCaches: true,
        // 새 버전이 받아지면 기다리지 않고 바로 이어받기 (적용 시점은 src/lib/pwa.ts가 홈 화면에서 정함)
        skipWaiting: true,
        clientsClaim: true,
        // 자세 인식 파일(약 20MB)과 글꼴은 처음 쓸 때 한 번 받아 저장해 두고, 그다음부터는 오프라인으로 씁니다.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/mediapipe/') || url.pathname.endsWith('.task'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-ai-files',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'storage.googleapis.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'pose-ai-model-remote',
              expiration: { maxEntries: 3 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
