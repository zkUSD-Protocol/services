import { initializeBindings } from 'o1js';
import { blockchain, initBlockchain } from 'zkcloudworker';
import { proof } from './services/proof';
import { orchestrator } from './services/orchestrator';
import { eventProcessor } from './services/event-processor';
import config from './config';
import mongoose from 'mongoose';

/**
 * Main entry point for the zkUSD services.
 * Initializes all required components:
 * - Blockchain connection
 * - MongoDB database
 * - Event processor
 * - Proof generation system
 * - Service orchestrator
 */

/**
 * Initializes cryptographic and blockchain components.
 * @throws Error if initialization fails
 */
async function initBlockchainComponents() {
  try {
    await initializeBindings();
    await initBlockchain(config.network as blockchain);
  } catch (error) {
    throw new Error(`Failed to initialize blockchain components: ${error}`);
  }
}

/**
 * Initializes MongoDB connection with retry logic.
 * @throws Error if connection fails after retries
 */
async function initDatabase(retries = 3, delay = 5000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(config.mongodb.uri, config.mongodb.options);
      console.log('Connected to MongoDB');
      return;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(
          `Database connection failed after ${retries} attempts: ${error}`
        );
      }
      console.warn(
        `Database connection attempt ${attempt} failed, retrying in ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Initializes core services in sequence.
 * @throws Error if any service fails to initialize
 */
async function initCoreServices() {
  try {
    await eventProcessor.init();
    await proof.init();
    await orchestrator.start();
  } catch (error) {
    throw new Error(`Failed to initialize core services: ${error}`);
  }
}

/**
 * Gracefully shuts down services and connections.
 */
async function shutdown() {
  console.log('\nShutting down services...');
  try {
    orchestrator.stop();
    await mongoose.connection.close();
    console.log('Services shut down successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * Main initialization function that coordinates all service startups.
 * Handles startup errors gracefully and ensures proper shutdown.
 */
async function initServices() {
  try {
    console.log('Initializing proof generation system...');

    await initBlockchainComponents();
    await initDatabase();
    await initCoreServices();

    console.log('Proof generation system initialized and running');
  } catch (error) {
    console.error('Critical initialization error:', error);
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
