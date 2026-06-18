import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { BffService, PlatformCapabilities } from '../bff.service';
import { GatedCapability } from './capability-gate.component';

/**
 * Case-insensitive tokens that tie a BFF `warnings[]` entry to a specific gated capability. The
 * BFF emits BOTH per-probe warnings ("ArgoCD presence could not be detected …", "x86 build-node
 * presence could not be detected …", "Generated-images presence could not be read …") AND
 * cluster-wide ones that name all three k8s capabilities at once (the NOT_WIRED "Platform-capability
 * k8s probe is not enabled …" notice and the "Kubernetes client unavailable; ArgoCD / Velero /
 * build-node presence could not be detected …" notice). A capability is "undetectable" when ANY
 * warning matches one of its tokens — i.e. the probe could not actually determine its presence,
 * so the UI must NOT assert factual absence.
 */
const CAPABILITY_WARNING_TOKENS: Record<GatedCapability, RegExp[]> = {
  argocd: [/argocd/i],
  velero: [/velero/i],
  buildNode: [/build-node/i],
  // The DB/images warning text plus the cluster-wide k8s notices that all mention "images".
  images: [/images/i],
};

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
   * The FIRST warning that pertains to a capability, or {@code null} if none. A non-null result
   * means the probe could NOT determine the capability's presence (probe not enabled / RBAC-denied
   * / probe error / DB down) — so a console must render "couldn't determine" copy rather than
   * asserting factual absence. Returns a {@code Signal} so a console can bind it directly.
   */
  warningFor(capability: GatedCapability): Signal<string | null> {
    return computed(() => {
      const tokens = CAPABILITY_WARNING_TOKENS[capability];
      return this.warnings().find((w) => tokens.some((t) => t.test(w))) ?? null;
    });
  }

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
