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
  templateUrl: './iso-downloads.component.html',
})
export class IsoDownloadsComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly isos = signal<{ name: string; url: string }[]>([]);
  async ngOnInit(): Promise<void> { this.isos.set(await this.bff.isos()); }
}
