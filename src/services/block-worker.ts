// proof-worker.ts
import { UInt32 } from 'o1js';
import { proof } from './proof.js';
import { oracleAggregator } from './oracle-aggregator.js';
import { eventProcessor } from './event-processor.js';
import { logger } from '../utils/logger.js';
import { initializeBindings } from 'o1js';
import { blockchain, MinaNetworkInterface } from '@zkusd/core';
import config from '../config/index.js';
import mongoose from 'mongoose';

interface BlockProcessingMessage {
  type: 'processBlock' | 'shutdown';
  data?: {
    blockHeight: UInt32;
  };
}

type WorkerMessage = BlockProcessingMessage;

/**
 * Initializes MongoDB connection with retry logic.
 * @throws Error if connection fails after retries
 */
async function initDatabase(retries = 3, delay = 5000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(config.mongodb.uri, config.mongodb.options);
      logger.info('🗄️  Database connection established');
      return;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(
          `Database connection failed after ${retries} attempts: ${error}`
        );
      }
      logger.warn(
        `⚠️  Database connection attempt ${attempt} failed, retrying in ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Initializes the block worker.
 * @throws Error if initialization fails
 */
async function initializeWorker() {
  try {
    logger.info('🚀 Initializing block worker...');

    logger.info('⛓️  Initializing blockchain components');
    await initializeBindings();
    await MinaNetworkInterface.initChain(config.network as blockchain);

    logger.info('🗄️  Initializing database connection');
    await initDatabase();

    logger.info('📋 Initializing event processor');
    await eventProcessor.init();

    logger.info('⚡ Compiling zkProgram');
    await proof.init();

    logger.info('✅ Block worker initialization complete\n');
  } catch (error) {
    logger.error('❌ Worker initialization failed:', error);
    process.send!({ type: 'error', error: String(error) });
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('\n🛑 Initiating worker shutdown...');
  try {
    await mongoose.connection.close();
    logger.info('🗄️  Database connection closed');
    logger.info('✅ Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during worker shutdown:', error);
    process.exit(1);
  }
}

async function handleBlock(blockHeight: UInt32) {
  try {
    logger.info('\═════════════════════════════════');
    logger.info(`🔍 Processing block ${blockHeight.toString()}`);
    logger.info('═════════════════════════════════\n');

    logger.info('📡 Collecting oracle submissions...');
    const submissions = await oracleAggregator.collectSubmissions(blockHeight);
    logger.info('✅ Oracle submissions collected successfully');

    logger.info('\n🔐 Generating proof...');
    console.time('⏱️  Proof generation duration');
    await proof.generateProof({
      blockHeight,
      oraclePriceSubmissions: submissions,
    });
    console.timeEnd('⏱️  Proof generation duration');
    logger.info('✅ Proof generation successful');

    logger.info('\n📋 Processing on-chain events...');
    const events = await eventProcessor.processEvents(blockHeight);

    if (events && events.length > 0) {
      logger.info('\n📜 Vault updates:');
      events.forEach((event, index) => {
        logger.info(`   ${index + 1}. 📎 Type: ${event.type}`);
        logger.info(
          `      📄 Data: ${JSON.stringify(event.event.data, null, 2)}`
        );
      });
    } else {
      logger.info('\n📭 No vault updates required');
    }

    logger.info('\n✨ Block processing completed successfully');
    logger.info('═══════════════════════════════════════════════════\n');
    return events;
  } catch (error) {
    logger.error('\n❌ Block processing failed:', error);
    throw error;
  }
}

// Initialize the worker
initializeWorker()
  .then(() => {
    process.send!({ type: 'initialized' });

    // Handle messages from the main process
    process.on('message', async (message: WorkerMessage) => {
      if (message.type === 'processBlock') {
        try {
          const blockHeight = UInt32.from(message.data!.blockHeight);
          const events = await handleBlock(blockHeight);
          process.send!({ type: 'success', events });
        } catch (error) {
          process.send!({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (message.type === 'shutdown') {
        await shutdown();
      }
    });

    // Handle process termination signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })
  .catch((error) => {
    process.send!({ type: 'error', error: String(error) });
    process.exit(1);
  });
