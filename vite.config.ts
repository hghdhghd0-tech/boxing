import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// base를 './'(상대 경로)로 두면 GitHub Pages 저장소 이름이 무엇이든 그대로 동작합니다.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
