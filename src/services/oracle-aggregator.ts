import { PublicKey, UInt64, Signature, Bool, UInt32 } from 'o1js';
import {
  PriceSubmission,
  OraclePriceSubmissions,
  OracleWhitelist,
  KeyPair,
  Oracle,
} from '@zkusd/core';
import config from '../config/index.js';
import Client from 'mina-signer';
import { logger } from '../utils/logger.js';

const client = new Client({
  network: 'testnet',
});

const isRealOracle = (oracle: KeyPair | Oracle): oracle is Oracle => {
  return 'endpoint' in oracle && 'publicKey' in oracle;
};

/**
 * OracleAggregator collects and validates price submissions from authorized oracles.
 * It ensures price data is properly signed and meets requirements.
 */
class OracleAggregator {
  private oracles;

  constructor() {
    this.oracles = config.oracles;
  }

  /**
   * Collects price submissions from all authorized oracles for a given block height.
   */
  async collectSubmissions(
    blockHeight: UInt32
  ): Promise<OraclePriceSubmissions> {
    try {
      const submissions = await Promise.all(
        Array.from({
          length: OracleWhitelist.MAX_PARTICIPANTS,
        }).map(async (_, index) => {
          let signature: Signature;
          let price: UInt64;
          let isDummy: Bool;
          let publicKey: PublicKey;

          if (config.network === 'lightnet') {
            price = UInt64.from(0.8e9); // 80 cents
            const signed = client.signFields(
              [price.toBigInt(), blockHeight.toBigint()],
              (this.oracles[index] as KeyPair).privateKey.toBase58()
            );
            signature = Signature.fromBase58(signed.signature);
            isDummy = Bool(false);
            publicKey = (this.oracles[index] as KeyPair).publicKey;
          } else if (config.network === 'devnet') {
            const oracle = this.oracles[index];

            if (isRealOracle(oracle)) {
              try {
                // Add timeout to fetch requests
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                // Fetch price from oracle with better error handling
                const response = await fetch(oracle.endpoint!, {
                  signal: controller.signal,
                }).catch((error) => {
                  logger.warn(`Oracle ${index} fetch failed: ${error.message}`);
                  throw new Error(`Connection to oracle ${index} failed`);
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                  logger.warn(
                    `Oracle ${index} returned status ${response.status}`
                  );
                  throw new Error(
                    `Oracle ${index} returned non-200 status: ${response.status}`
                  );
                }

                const oracleResponse = await response.json().catch((error) => {
                  logger.warn(
                    `Oracle ${index} returned invalid JSON: ${error.message}`
                  );
                  throw new Error(`Oracle ${index} returned invalid JSON`);
                });

                if (oracleResponse.error) {
                  logger.warn(
                    `Oracle ${index} returned error: ${oracleResponse.error}`
                  );
                  throw new Error(
                    `Oracle ${index} returned error: ${oracleResponse.error}`
                  );
                }

                if (
                  !oracleResponse.signed ||
                  !oracleResponse.signed.signature ||
                  !oracleResponse.signed.data ||
                  !oracleResponse.signed.data.price ||
                  !oracleResponse.signed.data.blockHeight
                ) {
                  logger.warn(`Oracle ${index} returned incomplete data`);
                  throw new Error(`Oracle ${index} returned incomplete data`);
                }

                price = UInt64.from(oracleResponse.signed.data.price);
                signature = Signature.fromBase58(
                  oracleResponse.signed.signature
                );
                publicKey = oracle.publicKey;
                isDummy = Bool(false);

                // Verify the signature
                const validSig: Bool = signature.verify(publicKey, [
                  price.toFields()[0],
                  blockHeight.toFields()[0],
                ]);

                if (!validSig) {
                  logger.warn(`Oracle ${index} returned invalid signature`);
                  throw new Error(`Oracle ${index} returned invalid signature`);
                }

                // Log successful submission
                logger.info(
                  `✅ Successfully received valid price from oracle ${index}`
                );
              } catch (error: any) {
                // On any error with this oracle, fall back to a dummy submission
                //TODO: Handle this better
                logger.warn(
                  `Oracle ${index} fetch failed, using dummy submission: ${error.message}`
                );

                // Use a fallback dummy submission for this oracle

                price = UInt64.MAXINT();
                const dummySigned = client.signFields(
                  [price.toBigInt(), blockHeight.toBigint()],
                  (config.dummyOracle as KeyPair).privateKey.toBase58()
                );
                signature = Signature.fromBase58(dummySigned.signature);
                isDummy = Bool(true);
                publicKey = config.dummyOracle!.publicKey; // We are in devnet here
              }
            } else {
              // Dummy oracle submission
              price = UInt64.MAXINT(); //dummy price
              const dummySigned = client.signFields(
                [price.toBigInt(), blockHeight.toBigint()],
                (this.oracles[index] as KeyPair).privateKey.toBase58()
              );
              signature = Signature.fromBase58(dummySigned.signature);
              isDummy = Bool(true);
              publicKey = (this.oracles[index] as KeyPair).publicKey;
            }
          } else {
            throw new Error('Invalid network');
          }

          return new PriceSubmission({
            publicKey,
            price,
            signature,
            blockHeight,
            isDummy,
          });
        })
      );

      // Add check to ensure we have enough valid submissions
      const validSubmissions = submissions.filter(
        (s) => !s.isDummy.toBoolean()
      );
      logger.info(
        `Collected ${validSubmissions.length} valid oracle submissions out of ${submissions.length} total`
      );

      if (validSubmissions.length === 0) {
        logger.error('No valid oracle submissions received!');
        throw new Error('Failed to collect any valid oracle submissions');
      }

      return { submissions };
    } catch (error) {
      logger.error('Error collecting oracle submissions:', error);
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
