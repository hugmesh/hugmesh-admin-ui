import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Standalone dev shell for the Admin remote. Only used when this remote is
 * run on its own (`ng serve admin`); in production the snapdragon.systems
 * host federates `./routes` (ADMIN_ROUTES) directly — this shell is not loaded.
 */
@Component({
  selector: 'snap-admin-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent {}
