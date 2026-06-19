import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/auth.interceptor';

// The migrated datastore services (e.g. AnnouncementsStore) delegate to the
// generated ng-openapi-gen clients (src/app/api), which wrap HttpClient over the
// same-origin /bff/admin/** surface, so the dev shell must provide HttpClient.
// In production the host shell provides its own HttpClient; these services are
// providedIn:'root' so they resolve from whichever app bootstraps them. The
// authInterceptor injects the session bffToken (same as the fetch-based
// services), so the generated clients carry the SAME Bearer auth.
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
}).catch((err) => console.error(err));
