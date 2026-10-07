import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker 镜像里构建时设 NEXT_OUTPUT=standalone：自带运行所需文件，不需要整个 node_modules（见 docs/08-部署说明.md）
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // 共享包在仓库根目录下，独立输出要从仓库根目录收集文件
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // 本地测试另外构建一份中国大陆配置时放在别的目录，不覆盖默认构建
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
