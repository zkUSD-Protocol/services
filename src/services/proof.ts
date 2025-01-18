import {
  PublicKey,
  UInt64,
  Signature,
  Bool,
  UInt32,
  Mina,
  Field,
  DynamicProof,
} from 'o1js';
import {
  AggregateOraclePrices,
  OraclePriceSubmissions,
  PriceSubmission,
  OracleWhitelist,
  computeOracleWhitelistHash,
  oracleAggregationVk,
  MinaPriceInput,
} from 'zkusd';
import { StoredProof, GenerateProofRequest } from '../types';
import crypto from 'crypto';
import { getNetworkKeys } from 'zkusd';
import { blockchain } from 'zkcloudworker';
import { database } from './database';
import config from '../config';

class ProofService {
  private proofs: StoredProof[] = [];
  private whitelist: OracleWhitelist;

  constructor() {
    const networkKeys = getNetworkKeys(config.network as blockchain);

    this.whitelist = new OracleWhitelist({
      addresses: [],
    });

    for (const key of networkKeys.oracles!) {
      this.whitelist.addresses.push(key.publicKey);
    }
  }

  async init(): Promise<void> {
    await AggregateOraclePrices.compile();
  }

  async generateProof(request: GenerateProofRequest): Promise<StoredProof> {
    const blockHeight = request.blockHeight;
    const oraclePriceSubmissions = request.oraclePriceSubmissions;
    const oracleWhitelistHash = computeOracleWhitelistHash(this.whitelist);

    // Generate the proof
    const programOutput = await AggregateOraclePrices.compute(
      {
        currentBlockHeight: blockHeight,
        oracleWhitelistHash,
      },
      {
        oracleWhitelist: this.whitelist,
        oraclePriceSubmissions,
      }
    );

    const proof = programOutput.proof;

    const storedProof: StoredProof = {
      id: crypto.randomUUID(),
      blockHeight: request.blockHeight,
      timestamp: new Date(),
      proof: proof.toJSON(),
      price: programOutput.proof.publicOutput.minaPrice.priceNanoUSD,
    };

    await database.saveProof(storedProof);
    return storedProof;
  }
}

export const proof = new ProofService();
