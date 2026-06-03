import { Routes } from '@angular/router';
import { ADMIN_ROUTES } from './admin.routes';

/** Dev-shell routes: mount the exposed Admin routes at the root so the remote
 *  is browsable standalone. The host ignores this and loads `./routes`. */
export const routes: Routes = [{ path: '', children: ADMIN_ROUTES }];
