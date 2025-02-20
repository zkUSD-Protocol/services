import {
  Mina,
  PublicKey,
  UInt64,
  Signature,
  fetchLastBlock,
  UInt32,
} from 'o1js';
import { proof } from './proof';
import { oracleAggregator } from './oracle-aggregator';
import config from '../config';
import { eventProcessor } from './event-processor';

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
      console.log('Orchestrator already running');
      return;
    }

    this.isWatching = true;
    console.log('Beginning to watch for new blocks');

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
    console.log('Orchestrator stopped');
  }

  /**
   * Schedules the next block check based on the configured interval.
   */
  private scheduleNextCheck() {
    if (!this.isWatching) return;

    this.watchTimeout = setTimeout(
      async () => {
        try {
          console.log('🔍 Checking for new block');
          await this.checkNewBlock();
        } catch (error) {
          console.error('Error checking new block:', error);
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
      console.log('Still processing previous block, skipping check');
      return;
    }

    try {
      this.isProcessing = true;
      const latestBlock = await fetchLastBlock();
      const blockHeight = latestBlock.blockchainLength;

      if (blockHeight.toBigint() > this.currentBlockHeight.toBigint()) {
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
      console.log(
        '🔍 New block processing started ═══════════════════════════'
      );
      console.log(`📦 Block Height: ${blockHeight.toString()}`);

      console.log('\n📡 Collecting oracle submissions...');
      const submissions =
        await oracleAggregator.collectSubmissions(blockHeight);
      console.log(`✅ Collected oracle submissions`);

      console.log('\n🔐 Generating proof...');
      console.time('⏱️ Proof generation duration');

      // Generate proof with the collected submissions
      await proof.generateProof({
        blockHeight: blockHeight,
        oraclePriceSubmissions: submissions,
      });

      console.timeEnd('⏱️ Proof generation duration');
      console.log('✅ Proof generation successful');

      // Process events
      console.log('\n📋 Processing on-chain events...');
      const events = await eventProcessor.processEvents(blockHeight);
      if (events && events.length > 0) {
        console.log('\n📜 Updated the vaults from the following events:');
        events.forEach((event, index) => {
          console.log(`   ${index + 1}. Type: ${event.type}`);
          console.log(
            `      Data: ${JSON.stringify(event.event.data, null, 2)}`
          );
        });
      } else {
        console.log('   🚫 No vaults updated from this block');
      }

      console.log(
        '\n✨ Block processing completed successfully ═══════════════'
      );
    } catch (error) {
      console.error(`❌ Error processing block ${blockHeight}:`);
      console.error(error);
    }
  }
}

export const orchestrator = new Orchestrator();
