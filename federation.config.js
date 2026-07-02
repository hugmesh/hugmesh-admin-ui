// REMOTE bundle config for the Admin micro-frontend (native-federation remote
// name "admin"). The snapdragon.systems host consumes the single exposed
// `./routes` module via loadRemoteModule({ remoteName: 'admin', exposedModule:
// './routes' }) and mounts ADMIN_ROUTES at /admin — so the remote name and the
// exposed module key MUST stay unchanged or the host's admin console breaks.
//
// The shared-deps surface + RxJS skip list live in ./federation-base.js so a
// change to the federation contract lands in one file, consistent with the host
// and every other Snapdragon remote (games convention).
const { snapdragonRemote } = require('./federation-base');

module.exports = snapdragonRemote({
  name: 'admin',
  exposes: {
    './routes': './src/app/admin.routes.ts',
  },
  // native-federation's shared-bundler resolves @xterm/xterm via its UMD
  // `main` entry (the package DOES ship ESM under `module`, but the share
  // bundler doesn't pick it), producing a shared bundle exposing just
  // `export default` — so the components' `import { Terminal } from
  // '@xterm/xterm'` fails to link at runtime ("does not provide an export
  // named 'Terminal'") and takes down the whole /admin route. Skipping it
  // makes esbuild BUNDLE the package into the exposed chunks, where its
  // interop resolves the named import. Don't cargo-cult this: extraSkip is
  // only needed when the share bundler mis-picks an entry; a dep with a clean
  // ESM share works fine shared.
  // (Same extraSkip escape hatch snapdragon.games uses for unshareable deps.)
  extraSkip: ['@xterm/xterm'],
});
