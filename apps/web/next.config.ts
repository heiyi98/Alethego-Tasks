import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 共享包以 TypeScript 源码形式导出，由 Next 负责编译
  transpilePackages: ['@alethego/core', '@alethego/data'],
};

export default nextConfig;
