import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Превью в песочнице открывается по домену вида `3000-<id>.e2b.app`, и dev-
  // сервер считает такие запросы чужими. Без списка Next в будущем мажоре
  // перестанет отдавать /_next/* на этот домен, а сейчас пишет предупреждение.
  allowedDevOrigins: ['*.e2b.app'],
};

export default nextConfig;
