import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PrivateKey, PublicKey } from 'o1js';
import path from 'path';
import { Oracle } from '../types/oracle';
import {
  OracleWhitelist,
  blockchain,
  getNetworkKeys,
  KeyPair,
  getContractKeys,
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
  const whitelist = new OracleWhitelist({
    addresses: [],
  });

  if (chain === 'lightnet') {
    const networkKeys = getNetworkKeys(chain);
    for (const key of networkKeys.oracles!) {
      whitelist.addresses.push(key.publicKey);
    }
  } else if (chain === 'devnet') {
    const numOracles = parseInt(process.env.NUMBER_OF_ORACLES || '0');

    // Add the real oracle public keys we have
    for (let i = 0; i < numOracles; i++) {
      const publicKeyEnvVar = `ORACLE_${i + 1}_PUBLIC_KEY`;
      const publicKey = process.env[publicKeyEnvVar];
      if (!publicKey) {
        throw new Error(`Missing environment variable: ${publicKeyEnvVar}`);
      }
      whitelist.addresses.push(PublicKey.fromBase58(publicKey));
    }

    // Fill remaining slots with dummy public key
    const remainingSlots = OracleWhitelist.MAX_PARTICIPANTS - numOracles;
    const dummyPublicKey = PublicKey.fromBase58(
      process.env.ORACLE_DUMMY_PUBLIC_KEY || ''
    );

    for (let i = 0; i < remainingSlots; i++) {
      whitelist.addresses.push(dummyPublicKey);
    }
  }

  return whitelist;
};

const buildOracles = (chain: blockchain): Array<KeyPair | Oracle> => {
  const oracles: Array<KeyPair | Oracle> = [];

  if (chain === 'lightnet') {
    const networkKeys = getNetworkKeys(chain);
    networkKeys.oracles!.map((oracle) => {
      oracles.push({
        publicKey: oracle.publicKey,
        privateKey: oracle.privateKey,
      } as KeyPair);
    });
  } else if (chain === 'devnet') {
    const numOracles = parseInt(process.env.NUMBER_OF_ORACLES || '0');

    for (let i = 0; i < numOracles; i++) {
      const publicKeyEnvVar = `ORACLE_${i + 1}_PUBLIC_KEY`;
      const endpointEnvVar = `ORACLE_${i + 1}_ENDPOINT`;
      const publicKey = process.env[publicKeyEnvVar];
      const endpoint = process.env[endpointEnvVar];

      if (!publicKey || !endpoint) {
        throw new Error(`Missing oracle ${i + 1} config`);
      }

      oracles.push({
        publicKey: PublicKey.fromBase58(publicKey),
        endpoint: endpoint,
      } as Oracle);
    }

    // Add dummy oracle
    const remainingSlots = OracleWhitelist.MAX_PARTICIPANTS - numOracles;
    for (let i = 0; i < remainingSlots; i++) {
      oracles.push({
        publicKey: PublicKey.fromBase58(
          process.env.ORACLE_DUMMY_PUBLIC_KEY || ''
        ),
        privateKey: PrivateKey.fromBase58(
          process.env.ORACLE_DUMMY_PRIVATE_KEY || ''
        ),
      } as KeyPair);
    }
  }

  return oracles;
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
  dummyOracle: {
    publicKey: PublicKey.fromBase58(process.env.ORACLE_DUMMY_PUBLIC_KEY || ''),
    privateKey: PrivateKey.fromBase58(
      process.env.ORACLE_DUMMY_PRIVATE_KEY || ''
    ),
  },
};

export default config;
