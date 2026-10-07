/**
 * 部署地区（构建时由 NEXT_PUBLIC_REGION 决定）：
 * - international（默认）：现在的样子
 * - china：中国大陆部署。登录页不显示 Google 登录（Google 在大陆打不开）
 * 前端除了登录（NEXT_PUBLIC_ALETHEGO_URL）和数据（NEXT_PUBLIC_SUPABASE_URL）这两个地址，不请求任何外部服务
 * （没有外部字体、CDN、统计），所以两种地区只差这一处。
 */
export type Region = 'international' | 'china';

export function regionOf(value: string | undefined): Region {
  return value?.trim().toLowerCase() === 'china' ? 'china' : 'international';
}

export const REGION: Region = regionOf(process.env.NEXT_PUBLIC_REGION);

/** 这个地区能不能用 Google 登录 */
export const googleSignInEnabled = (region: Region = REGION) => region !== 'china';
