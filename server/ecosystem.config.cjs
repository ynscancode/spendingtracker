module.exports = {
  apps: [{
    name: 'budget-api',
    script: 'src/index.js',
    env_production: {
      NODE_ENV: 'production',
      PORT: 4000,
      DB_PATH: '/data/budget.db',
      CORS_ORIGIN: '', // set via: pm2 set budget-api:CORS_ORIGIN https://your-vercel-url
    }
  }]
}
