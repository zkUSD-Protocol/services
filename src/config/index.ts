import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PrivateKey, PublicKey } from 'o1js';
import path from 'path';
import { OracleWhitelist, blockchain, getNetworkKeys } from 'zkusd';
import { KeyPair } from 'zkusd/types/utility.js';

// Load the appropriate .env file based on the DEPLOY_ENV
const envFile = process.env.DEPLOY_ENV === 'devnet' ? '.env.devnet' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

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
      const publicKeyEnvVar = `DEVNET_ORACLE_${i + 1}_PUBLIC_KEY`;
      const publicKey = process.env[publicKeyEnvVar];
      if (!publicKey) {
        throw new Error(`Missing environment variable: ${publicKeyEnvVar}`);
      }
      whitelist.addresses.push(PublicKey.fromBase58(publicKey));
    }

    // Fill remaining slots with dummy public key
    const remainingSlots = OracleWhitelist.MAX_PARTICIPANTS - numOracles;
    const dummyPublicKey = PublicKey.fromBase58(
      process.env.DEVNET_ORACLE_DUMMY_PUBLIC_KEY!
    );

    for (let i = 0; i < remainingSlots; i++) {
      whitelist.addresses.push(dummyPublicKey);
    }
  }

  return whitelist;
};

const buildOracleKeyList = (chain: blockchain): KeyPair[] => {
  const oracleKeys: KeyPair[] = [];

  if (chain === 'lightnet') {
    const networkKeys = getNetworkKeys(chain);
    networkKeys.oracles!.map((oracle) => {
      oracleKeys.push({
        publicKey: oracle.publicKey,
        privateKey: oracle.privateKey,
      } as KeyPair);
    });
  } else if (chain === 'devnet') {
    const numOracles = parseInt(process.env.NUMBER_OF_ORACLES || '0');

    for (let i = 0; i < numOracles; i++) {
      const publicKeyEnvVar = `DEVNET_ORACLE_${i + 1}_PUBLIC_KEY`;
      const privateKeyEnvVar = `DEVNET_ORACLE_${i + 1}_PRIVATE_KEY`;

      const publicKey = process.env[publicKeyEnvVar];
      const privateKey = process.env[privateKeyEnvVar];

      if (!publicKey || !privateKey) {
        throw new Error(`Missing environment variables for oracle ${i + 1}`);
      }

      oracleKeys.push({
        publicKey: PublicKey.fromBase58(publicKey),
        privateKey: PrivateKey.fromBase58(privateKey),
      });
    }
  }

  return oracleKeys;
};

// Export both the whitelist and oracle keys along with other config
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
  oracleWhitelist: buildOracleWhitelist(
    (process.env.NETWORK as blockchain) || 'local'
  ),
  oracleKeys: buildOracleKeyList(
    (process.env.NETWORK as blockchain) || 'local'
  ),
};

export default config;
