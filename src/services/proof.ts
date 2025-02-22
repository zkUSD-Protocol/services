import { AggregateOraclePrices, OracleWhitelist } from '@zkusd/core';
import { IGenerateProofRequest } from '../types/index.js';
import config from '../config/index.js';
import { ProofModel } from '../models/index.js';
import { Types } from 'mongoose';
import { logger } from '../utils/logger.js';

/**
 * ProofService handles the generation and storage of zero-knowledge proofs
 * for oracle price aggregation. It ensures price submissions are valid
 * and creates proofs that can be verified on-chain.
 */
class ProofService {
  // Whitelist of authorized oracle public keys
  private whitelist: OracleWhitelist;

  /**
   * Initializes the service with network-specific oracle configuration.
   */
  constructor() {
    this.whitelist = config.oracleWhitelist;
  }

  /**
   * Compiles the proof circuit.
   * Must be called before generating proofs.
   */
  async init(): Promise<void> {
    await AggregateOraclePrices.compile();
  }

  /**
   * Generates and stores a zk proof for oracle price submissions:
   * 1. Validates submissions against the oracle whitelist
   * 2. Computes the proof using the AggregateOraclePrices circuit
   * 3. Stores the proof and resulting price in the database
   */
  async generateProof(request: IGenerateProofRequest): Promise<void> {
    const blockHeight = request.blockHeight;
    const oraclePriceSubmissions = request.oraclePriceSubmissions;
    const oracleWhitelistHash = OracleWhitelist.hash(this.whitelist);

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

    try {
      await ProofModel.create({
        blockHeight: Number(request.blockHeight),
        timestamp: new Date(),
        proof: proof.toJSON(),
        price: Types.Decimal128.fromString(
          programOutput.proof.publicOutput.minaPrice.priceNanoUSD.toString()
        ),
      });
    } catch (error) {
      logger.error('Failed to save proof:', error);
      throw new Error('Failed to save proof');
    }
  }
}

export const proof = new ProofService();
