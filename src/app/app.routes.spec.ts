import { routes } from './app.routes';
import { ADMIN_ROUTES } from './admin.routes';

/**
 * The dev-shell routes (used only by `ng serve admin` standalone) must mount the
 * exact same ADMIN_ROUTES the host federates, so standalone behaviour matches
 * the federated behaviour.
 */
describe('app.routes (standalone dev shell)', () => {
  it('mounts the exposed ADMIN_ROUTES as children of the root path', () => {
    expect(routes.length).toBe(1);
    expect(routes[0].path).toBe('');
    expect(routes[0].children).toBe(ADMIN_ROUTES);
  });
});
