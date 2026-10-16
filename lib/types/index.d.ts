/**
 * Host half of dsh-pet-indesktop — plain JavaScript, no SDK types.
 *
 * This describes `lib/index.js` (the generated shim) and `lib/host/index.js`, the
 * only two files this declaration is about. The browser half is separate: see
 * `lib/types/client/index.d.ts`.
 */

/** The plugin's own name, `'dsh-pet-indesktop'` — not a service name. */
export declare const name: string

/**
 * Static injection, which is safe HERE and only here: this is a cordis service
 * name (`'webServer'`), not a package name, and the host half owns no UI. The
 * browser half deliberately has no `inject` at all — see the client declaration.
 */
export declare const inject: string[]

/** Registers the plugin's one prefix route on `ctx.webServer`. Returns nothing. */
export declare function apply(ctx: unknown): void
