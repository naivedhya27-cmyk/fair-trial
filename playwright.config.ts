// End-to-end smoke (S19): a production build served by `next start` on a phone profile. Run `npm run build` first,
// then `npm run e2e`. No YouCam key is needed: the smoke never analyses a photo.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3130);

export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: { command: `npx next start -p ${PORT} -H 127.0.0.1`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: false, timeout: 120_000 },
});
