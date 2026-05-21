// PM2 process definitions for the production VPS.
//
// Usage on the server:
//   cd /srv/Barber-brone
//   npm ci
//   npm run build                          # builds backend + webapp + barber-dev
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup                            # follow the printed command once
//
// To deploy a new release: scripts/deploy.sh handles pull + build + reload.

module.exports = {
  apps: [
    // ---- Shop-facing API + bot (per-shop instance) ----
    // If you host N shops on one box, duplicate this entry N times (with
    // unique `name`, `cwd`, and a per-shop .env in each cwd's apps/backend/).
    {
      name: "barber-backend",
      cwd: "./apps/backend",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: { NODE_ENV: "production" },
      out_file: "./apps/backend/.pm2/out.log",
      error_file: "./apps/backend/.pm2/err.log",
      time: true,
    },

    // ---- Operator / fleet-management bot (one per server) ----
    // Talks to operators (you + any developers you add). Maintains the control
    // database, runs monthly billing reminders + weekly quality reminders,
    // can toggle apprentice / location on any shop's DB it has credentials for.
    {
      name: "barber-operator",
      cwd: "./apps/barber-dev",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "256M",
      env: { NODE_ENV: "production" },
      out_file: "./apps/barber-dev/.pm2/out.log",
      error_file: "./apps/barber-dev/.pm2/err.log",
      time: true,
    },
  ],
};
