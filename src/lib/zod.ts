// zod, as the rest of the code imports it (ESLint refuses "zod" anywhere else in src/).
//
// zod 4 compiles object parsers with `new Function` when it may, and finds out whether it may
// by trying once. Polaris's Content-Security-Policy has no 'unsafe-eval', so in the browser
// that try is blocked and reported as a violation even though zod catches it (and
// e2e/security.spec.ts fails on any violation). `jitless` skips both the compiled parsers and
// the probe; the plain parsers are fast enough for forms and API bodies.
import { z } from "zod";

z.config({ jitless: true });

export { z };
