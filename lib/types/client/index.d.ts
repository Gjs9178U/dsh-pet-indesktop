/**
 * Browser half of dsh-pet-indesktop.
 *
 * ACCURACY NOTE — read this before trusting the declarations below.
 *
 * `lib/client.js` is NOT an ES module. It is a plain script in the DSH loader
 * wrapper, `window.__ModuleLoader__.load({ id, factory })`, which the web shell
 * evaluates with `window.__ModuleLoader__` defined. There is therefore no import
 * specifier that can be typed against it, and no `export` statement in the file;
 * these declarations describe the `module.exports` object the factory returns,
 * which is what a loader hands back.
 *
 * The absence of a declared `inject` is intentional and load-bearing: a static
 * dependency the host cannot satisfy leaves the plugin's fiber pending forever,
 * and the web boot then fails with "web boot: N entry did not activate".
 * Everything is resolved with cordis dynamic injection instead.
 */

/** The `id` of the injected `<style>` element. */
export declare const STYLE_ID: string

/** The stylesheet, as one template literal. A backtick inside it breaks it. */
export declare const CSS: string

/** The class names the sheet and the markup share. */
export declare const CLASS: Record<string, string>

/** Resolves the services dynamically and claims one seat; returns nothing. */
export declare function apply(ctx: unknown): void
