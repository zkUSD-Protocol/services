import dotenv from 'dotenv';

dotenv.config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  network: process.env.NETWORK || 'local',
  blockCheckInterval: process.env.BLOCKCHECK_INTERVAL || 10,
  // Add other configuration variables here
};

export default config;
