import { Injectable, computed, inject, signal } from '@angular/core';
import { BffService, PlatformCapabilities } from '../bff.service';

/**
 * Loads the platform-capability envelope ({@code GET /bff/admin/platform-capabilities}) ONCE
 * and shares it as a signal across every infra-dependent console, so the Backup & Recovery,
 * Cloud Backups, and ArgoCD consoles can degrade gracefully (show a notice + suppress actions)
 * when a foundational capability is absent — without each re-fetching.
 *
 * <p>The BFF probes are read-only + fail-safe, and the BFF stays the authoritative gate on every
 * action; these signals only change what the UI shows. {@code ready()} is false until the first
 * load resolves so a console can hold its actions until the answer is known (fail-closed display).
 */
@Injectable({ providedIn: 'root' })
export class PlatformCapabilitiesService {
  private readonly bff = inject(BffService);

  private readonly caps = signal<PlatformCapabilities | null>(null);
  private inflight: Promise<PlatformCapabilities> | null = null;

  /** The latest envelope (null until first load). */
  readonly capabilities = this.caps.asReadonly();
  /** True once the first load has resolved. */
  readonly ready = computed(() => this.caps() !== null);

  // Convenience capability signals (false while unknown — fail-closed display).
  readonly veleroPresent = computed(() => this.caps()?.veleroPresent === true);
  readonly argocdPresent = computed(() => this.caps()?.argocdPresent === true);
  readonly buildNodePresent = computed(() => this.caps()?.buildNodePresent === true);
  readonly imagesGenerated = computed(() => this.caps()?.imagesGenerated === true);
  readonly warnings = computed(() => this.caps()?.warnings ?? []);

  /**
   * Ensures the envelope is loaded (de-duped: concurrent callers share one fetch). Resolves to
   * the envelope. Safe to call from many consoles' {@code ngOnInit} — only the first hits the BFF.
   */
  async load(): Promise<PlatformCapabilities> {
    const current = this.caps();
    if (current) return current;
    if (this.inflight) return this.inflight;
    this.inflight = this.bff.platformCapabilities().then((c) => {
      this.caps.set(c);
      this.inflight = null;
      return c;
    });
    return this.inflight;
  }

  /** Forces a fresh load (e.g. after the operator enables infra and wants to re-check). */
  async reload(): Promise<PlatformCapabilities> {
    this.inflight = null;
    this.caps.set(null);
    return this.load();
  }
}
