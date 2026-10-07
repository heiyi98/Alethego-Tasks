import { describe, expect, it } from 'vitest';

import { googleSignInEnabled, regionOf } from './region';

describe('部署地区', () => {
  it('只认 china，其余（包括没设）都是 international', () => {
    expect(regionOf('china')).toBe('china');
    expect(regionOf(' China ')).toBe('china');
    expect(regionOf('international')).toBe('international');
    expect(regionOf(undefined)).toBe('international');
    expect(regionOf('cn')).toBe('international');
  });

  it('中国大陆不显示 Google 登录', () => {
    expect(googleSignInEnabled('china')).toBe(false);
    expect(googleSignInEnabled('international')).toBe(true);
  });
});
