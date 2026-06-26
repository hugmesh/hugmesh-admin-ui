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
// authInterceptor sets withCredentials (same as the fetch-based services'
// credentials:'include'), so the generated clients ride the SAME HttpOnly bff_
// cookie (the gateway turns it into the bearer server-side).
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
}).catch((err) => console.error(err));
