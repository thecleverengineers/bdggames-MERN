/**
 * PM2 runs one API process. The application owns a real-time game clock and
 * Socket.IO room events, so scaling it horizontally requires a shared job lock
 * and Socket.IO adapter before increasing instances.
 */
module.exports = {
  apps: [
    {
      name: "bdggames-mern",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      kill_timeout: 10000,
      listen_timeout: 10000,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "development",
        PORT: 5000,
        COOKIE_SECURE: "false"
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
        COOKIE_SECURE: "true"
      }
    }
  ]
};
