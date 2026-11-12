import openapi from '../../../openapi.json';
import { IMAGE_PLATFORMS } from '../bff.service';
import { SCHEMA_IMAGE_PLATFORMS } from './image-platforms.generated';
import {
  NOT_BUILDABLE_REASON,
  PLATFORM_OPTIONS,
  WORKER_BUILDABLE_PLATFORMS,
  platformOptionsFor,
} from './worklist-entry.model';

/** The enum the admin BFF publishes for BatchImageSpec.hardwareClass, read straight from the
 *  committed openapi.json (the spec the client is generated from), not through the generated code. */
function bffPlatforms(): string[] {
  const prop = (openapi as unknown as {
    components: { schemas: { BatchImageSpec: { properties: { hardwareClass: { enum?: unknown } } } } };
  }).components.schemas.BatchImageSpec.properties.hardwareClass;
  const e = prop.enum;
  if (!Array.isArray(e)) throw new Error('openapi.json BatchImageSpec.hardwareClass has no enum');
  return e as string[];
}

describe('image platforms (derived from the admin BFF spec)', () => {
  it('the BFF spec publishes a non-empty enum that still holds the six original platforms', () => {
    const p = bffPlatforms();
    expect(p.length).toBeGreaterThan(0);
    for (const legacy of ['x86', 'rpi5', 'frite', 'jetson', 'orangepi5', 'orangepizero2']) {
      expect(p).toContain(legacy);
    }
  });

  it('IMAGE_PLATFORMS is exactly the BFF enum, in its order (no hand list)', () => {
    expect<string[]>([...IMAGE_PLATFORMS]).toEqual(bffPlatforms());
  });

  it('the generated list matches openapi.json (run `npm run gen` after copying the spec)', () => {
    expect<string[]>([...SCHEMA_IMAGE_PLATFORMS]).toEqual(bffPlatforms());
  });

  it('the picker offers every platform the BFF accepts, in its order', () => {
    expect<string[]>(PLATFORM_OPTIONS.map((o) => o.value)).toEqual(bffPlatforms());
  });

  it('every worker-buildable platform is one the BFF accepts (no stale allowlist entry)', () => {
    const schema = new Set(bffPlatforms());
    for (const p of WORKER_BUILDABLE_PLATFORMS) expect(schema.has(p)).withContext(p).toBeTrue();
  });

  it('a platform is offered as buildable only when the worker allowlist names it', () => {
    for (const o of PLATFORM_OPTIONS) {
      expect(o.buildable).withContext(o.value).toBe(WORKER_BUILDABLE_PLATFORMS.has(o.value));
      expect(o.reason === null).withContext(o.value).toBe(o.buildable);
    }
  });

  describe('platformOptionsFor (greying)', () => {
    // A schema that has gained a platform the worker has no builder for. The cast stands in for a
    // future regenerated client; the function itself takes whatever the BFF publishes.
    const schema = ['x86', 'rpi5', 'riscv64'] as unknown as typeof IMAGE_PLATFORMS;

    it('greys, with a non-empty reason, a schema platform the worker cannot build', () => {
      const opts = platformOptionsFor(schema, new Set(['x86', 'rpi5']));
      const riscv = opts.find((o) => o.value === ('riscv64' as never));
      expect(riscv).toBeDefined();
      expect(riscv!.buildable).toBeFalse();
      expect(riscv!.reason).toBe(NOT_BUILDABLE_REASON);
      expect(riscv!.reason!.trim().length).toBeGreaterThan(0);
      expect(riscv!.label).toContain('riscv64');
      expect(riscv!.label).toContain('not buildable');
    });

    it('keeps every schema platform listed, greyed or not, in the schema order', () => {
      const opts = platformOptionsFor(schema, new Set(['x86']));
      expect(opts.map((o) => o.value as string)).toEqual(['x86', 'rpi5', 'riscv64']);
      expect(opts.map((o) => o.buildable)).toEqual([true, false, false]);
    });

    it('fails closed: an empty allowlist greys every platform', () => {
      const opts = platformOptionsFor(schema, new Set());
      expect(opts.every((o) => !o.buildable && !!o.reason)).toBeTrue();
    });

    it('a buildable platform has a bare label and no reason', () => {
      const [x86] = platformOptionsFor(schema, new Set(['x86']));
      expect(x86).toEqual({ value: 'x86', label: 'x86', buildable: true, reason: null });
    });
  });
});
