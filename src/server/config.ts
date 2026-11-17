import { resolve } from 'node:path';

const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: resolve(process.env.DATA_DIR ?? './data'),
  /** number of trusted reverse-proxy hops (0 = none, use socket address) */
  trustProxy: int(process.env.TRUST_PROXY, 0),
  /** local development / tests only: skip https redirect */
  insecureDev: process.env.ALLOW_INSECURE_DEV === '1',
  /** if set, requests for any other Host/Origin are rejected (e.g. dlg.runiksoft.com) */
  appHost: (process.env.APP_HOST ?? '').toLowerCase(),
  /** REQUIRE_TOTP=0 disables the second factor (password-only login). Default: required. */
  requireTotp: process.env.REQUIRE_TOTP !== '0',
  distDir: resolve(process.env.DIST_DIR ?? './dist/client'),
  // brute-force knobs
  ipFailThreshold: int(process.env.IP_FAIL_THRESHOLD, 5),
  globalFailThreshold: int(process.env.GLOBAL_FAIL_THRESHOLD, 20),
};
