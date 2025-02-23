import { initializeBindings } from 'o1js';
import { MinaNetworkInterface, blockchain } from '@zkusd/core';
import { proof } from './services/proof.js';
import { orchestrator } from './services/orchestrator.js';
import { eventProcessor } from './services/event-processor.js';
import config from './config/index.js';
import mongoose from 'mongoose';
import { fork } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Initializes the block worker process.
 * @throws Error if worker initialization fails
 */
async function initBlockWorker(): Promise<
  import('child_process').ChildProcess
> {
  return new Promise((resolve, reject) => {
    const worker = fork(join(__dirname, 'services', 'block-worker.js'));

    // Wait for initialization message
    worker.once('message', (message: any) => {
      if (message.type === 'initialized') {
        resolve(worker);
      } else if (message.type === 'error') {
        reject(new Error(message.error));
      }
    });

    worker.once('error', (error) => reject(error));
    worker.once('exit', (code) => {
      if (code !== 0)
        reject(new Error(`Worker failed to initialize, exit code: ${code}`));
    });
  });
}

/**
 * Gracefully shuts down services and connections.
 */
async function shutdown() {
  logger.info('\n🛑 Initiating system shutdown...');
  try {
    orchestrator.stop();
    if (orchestrator.getBlockWorker()) {
      logger.info('👷 Stopping block worker');
      orchestrator.getBlockWorker()!.send({ type: 'shutdown' });
      // Wait for worker to exit
      await new Promise<void>((resolve) => {
        orchestrator.getBlockWorker()!.once('exit', () => resolve());
      });
    }
    logger.info('✅ System shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * Main initialization function that coordinates all service startups.
 * Handles startup errors gracefully and ensures proper shutdown.
 */
async function initServices() {
  try {
    logger.info('\n🚀 Initializing block processing system...');

    logger.info('⛓️  Initializing blockchain components');
    await initializeBindings();
    await MinaNetworkInterface.initChain(config.network as blockchain);

    logger.info('👷 Initializing block worker');
    const blockWorker = await initBlockWorker();
    orchestrator.setBlockWorker(blockWorker);

    logger.info('🔄 Starting orchestrator');
    await orchestrator.start();

    logger.info('✅ System initialization complete\n');
  } catch (error) {
    logger.error('❌ Critical initialization error:', error);
    await shutdown();
  }
}

// Handle process termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await shutdown();
});

process.on('unhandledRejection', async (error) => {
  console.error('Unhandled rejection:', error);
  await shutdown();
});

// Start the services
initServices();
