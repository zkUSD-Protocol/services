import { PublicKey, UInt64, Signature, Bool, UInt32 } from 'o1js';
import {
  PriceSubmission,
  OraclePriceSubmissions,
  OracleWhitelist,
} from 'zkusd';
import config from '../config';

import Client from 'mina-signer';

const client = new Client({
  network: 'testnet',
});

/**
 * OracleAggregator collects and validates price submissions from authorized oracles.
 * It ensures price data is properly signed and meets requirements.
 */
class OracleAggregator {
  private oracleKeys;

  constructor() {
    this.oracleKeys = config.oracleKeys;
  }

  /**
   * Collects price submissions from all authorized oracles for a given block height.
   */
  async collectSubmissions(
    blockHeight: UInt32
  ): Promise<OraclePriceSubmissions> {
    try {
      const submissions = Array.from({
        length: OracleWhitelist.MAX_PARTICIPANTS,
      }).map((_, index) => {
        const price = UInt64.from(0.8e9); // 80 cents
        const realOracle = this.oracleKeys[index];

        if (realOracle) {
          // Real oracle submission with signature
          const signature = client.signFields(
            [price.toBigInt(), blockHeight.toBigint()],
            realOracle.privateKey.toBase58()
          );

          return new PriceSubmission({
            publicKey: realOracle.publicKey,
            price: price,
            signature: Signature.fromBase58(signature.signature),
            blockHeight: blockHeight,
            isDummy: Bool(false),
          });
        } else {
          // Dummy oracle submission
          return new PriceSubmission({
            publicKey: config.oracleWhitelist.addresses[index],
            price: price,
            signature: Signature.empty(),
            blockHeight: blockHeight,
            isDummy: Bool(true),
          });
        }
      });

      return { submissions };
    } catch (error) {
      console.error('Error collecting oracle submissions:', error);
      throw new Error('Failed to collect oracle submissions');
    }
  }

  /**
   * Validates a single oracle submission by checking:
   * - Oracle authorization
   * - Signature validity
   * - Timestamp/block height validity
   * - Price bounds
   */
  validateSubmission(submission: PriceSubmission): boolean {
    try {
      // TODO: Implement validation logic:
      // - Check if oracle is in whitelist
      // - Verify signature
      // - Check timestamp/block height
      // - Validate price bounds
      return true;
    } catch (error) {
      console.error('Error validating submission:', error);
      return false;
    }
  }
}

export const oracleAggregator = new OracleAggregator();
