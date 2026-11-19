import { Component, OnInit, WritableSignal, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService, TorNodeView } from '../bff.service';

/** One domain with its own Tor address, as the nodes reported it. */
export interface TorDomainRow {
  domain: string;
  addresses: string[];
}

/** What the inline confirmation says before the second click (the same words as the Studio). */
export const TOR_RENEW_WARNING =
  "A new address replaces this domain's Tor address. The old one stops working at once, " +
  'for everyone who has it, and cannot be brought back from here.';

/**
 * "Tor addresses" (hugmesh-generator#652): each domain's own onion address, and a way to
 * ask for a new one. A domain ADMIN sees and acts on their own domain only, a SUPERADMIN
 * on every domain (the BFF redacts the list and refuses the request; this page only
 * shows what it is given). The mesh's own address is listed and never replaced here.
 *
 * Two steps, both inline (never a native confirm()): "New address…" opens the warning
 * and a box where the domain's key name is typed again; "Make a new address" is enabled
 * only when it matches. The Tor nodes make the address within minutes and report it, so
 * the page says so instead of showing a new address it does not have yet.
 */
@Component({
  selector: 'hug-tor-addresses',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tor-addresses.component.html',
  styleUrl: './tor-addresses.component.scss',
})
export class TorAddressesComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly warning = TOR_RENEW_WARNING;
  readonly rows = signal<TorDomainRow[]>([]);
  readonly primary = signal<string[]>([]);
  readonly loadError = signal('');
  readonly loaded = signal(false);
  /** The domain whose confirmation is open, and what was typed into it. */
  readonly asking = signal('');
  typed = '';
  readonly busy = signal(false);
  /** Per-domain result line (role=status) or refusal (role=alert). */
  readonly notice = signal<Record<string, string>>({});
  readonly error = signal<Record<string, string>>({});

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      const nodes = await this.bff.torNodes();
      this.rows.set(TorAddressesComponent.byDomain(nodes));
      this.primary.set([...new Set(nodes.map((n) => n.primary).filter((p): p is string => !!p))].sort());
      this.loadError.set('');
    } catch (e) {
      this.loadError.set((e as Error)?.message || 'The Tor addresses could not be read.');
    }
    this.loaded.set(true);
  }

  /** Every domain with an onion on any node, its distinct addresses sorted. */
  static byDomain(nodes: TorNodeView[]): TorDomainRow[] {
    const m = new Map<string, Set<string>>();
    for (const n of nodes) {
      for (const [d, onion] of Object.entries(n.domains ?? {})) {
        if (!onion) continue;
        if (!m.has(d)) m.set(d, new Set());
        m.get(d)!.add(onion);
      }
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([domain, set]) => ({ domain, addresses: [...set].sort() }));
  }

  ask(domain: string): void {
    this.asking.set(domain);
    this.typed = '';
    this.setFor(this.error, domain, '');
    this.setFor(this.notice, domain, '');
  }

  cancel(): void {
    this.asking.set('');
    this.typed = '';
  }

  confirmed(domain: string): boolean {
    return this.typed.trim() === domain;
  }

  async renew(domain: string): Promise<void> {
    if (!this.confirmed(domain) || this.busy()) return;
    this.busy.set(true);
    try {
      const r = await this.bff.torRequestNewAddress(domain, this.typed.trim());
      this.setFor(this.notice, domain,
        `A new address was asked for (request ${r.requestCount}). Each Tor node makes it within a ` +
        'few minutes and reports it; this page shows it once reported. The old address already ' +
        'stops working as each node applies it.');
      this.cancel();
    } catch (e) {
      this.setFor(this.error, domain, (e as Error)?.message || 'The request was refused.');
    } finally {
      this.busy.set(false);
    }
  }

  private setFor(sig: WritableSignal<Record<string, string>>, domain: string, text: string): void {
    sig.set({ ...sig(), [domain]: text });
  }
}
