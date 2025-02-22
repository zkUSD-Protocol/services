import { fetchLastBlock, UInt32 } from 'o1js';
import { proof } from './proof.js';
import { oracleAggregator } from './oracle-aggregator.js';
import config from '../config/index.js';
import { eventProcessor } from './event-processor.js';
import { logger } from '../utils/logger.js';

/**
 * Orchestrator coordinates block monitoring, oracle price aggregation, price proof generation,
 * and event processing for the zkUSD system. It ensures these operations happen
 * sequentially and reliably for each new block.
 */
class Orchestrator {
  // Tracks the most recently processed block height
  private currentBlockHeight: UInt32 = UInt32.from(0);
  // Flag to control the block watching loop
  private isWatching: boolean = false;
  // Timer handle for the block checking interval
  private watchTimeout: NodeJS.Timeout | null = null;
  // Flag to prevent concurrent block processing
  private isProcessing: boolean = false;

  /**
   * Begins watching for new blocks if not already watching.
   * Sets up a recurring check based on blockCheckInterval config.
   */
  async start() {
    if (this.isWatching) {
      logger.info('Orchestrator already running');
      return;
    }

    this.isWatching = true;
    logger.info('Beginning to watch for new blocks');

    // Start the first check
    this.scheduleNextCheck();
  }

  /**
   * Stops watching for new blocks and cleans up the check timer.
   */
  stop() {
    if (this.watchTimeout) {
      clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    this.isWatching = false;
    logger.info('Orchestrator stopped');
  }

  /**
   * Schedules the next block check based on the configured interval.
   */
  private scheduleNextCheck() {
    if (!this.isWatching) return;

    this.watchTimeout = setTimeout(
      async () => {
        try {
          logger.info('🔍 Checking for new block');
          await this.checkNewBlock();
        } catch (error) {
          logger.error('Error checking new block:', error);
        } finally {
          this.scheduleNextCheck();
        }
      },
      Number(config.blockCheckInterval) * 1000
    );
  }

  /**
   * Checks for a new block and processes it if found.
   * Prevents concurrent processing of blocks.
   */
  private async checkNewBlock() {
    // If already processing a block, skip this check
    if (this.isProcessing) {
      logger.info('Still processing previous block, skipping check');
      return;
    }

    try {
      this.isProcessing = true;
      const latestBlock = await fetchLastBlock();
      const blockHeight = latestBlock.blockchainLength;

      if (blockHeight.toBigint() > this.currentBlockHeight.toBigint()) {
        logger.info('🔍 New block detected');
        logger.info(
          `📦 Processing from block ${this.currentBlockHeight.toBigint()} to ${blockHeight.toBigint()}`
        );
        await this.handleNewBlock(blockHeight);
        this.currentBlockHeight = blockHeight;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processes a new block by:
   * 1. Collecting oracle price submissions
   * 2. Generating a price proof
   * 3. Processing on-chain events
   * 4. Updating vault states
   */
  private async handleNewBlock(blockHeight: UInt32) {
    try {
      logger.info(
        '🔍 New block processing started ═══════════════════════════'
      );
      logger.info(`📦 Block Height: ${blockHeight.toString()}`);

      logger.info('\n📡 Collecting oracle submissions...');
      const submissions =
        await oracleAggregator.collectSubmissions(blockHeight);
      logger.info(`✅ Collected oracle submissions`);

      logger.info('\n🔐 Generating proof...');
      console.time('⏱️ Proof generation duration');

      try {
        await Promise.race([
          proof.generateProof({
            blockHeight: blockHeight,
            oraclePriceSubmissions: submissions,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Proof generation timeout')),
              60000
            )
          ),
        ]);
      } catch (error) {
        logger.error(`❌ Proof generation failed:`, error);
        process.exit(1);
      }

      console.timeEnd('⏱️ Proof generation duration');
      logger.info('✅ Proof generation successful');

      // Process events
      logger.info('\n📋 Processing on-chain events...');
      const events = await eventProcessor.processEvents(blockHeight);
      if (events && events.length > 0) {
        logger.info('\n📜 Updated the vaults from the following events:');
        events.forEach((event, index) => {
          logger.info(`   ${index + 1}. Type: ${event.type}`);
          logger.info(
            `      Data: ${JSON.stringify(event.event.data, null, 2)}`
          );
        });
      } else {
        logger.info('   🚫 No vaults updated from this block');
      }

      logger.info(
        '\n✨ Block processing completed successfully ═══════════════'
      );
    } catch (error) {
      logger.error(`❌ Error processing block ${blockHeight}:`);
      logger.error(error as string);
    }
  }
}

export const orchestrator = new Orchestrator();
