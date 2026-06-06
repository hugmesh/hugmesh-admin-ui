import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BffService } from './bff.service';

/**
 * Admin "Usage" micro-frontend view (own repo: snapdragon-admin-ui). Visible
 * only to the Casdoor admin role (route-guarded). Shows live infra usage by
 * users, aggregated by the Spring admin BFF from ClickHouse (events arrive
 * via Kafka in production). Lets admins track active use of our infrastructure.
 */
@Component({
  selector: 'snap-usage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './usage.component.html',
  styleUrl: './usage.component.scss',
})
export class UsageComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly usage = signal<any | null>(null);
  async ngOnInit(): Promise<void> { this.usage.set(await this.bff.usage()); }
}
