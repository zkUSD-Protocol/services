import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  network: process.env.NETWORK || 'local',
  blockCheckInterval: process.env.BLOCKCHECK_INTERVAL || 10,
  mongodb: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/zkusd',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    } as mongoose.ConnectOptions,
  },
  engineAddress: process.env.ENGINE_ADDRESS || '',
  tokenAddress: process.env.TOKEN_ADDRESS || '',
};

export default config;
