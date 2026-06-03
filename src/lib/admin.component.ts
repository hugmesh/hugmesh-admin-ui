import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BffService } from './bff.service';

/**
 * Admin micro-frontend (own repo: snapdragon-admin-ui). Visible only to Casdoor
 * ROLE_ADMIN users (route-guarded). Manages the registration allowlist by Gmail
 * address OR Discord username, calling the Spring admin API behind the gateway,
 * which invites the identity in Casdoor via the snapdragon-pki gateway.
 */
@Component({
  selector: 'snap-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="snap-admin" data-testid="admin-view">
      <h2>Admin — invited accounts</h2>
      <form (ngSubmit)="inviteEmail()">
        <input data-testid="admin-email" [(ngModel)]="email" name="email" placeholder="invitee@gmail.com" />
        <button data-testid="admin-invite" type="submit">Invite Gmail</button>
      </form>
      <form (ngSubmit)="inviteDiscord()">
        <input data-testid="admin-discord" [(ngModel)]="discord" name="discord" placeholder="discord-username" />
        <button data-testid="admin-invite-discord" type="submit">Invite Discord</button>
      </form>
      <h3>Gmail</h3>
      <ul data-testid="admin-allowlist">
        <li *ngFor="let e of emails()" [attr.data-email]="e">{{ e }}</li>
      </ul>
      <h3>Discord</h3>
      <ul data-testid="admin-allowlist-discord">
        <li *ngFor="let d of discordUsers()" [attr.data-discord]="d">{{ d }}</li>
      </ul>
    </section>
  `,
})
export class AdminComponent implements OnInit {
  private readonly bff = inject(BffService);
  email = '';
  discord = '';
  readonly emails = signal<string[]>([]);
  readonly discordUsers = signal<string[]>([]);

  async ngOnInit(): Promise<void> { this.refresh(await this.bff.allowlist()); }
  private refresh(a: { emails: string[]; discord: string[] }): void {
    this.emails.set(a.emails); this.discordUsers.set(a.discord);
  }
  async inviteEmail(): Promise<void> {
    if (!this.email.trim()) return;
    this.refresh(await this.bff.invite('email', this.email.trim().toLowerCase())); this.email = '';
  }
  async inviteDiscord(): Promise<void> {
    if (!this.discord.trim()) return;
    this.refresh(await this.bff.invite('discord', this.discord.trim().toLowerCase())); this.discord = '';
  }
}
