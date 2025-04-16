import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PrivateKey, PublicKey } from 'o1js';
import path from 'path';

import {
  OracleWhitelist,
  blockchain,
  getNetworkKeys,
  KeyPair,
  getContractKeys,
  Oracle,
  getOraclePublicKeys,
  getActiveOracles,
  getOracles,
} from '@zkusd/core';

// Load the appropriate .env file based on the DEPLOY_ENV
if (process.env.NODE_ENV === 'local') {
  if (process.env.NETWORK === 'lightnet') {
    dotenv.config({
      path: path.resolve(process.cwd(), '.env.lightnet'),
      override: true,
    });
  } else {
    dotenv.config({
      path: path.resolve(process.cwd(), '.env.devnet'),
      override: true,
    });
  }
} else {
  dotenv.config();
}

const buildOracleWhitelist = (chain: blockchain): OracleWhitelist => {
  let whitelist = new OracleWhitelist({
    addresses: [],
  });

  if (chain === 'lightnet') {
    // Keep existing approach for lightnet
    const networkKeys = getNetworkKeys(chain);
    for (const key of networkKeys.oracles!) {
      whitelist.addresses.push(key.publicKey);
    }
  } else if (chain === 'devnet') {
    // Use new approach for devnet
    const { oracleWhitelist } = getOracles(chain);
    whitelist = oracleWhitelist;
  }

  return whitelist;
};

/**
 * Builds an array of oracles based on the chain.
 * @param chain The blockchain chain to build oracles for.
 * @returns An array of oracles.
 */
const buildOracles = (chain: blockchain): Array<KeyPair | Oracle> => {
  const oracles: Array<KeyPair | Oracle> = [];

  if (chain === 'lightnet') {
    // Keep existing approach for lightnet
    const networkKeys = getNetworkKeys(chain);
    networkKeys.oracles!.map((oracle) => {
      oracles.push({
        publicKey: oracle.publicKey,
        privateKey: oracle.privateKey,
      } as KeyPair);
    });
  } else if (chain === 'devnet') {
    // Use new approach for devnet
    try {
      // Get active oracles from core config
      const activeOracles = getActiveOracles(chain);

      // Add active oracles
      activeOracles.forEach((oracle) => {
        oracles.push(oracle);
      });

      // Get dummy oracle info for remaining slots
      const { dummyOracleKey, realOraclesCount } = getOracles(chain);
      const dummyPublicKey = dummyOracleKey.toPublicKey();

      // Fill remaining slots with dummy oracle
      const remainingSlots =
        OracleWhitelist.MAX_PARTICIPANTS - realOraclesCount;
      for (let i = 0; i < remainingSlots; i++) {
        oracles.push({
          publicKey: dummyPublicKey,
          privateKey: dummyOracleKey,
        } as KeyPair);
      }
    } catch (error) {
      console.error(`Error building oracles for devnet:`, error);
      // Fallback to empty array if there's an error
    }
  }

  return oracles;
};

const getOracleDummyKey = (chain: blockchain): KeyPair | undefined => {
  if (chain === 'devnet') {
    const { dummyOracleKey } = getOracles(chain);
    return {
      publicKey: dummyOracleKey.toPublicKey(),
      privateKey: dummyOracleKey,
    };
  }
};

const { engine, token } = getContractKeys(process.env.NETWORK as blockchain);

// Export both the whitelist and oracle keys along with other config
const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  network: process.env.NETWORK || 'local',
  blockCheckInterval: process.env.BLOCKCHECK_INTERVAL || 10,
  mongodb: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/zkusd',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    } as mongoose.ConnectOptions,
  },
  enginePublicKey: engine,
  tokenPublicKey: token,
  oracleWhitelist: buildOracleWhitelist(
    (process.env.NETWORK as blockchain) || 'local'
  ),
  oracles: buildOracles((process.env.NETWORK as blockchain) || 'local'),
  dummyOracle: getOracleDummyKey(
    (process.env.NETWORK as blockchain) || 'local'
  ),
};

export default config;
