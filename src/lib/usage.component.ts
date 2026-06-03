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
  template: `
    <section class="snap-usage" data-testid="usage-view">
      <h2>Usage analytics</h2>
      <p data-testid="usage-summary">
        Active users (1h): <strong data-testid="usage-active">{{ usage()?.activeUsers ?? 0 }}</strong>
        · Total events: <strong data-testid="usage-total">{{ usage()?.totalEvents ?? 0 }}</strong>
      </p>
      <h3>By module</h3>
      <table data-testid="usage-by-module">
        <tr><th>Module</th><th>Events</th><th>Users</th></tr>
        <tr *ngFor="let m of usage()?.byModule" [attr.data-module]="m.module">
          <td>{{ m.module }}</td><td>{{ m.events }}</td><td>{{ m.users }}</td>
        </tr>
      </table>
      <h3>By action</h3>
      <table data-testid="usage-by-action">
        <tr><th>Action</th><th>Events</th></tr>
        <tr *ngFor="let a of usage()?.byAction" [attr.data-action]="a.action">
          <td>{{ a.action }}</td><td>{{ a.events }}</td>
        </tr>
      </table>
    </section>
  `,
})
export class UsageComponent implements OnInit {
  private readonly bff = inject(BffService);
  readonly usage = signal<any | null>(null);
  async ngOnInit(): Promise<void> { this.usage.set(await this.bff.usage()); }
}
