import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountAppeal, BffService } from '../bff.service';

/** A per-row busy/result note surfaced inline next to an appeal's decide actions. */
interface RowNote { id: string; kind: 'ok' | 'err'; text: string; }

/**
 * The ACCOUNT-BAN appeal inbox (ADMIN/SUPERADMIN) — the admin front-end for admin-bff's
 * {@code AccountAppealAdminController} at {@code /bff/admin/account-appeals}.
 *
 * <p>DISTINCT from the {@code Appeals} console ({@code appeals/appeals.component.ts}):
 * that console decides federation-api {@code ModerationRequest} rows, which are
 * CONTENT-moderation appeals over posts/profiles. This console is the ACCOUNT-level
 * domain — a curtailed principal's own appeal against their {@code access_suspension}
 * {@code PROFILE} ban/suspension (filed via login-ui's {@code /login/appeal} page, which
 * POSTs to admin-bff's {@code /bff/me/appeal}).
 *
 * <h3>An APPROVE decide actually restores access</h3>
 * Unlike a simple status flip, an {@code APPROVED} decide here CLEARS the appellant's
 * underlying {@code PROFILE} suspension server-side (admin-bff's
 * {@code SuspensionService.clear}) BEFORE the appeal row flips — the server call
 * fails outright if that restore fails, so a failed approve is surfaced as an ERROR
 * here, never rendered as a success. This console never has to (and never does) claim
 * "approved" on a 200 that didn't actually restore anything; the admin-bff's own
 * ordering guarantees that.
 *
 * <p>Admin gating is defence-in-depth (gateway + resource-server + admin-bff
 * {@code @PreAuthorize("hasAnyRole('ADMIN','SUPERADMIN')")}); this console mirrors it
 * (route-guarded by the host) but the BFF is the source of truth. MOD is deliberately
 * NOT gated in here — MOD cannot ban/unban an account in the first place (see the
 * admin-bff controller javadoc), so it has no business approving an appeal against one.
 */
@Component({
  selector: 'snap-account-appeals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-appeals.component.html',
  styleUrl: './account-appeals.component.scss',
})
export class AccountAppealsComponent implements OnInit {
  private readonly bff = inject(BffService);

  readonly appeals = signal<AccountAppeal[]>([]);
  readonly loaded = signal(false);
  /** Per-row inline notes (decide result / error). */
  readonly notes = signal<RowNote[]>([]);
  /** The id of the row whose decide is currently in flight (disables its buttons). */
  readonly deciding = signal<string | null>(null);

  /** The pending inbox (the headline list) + the already-decided rows (audit/history). */
  readonly pending = computed(() => this.appeals().filter((a) => a.status === 'PENDING'));
  readonly decided = computed(() =>
    this.appeals().filter((a) => a.status !== 'PENDING')
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')));

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.appeals.set(await this.bff.accountAppeals());
    this.loaded.set(true);
  }

  isDeciding(a: AccountAppeal): boolean {
    return this.deciding() === a.id;
  }

  /** Approve — restores the appellant's access. Never shows a success note unless the
   *  server actually confirmed the restore + the appeal row flipped. */
  async approve(a: AccountAppeal): Promise<void> {
    await this.decideRow(a, 'APPROVED');
  }

  /** Deny — the appeal is rejected; the underlying suspension is left untouched. */
  async deny(a: AccountAppeal): Promise<void> {
    await this.decideRow(a, 'DENIED');
  }

  private async decideRow(a: AccountAppeal, status: 'APPROVED' | 'DENIED'): Promise<void> {
    if (this.deciding()) return;
    this.deciding.set(a.id);
    try {
      const res = await this.bff.decideAccountAppeal(a.id, status);
      if (res.decided === 0) {
        this.setNote(a.id, 'err', 'No change — the appeal was already decided or out of scope.');
      } else {
        this.setNote(a.id, 'ok',
          status === 'APPROVED' ? 'Approved — access restored.' : 'Denied.');
      }
      await this.reload();
    } catch (e) {
      // A failed restore (e.g. the underlying access_suspension clear errored) throws
      // here — surfaced as an honest error, NEVER a false "approved".
      this.setNote(a.id, 'err',
        status === 'APPROVED'
          ? 'Approve failed — access was NOT restored: ' + (e as Error).message
          : (e as Error).message);
    } finally {
      this.deciding.set(null);
    }
  }

  private setNote(id: string, kind: 'ok' | 'err', text: string): void {
    this.notes.update((cur) => [...cur.filter((n) => n.id !== id), { id, kind, text }]);
  }
  noteFor(id: string): RowNote | undefined {
    return this.notes().find((n) => n.id === id);
  }

  appealLabel(a: AccountAppeal): string {
    return `account appeal from ${a.handle}`;
  }
}
