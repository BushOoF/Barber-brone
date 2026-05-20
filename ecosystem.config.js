// PM2 process definition for the backend.
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup
module.exports = {
  apps: [
    {
      name: "barber-backend",
      cwd: "./apps/backend",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      // Logs land in ~/.pm2/logs/barber-backend-*
      out_file: "./apps/backend/.pm2/out.log",
      error_file: "./apps/backend/.pm2/err.log",
      time: true,
    },
  ],
};
