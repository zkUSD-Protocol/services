import { fetchLastBlock, UInt32 } from 'o1js';
import { proof } from './proof.js';
import { oracleAggregator } from './oracle-aggregator.js';
import config from '../config/index.js';
import { eventProcessor } from './event-processor.js';
import { logger } from '../utils/logger.js';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  private blockWorker: import('child_process').ChildProcess | null = null;

  // Update setter name
  setBlockWorker(worker: import('child_process').ChildProcess) {
    this.blockWorker = worker;
  }

  // Add getter for block worker
  getBlockWorker(): import('child_process').ChildProcess | null {
    return this.blockWorker;
  }

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
    logger.info('👀 Beginning to watch for new blocks');

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
        if (this.currentBlockHeight.toBigint() === BigInt(0)) {
          logger.info(`📦 Processing block ${blockHeight.toBigint()}`);
        } else {
          logger.info(
            `📦 Processing from block ${this.currentBlockHeight.toBigint()} to ${blockHeight.toBigint()}`
          );
        }
        await this.handleNewBlock(blockHeight);
        this.currentBlockHeight = blockHeight;
      }
    } catch (error) {
      logger.error('Error checking new block:', error);
      if (
        error instanceof Error &&
        error.message.includes('Block processing timeout')
      ) {
        logger.error('Block processing timed out - exiting process');
        this.blockWorker?.kill();
        setTimeout(() => {
          logger.info('Exiting process');
          process.exit(1);
        }, 3000);
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
      if (!this.blockWorker) {
        throw new Error('Block worker not initialized');
      }

      // Promise for worker completion
      const blockProcessingPromise = new Promise((resolve, reject) => {
        this.blockWorker!.once('message', (message: any) => {
          if (message.type === 'success') {
            resolve(message.events);
          } else if (message.type === 'error') {
            reject(new Error(message.error));
          }
        });

        this.blockWorker!.once('error', (error) => reject(error));
        this.blockWorker!.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
        });
      });

      // Start the worker
      this.blockWorker.send({
        type: 'processBlock',
        data: { blockHeight },
      });

      // Add timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Block processing timeout')), 60000)
      );

      // Wait for either the processing or a timeout
      const events = await Promise.race([
        blockProcessingPromise,
        timeoutPromise,
      ]);

      logger.info('\n✨ Block processing completed successfully');
      return events;
    } catch (error) {
      logger.error(`❌ Error processing block ${blockHeight}:`);
      logger.error(error as string);
      throw error;
    }
  }
}

export const orchestrator = new Orchestrator();
