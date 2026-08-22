// The scoring engine itself lives at server/src/pickleball.js, and this
// file is only a re-export so client imports keep working unchanged.
//
// It lives on the server side because of a deploy constraint, not a
// design preference: the Railway API service builds with its root
// directory set to `server/`, so anything outside that directory is
// simply not uploaded. A server import of `../src/lib/pickleball.js`
// would work locally and then fail in production. The client build, by
// contrast, runs from the repo root and can reach into `server/` fine —
// so the only location both sides can see is inside `server/`.
//
// Keeping ONE copy matters more than the tidiness of its location. Two
// copies of the scoring rules would not diverge loudly: they would just
// quietly declare different winners for the same match, and the export
// would disagree with what the umpire watched on screen.
export * from '../../server/src/pickleball.js'
