import {
  BatchImageSpec,
  ImagePlatform,
  IMAGE_PLATFORMS,
  ImageType,
  WorklistEnvelope,
} from '../bff.service';

/**
 * Client-side worklist model for the image-gen batch wizard (WS-WEB-UI-WIZARD). Holds the
 * per-entry (role × platform) form state, the mesh Users list, and the pure assembly of the
 * frozen worklist v1 ENVELOPE the wizard POSTs to {@code /bff/admin/image-builds/batch}.
 *
 * <p>SECURITY / TENANCY: the assembled envelope carries only CONTENT (per-image axes + the
 * mesh domains/users). It NEVER carries brand/org/superdomain or a per-build domain — those are
 * SERVER-derived and the own-domain wall is re-enforced server-side. The cross-tenant steps
 * (superdomain, other-brand domains/users) are additionally SUPERADMIN-gated inside the wizard.
 *
 * <p>The {@link WorklistEntrySelection} is the THIN coupling contract the package-catalog-modal
 * (WS-WEB-UI-CATALOG-MODAL) emits into the wizard: a role × platform pick + its catalog-derived
 * image class + chosen package atoms. The wizard consumes it via {@link applySelection}; the modal
 * is otherwise NOT touched by this workstream.
 */

/** The hard cap on a batch: ONE step-up authorises at most this many real device images. */
export const MAX_ENTRIES = 16;

/** A role's catalog class — drives which per-entry DESKTOP-ONLY sub-forms are shown. */
export type ImageClass = 'desktop' | 'node';

/** Per-entry root-encryption override (worklist entry `encrypt_root`). `default` inherits the
 *  worklist-wide Home default; jetson is forced off server-side in materialize regardless. */
export type EncryptRoot = 'default' | 'on' | 'off';

/** The branding sub-form is a strict XOR: a named PRESET or an expanded CUSTOM theme. */
export type BrandingMode = 'preset' | 'custom';

/** One worklist entry (a single image, one per role × platform) as edited in the wizard. */
export interface WorklistEntry {
  /** Stable client row key (also the wire entry id `{role}.{platform}`). */
  key: string;
  targetUser: string;
  role: string;
  platform: ImagePlatform;
  /** Catalog-derived class; gates the desktop-only sub-forms (items 2/3/7). */
  imageClass: ImageClass;
  imageType: ImageType;
  sshKeysAllowed: boolean;
  encryptRoot: EncryptRoot;
  // ── item 2: branding (desktop-only, preset XOR custom) ──
  brandingMode: BrandingMode;
  brandingPreset: string;
  customBrandTitle: string;
  customPrimaryColor: string;
  // ── item 3: tailnet / SSO (branded desktop only, superadmin-gated) ──
  tailnetJoin: boolean;
  sso: boolean;
  // ── Tor onion NODE service (x86 node only) — expose fe-gateway as a v3 .onion.
  //    An x86-only ImageConfig field (tor_onion_service); the x86 builder folds it via
  //    the additive --with-tor. Off by default. rpi5/edge tor rides --optional-services,
  //    a richer path not offered here (mirrors the Studio's x86-only tor field). ──
  torOnion: boolean;
  // ── item 7: home / home-encryption (desktop-only) ──
  homeEnabled: boolean;
  // ── item 4: attached domains (domain-name refs) ──
  attachedDomains: string[];
  // ── item 9: package atoms (space-separated); fed inline OR from the catalog modal ──
  packagesAdd: string;
  packagesDrop: string;
  /** Enabled adhoc-add option KEYS (item 9). Persisted purely so the catalog modal can restore
   *  the option checkboxes on re-edit — the option's atoms are already folded into packagesAdd
   *  (and thus into the wire imageSpec); this list never reaches the builder. */
  options: string[];
}

/** One mesh user (item 6 Users step). `domain` is picked from the registry dropdown. */
export interface WorklistUser {
  username: string;
  domain: string;
  role: string;
  email: string;
}

/** The thin selection the package-catalog-modal emits into the wizard (item 9 coupling). */
export interface WorklistEntrySelection {
  role: string;
  platform: ImagePlatform;
  imageClass: ImageClass;
  board?: string;
  flavor?: string;
  desktop?: string;
  packagesAdd?: string;
  packagesDrop?: string;
  /** Enabled adhoc-add option keys (round-trip so a re-edit restores the option checkboxes). */
  options?: string[];
}

