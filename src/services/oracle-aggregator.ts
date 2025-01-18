import { PublicKey, UInt64, Signature, Bool, UInt32 } from 'o1js';
import { getNetworkKeys, PriceSubmission, OraclePriceSubmissions } from 'zkusd';
import config from '../config';
import { blockchain } from 'zkcloudworker';
import Client from 'mina-signer';

const client = new Client({
  network: 'testnet',
});

class OracleAggregatorService {
  private networkKeys;

  constructor() {
    this.networkKeys = getNetworkKeys(config.network as blockchain);
  }

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
        const price = UInt64.from(1e9);

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

  validateSubmission(submission: PriceSubmission): boolean {
    try {
      // Implement validation logic:
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

export const oracleAggregator = new OracleAggregatorService();
