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
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit {
  private readonly bff = inject(BffService);
  email = '';
  discord = '';
  readonly emails = signal<string[]>([]);
  readonly discordUsers = signal<string[]>([]);
  /** Inline validation messages surfaced in role=alert live regions. Empty = valid. */
  readonly emailError = signal('');
  readonly discordError = signal('');

  async ngOnInit(): Promise<void> { this.refresh(await this.bff.allowlist()); }
  private refresh(a: { emails: string[]; discord: string[] }): void {
    this.emails.set(a.emails); this.discordUsers.set(a.discord);
  }
  async inviteEmail(): Promise<void> {
    if (!this.email.trim()) { this.emailError.set('Enter a Gmail address to invite.'); return; }
    this.emailError.set('');
    this.refresh(await this.bff.invite('email', this.email.trim().toLowerCase())); this.email = '';
  }
  async inviteDiscord(): Promise<void> {
    if (!this.discord.trim()) { this.discordError.set('Enter a Discord username to invite.'); return; }
    this.discordError.set('');
    this.refresh(await this.bff.invite('discord', this.discord.trim().toLowerCase())); this.discord = '';
  }
}
