import { THEME_PRESETS, THEME_RAMPS } from './theme-catalogue';
import { RAMPS } from './domain-themes.service';

/** The vendored generator catalogue: what the web editor offers. */
describe('vendored theme catalogue', () => {
  it('offers the full generated catalogue, ids shaped as the BFF accepts', () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(380);
    for (const p of THEME_PRESETS) expect(p.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
  });

  it('includes WebGL backgrounds, high-contrast presets and presets with fonts', () => {
    const effects = new Set(THEME_PRESETS.map((p) => p.effect));
    for (const e of ['vanta-fog', 'vanta-waves', 'vanta-net', 'vanta-globe']) expect(effects.has(e)).toBeTrue();
    expect(THEME_PRESETS.filter((p) => p.group === 'High contrast').length).toBeGreaterThanOrEqual(20);
    expect(THEME_PRESETS.filter((p) => p.font).length).toBeGreaterThan(100);
  });

  it('the editor offers the high-contrast ramps', () => {
    const ramps = [...RAMPS] as string[];
    expect(ramps).toEqual([...THEME_RAMPS] as string[]);
    expect(ramps).toContain('contrast-dark');
    expect(ramps).toContain('contrast-light');
  });
});
