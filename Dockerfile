# Alethego Tasks 前端镜像（不依赖 Vercel，任何能跑 Docker 的服务器都可以）。
# 用法和全部环境变量见 docs/08-部署说明.md。
#
# NEXT_PUBLIC_* 在构建时写进前端代码，所以作为构建参数传入；改了要重新构建镜像。
# 在中国大陆构建时可以把基础镜像和 npm 源换成国内镜像：
#   --build-arg NODE_IMAGE=<国内镜像源>/library/node:22-alpine
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY} \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages
# 构建时的类型检查要用到（单元测试里引用了建库脚本的生成器）
COPY supabase/scripts supabase/scripts

ARG NEXT_PUBLIC_REGION=international
ARG NEXT_PUBLIC_ALETHEGO_URL
ARG NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_REGION=${NEXT_PUBLIC_REGION} \
    NEXT_PUBLIC_ALETHEGO_URL=${NEXT_PUBLIC_ALETHEGO_URL} \
    NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY=${NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_OUTPUT=standalone
RUN pnpm --filter @alethego/web build

FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
