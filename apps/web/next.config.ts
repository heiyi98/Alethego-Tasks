import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 共享包以 TypeScript 源码形式导出，由 Next 负责编译
  transpilePackages: ['@alethego/core', '@alethego/data'],
  // 旧地址（按状态 / 按分类分页）改为同一页面上的查询参数
  async redirects() {
    return [
      { source: '/list/:status', destination: '/?status=:status', permanent: false },
      { source: '/category/:id', destination: '/?cat=:id', permanent: false },
    ];
  },
};

export default nextConfig;
