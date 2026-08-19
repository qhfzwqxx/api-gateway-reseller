const projectRoot = process.env.PROJECT_ROOT || __dirname;

const commonAppOptions = {
  max_restarts: 10,
  min_uptime: "30s",
  restart_delay: 10000,
  kill_timeout: 15000
};

module.exports = {
  apps: [
    {
      ...commonAppOptions,
      name: "api-gateway-api",
      cwd: projectRoot,
      script: "apps/api/dist/server.js",
      interpreter: "node",
      exec_mode: "cluster",
      instances: 1,
      wait_ready: true,
      listen_timeout: 45000,
      kill_timeout: 150000,
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=768"
      }
    },
    {
      ...commonAppOptions,
      name: "api-gateway-web",
      cwd: projectRoot,
      script: "npm",
      args: "run start --workspace apps/web",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=384"
      }
    }
  ]
};