/** Image-type options for the per-entry radio (mirrors the closed ImageType vocabulary). */
export const IMAGE_TYPE_OPTIONS: ReadonlyArray<{ value: ImageType; label: string }> = [
  { value: 'primary', label: 'Primary' },
  { value: 'mesh-extension', label: 'Mesh extension' },
  { value: 'client', label: 'Client' },
];

/** Platform options for the per-entry select (bare enum tokens — NOT the catalog's rich
 *  platform_labels, which are catalog CONTENT owned by the catalog modal; these six tokens are
 *  the frozen schema enum and safe to enumerate here). */
export const PLATFORM_OPTIONS: ReadonlyArray<{ value: ImagePlatform; label: string }> =
  IMAGE_PLATFORMS.map((p) => ({ value: p, label: p }));

/** Encrypt-root options for the desktop home sub-form. */
export const ENCRYPT_ROOT_OPTIONS: ReadonlyArray<EncryptRoot> = ['default', 'on', 'off'];

let seq = 0;
/** Monotonic client key for a new entry row (stable across re-renders / *ngFor trackBy). */
function nextKey(): string {
  seq += 1;
  return `wle-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A fresh worklist entry with fail-closed defaults (keys off, no branding, home off). */
export function newEntry(over: Partial<WorklistEntry> = {}): WorklistEntry {
  return {
    key: nextKey(),
    targetUser: '',
    role: '',
    platform: 'x86',
    imageClass: 'node',
    imageType: 'primary',
    sshKeysAllowed: false,
    encryptRoot: 'default',
    brandingMode: 'preset',
    brandingPreset: '',
    customBrandTitle: '',
    customPrimaryColor: '',
    tailnetJoin: false,
    sso: false,
    torOnion: false,
    homeEnabled: false,
    attachedDomains: [],
    packagesAdd: '',
    packagesDrop: '',
    options: [],
    ...over,
  };
}

/** True when the entry's catalog class shows the desktop-only sub-forms (items 2/3/7). */
export function isDesktopClass(e: WorklistEntry): boolean {
  return e.imageClass === 'desktop';
}

/** True when the tailnet/SSO sub-form applies: a BRANDED desktop that is not the unaffiliated
 *  standalone role (item 3). Cross-tenant, so the wizard additionally gates its VISIBILITY to
 *  superadmin — this predicate is the content-level gate. */
export function isTailnetSsoEligible(e: WorklistEntry): boolean {
  return (
    isDesktopClass(e) &&
    e.imageType !== 'primary' &&
    e.role !== 'standalone-unaffiliated' &&
    e.role.length > 0
  );
}

/**
 * True when the Tor-onion NODE-service toggle applies: an x86 NODE-class image. The onion is a
 * k8s cluster NODE service the x86 builder folds via the additive `--with-tor`
 * (`tor_onion_service` is an x86-only ImageConfig field); it has no effect on a client/desktop
 * image and no dedicated flag on rpi5/edge (there it rides `--optional-services`, a richer path
 * not offered in this wizard). Mirrors the Studio wizard, whose Tor field is x86-only.
 */
export function isTorOnionEligible(e: WorklistEntry): boolean {
  return e.platform === 'x86' && e.imageClass === 'node';
}

/** The stable wire entry id `{role}.{platform}` used for domain attachment refs. */
export function entryWireId(e: WorklistEntry): string {
  return `${e.role}.${e.platform}`;
}

/**
 * The per-image CONTENT fragment for an entry's {@code imageSpec} (the IMAGE_SPEC_JSON channel,
 * item 1b). This is the user's chosen per-image content — NOT a full generator materialization
 * (that authoritative flat spec is produced by the deferred generator {@code --print-specs}
 * subcommand). Desktop-only fields are included ONLY for a desktop-class entry. SECRETS are never
 * present (this UI never collects a password / dial key). The BFF's fail-closed worklist.v1
 * validator re-checks this before it is ever persisted or written to a ConfigMap.
 */
export function entryContentSpec(e: WorklistEntry): Record<string, unknown> {
  const spec: Record<string, unknown> = { role: e.role, platform: e.platform };
  if (e.encryptRoot !== 'default') spec['encrypt_root'] = e.encryptRoot;
  // Tor onion NODE service (x86 node only) → the x86-only tor_onion_service ImageConfig field,
  // which the generator's to_cli_args() folds into the builder's additive --with-tor. Gated so a
  // non-x86 / client entry never emits a dead flag (mirrors the Studio's x86-only tor field).
  if (isTorOnionEligible(e) && e.torOnion) spec['tor_onion_service'] = true;
  const add = e.packagesAdd.trim();
  if (add) spec['packages_add'] = add;
  const drop = e.packagesDrop.trim();
  if (drop) spec['packages_drop'] = drop;
  if (isDesktopClass(e)) {
    if (e.brandingMode === 'preset') {
      if (e.brandingPreset.trim()) spec['branding_preset'] = e.brandingPreset.trim();
    } else {
      const theme: Record<string, unknown> = {};
      if (e.customBrandTitle.trim()) theme['brand_title'] = e.customBrandTitle.trim();
      if (e.customPrimaryColor.trim()) theme['primary_color'] = e.customPrimaryColor.trim();
      if (Object.keys(theme).length) spec['theme'] = theme;
    }
    if (isTailnetSsoEligible(e)) {
      if (e.tailnetJoin) spec['tailscale'] = true;
      if (e.sso) spec['sso'] = true;
    }
    spec['home'] = e.homeEnabled;
  }
  return spec;
}

/** Apply a catalog-modal selection onto an entry (item 9 coupling). Non-destructive of the
 *  fields the modal does not own (targetUser, imageType, sshKeysAllowed, domains, sub-forms). */
export function applySelection(e: WorklistEntry, sel: WorklistEntrySelection): WorklistEntry {
  return {
    ...e,
    role: sel.role,
    platform: sel.platform,
    imageClass: sel.imageClass,
    packagesAdd: sel.packagesAdd ?? e.packagesAdd,
    packagesDrop: sel.packagesDrop ?? e.packagesDrop,
    options: sel.options ?? e.options,
  };
}

/**
 * Assemble the frozen worklist v1 ENVELOPE from the wizard state. Pure + side-effect free so it
 * is unit-testable. The {@code base} carries only CONTENT (mesh domains inverted from per-entry
 * attachedDomains → {@code domains[].images} entry-id refs, and the mesh users); brand / org /
 * superdomain / per-build domain are OMITTED (server-derived). {@code entries} map 1:1 to
 * {@link BatchImageSpec}. Empty base collapses to {@code null}.
 */
export function buildWorklistEnvelope(
  entries: WorklistEntry[],
  users: WorklistUser[],
  maxConcurrent: number,
): WorklistEnvelope {
  const specs: BatchImageSpec[] = entries.map((e) => ({
    targetUser: e.targetUser.trim(),
    imageType: e.imageType,
    hardwareClass: e.platform,
    sshKeysAllowed: e.sshKeysAllowed,
    imageSpec: entryContentSpec(e),
  }));

  // Invert per-entry attachedDomains → base.domains[].images (entry-id refs).
  const domainToEntries = new Map<string, string[]>();
  for (const e of entries) {
    for (const name of e.attachedDomains) {
      const ids = domainToEntries.get(name) ?? [];
      ids.push(entryWireId(e));
      domainToEntries.set(name, ids);
    }
  }
  const domains = [...domainToEntries.entries()].map(([name, images]) => ({ name, images }));

  const base: Record<string, unknown> = {};
  if (domains.length) base['domains'] = domains;
  const cleanUsers = users
    .filter((u) => u.username.trim().length > 0)
    .map((u) => ({
      username: u.username.trim(),
      domain: u.domain.trim(),
      role: u.role.trim(),
      email: u.email.trim(),
    }));
  if (cleanUsers.length) base['users'] = cleanUsers;

  return {
    schema: 'snapdragon-worklist/v1',
    base: Object.keys(base).length ? base : null,
    entries: specs,
    maxConcurrent,
  };
}
