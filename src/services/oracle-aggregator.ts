import { PublicKey, UInt64, Signature, Bool, UInt32 } from 'o1js';
import { getNetworkKeys, PriceSubmission, OraclePriceSubmissions } from 'zkusd';
import config from '../config';
import { blockchain } from 'zkcloudworker';
import Client from 'mina-signer';

const client = new Client({
  network: 'testnet',
});

/**
 * OracleAggregator collects and validates price submissions from authorized oracles.
 * It ensures price data is properly signed and meets requirements.
 */
class OracleAggregator {
  // Network-specific oracle configuration
  private networkKeys;

  constructor() {
    this.networkKeys = getNetworkKeys(config.network as blockchain);
  }

  /**
   * Collects price submissions from all authorized oracles for a given block height.
   */
  async collectSubmissions(
    blockHeight: UInt32
  ): Promise<OraclePriceSubmissions> {
    try {
      // In production, this would:
      // 1. Query each oracle endpoint or smart contract
      // 2. Validate signatures and timestamps
      // 3. Filter out invalid or stale submissions
      // 4. Handle timeouts and retries

      // For now, using dummy data from test oracles
      const submissions = this.networkKeys.oracles!.map((oracle) => {
        const price = UInt64.from(0.8e9); // 80 cents

        const signature = client.signFields(
          [price.toBigInt(), blockHeight.toBigint()],
          oracle.privateKey.toBase58()
        );

        return new PriceSubmission({
          publicKey: oracle.publicKey,
          price: price,
          signature: Signature.fromBase58(signature.signature),
          blockHeight: blockHeight,
          isDummy: Bool(false),
        });
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
