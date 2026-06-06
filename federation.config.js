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
});
