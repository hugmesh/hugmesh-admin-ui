import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService } from './bff.service';

/**
 * Admin "ISO downloads" view (ROLE_ADMIN only, route-guarded). Lists the latest
 * ISO artifacts delivered by the GitLab/ArgoCD CI pipeline (devops namespace).
 * The BFF returns signed, gateway-internal artifact URLs — the KEYS material is
 * NEVER part of these images, so nothing secret is exposed on this interface.
 */
@Component({
  selector: 'snap-iso-downloads',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="snap-isos" data-testid="iso-view">
      <h2>ISO downloads</h2>
      <p *ngIf="!isos().length" data-testid="iso-empty">No ISO builds delivered yet.</p>
      <ul data-testid="iso-list">
        <li *ngFor="let iso of isos()" [attr.data-iso]="iso.name">
          <a [attr.href]="iso.url" [attr.data-iso-url]="iso.url" download>{{ iso.name }}</a>
        </li>
      </ul>
    </section>
  `,
})
export class IsoDownloadsComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly isos = signal<{ name: string; url: string }[]>([]);
  async ngOnInit(): Promise<void> { this.isos.set(await this.bff.isos()); }
}
