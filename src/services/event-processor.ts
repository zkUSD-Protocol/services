import { PublicKey, UInt32 } from 'o1js';
import { BlockTrackerModel, EventModel, VaultModel } from '../models/index.js';
import { oracleAggregationVk, ZkUsdEngineContract } from '@zkusd/core';
import config from '../config/index.js';
import { IEvent, VaultEventTypes } from '../types/event.js';
import { logger } from '../utils/logger.js';

/**
 * EventProcessor handles the processing of on-chain events from the zkUSD engine.
 * It maintains the state of vaults and other system components by tracking and
 * processing relevant events.
 */
class EventProcessor {
  // Instance of the zkUSD engine contract
  private engine: InstanceType<ReturnType<typeof ZkUsdEngineContract>>;

  /**
   * Initializes the processor with the deployed zkUSD engine contract.
   */
  constructor() {
    const ZkUsdEngine = ZkUsdEngineContract({
      zkUsdTokenAddress: config.tokenPublicKey,
      minaPriceInputZkProgramVkHash: oracleAggregationVk.hash,
    });

    this.engine = new ZkUsdEngine(config.enginePublicKey);
  }

  /**
   * Initializes the block tracking state.
   * Creates initial block tracker if none exists.
   */
  async init(startBlock: number = 0) {
    await BlockTrackerModel.getOrCreate(startBlock);
  }

  /**
   * Determines if an event type is related to vault operations.
   */
  private isVaultEvent(type: string): boolean {
    return Object.values(VaultEventTypes).includes(type as any);
  }

  /**
   * Processes events from a range of blocks:
   * 1. Fetches events from the engine contract
   * 2. Filters out already processed events
   * 3. Updates vault states based on events
   * 4. Maintains block processing state
   */
  async processEvents(blockHeight: UInt32) {
    const block = await BlockTrackerModel.findOne({});

    if (!block) throw new Error('No block found');

    let fromBlock = block.lastProcessedBlock;
    if (fromBlock === 0) fromBlock = block.startBlock;

    logger.info(
      `   📍 Processing events from block ${fromBlock} to ${blockHeight}`
    );

    try {
      const events = await this.engine.fetchEvents(UInt32.from(fromBlock));
      logger.info(`   📥 Found ${events.length} events to process`);

      const eventsUpdated = [];

      for (const event of events) {
        try {
          const existingEvent = await EventModel.findOne({
            'event.transactionInfo.transactionHash':
              event.event.transactionInfo.transactionHash,
            chainStatus: event.chainStatus,
          });

          if (existingEvent) {
            logger.info('   🔄 Skipping event', event.type);
            continue;
          }

          // Store the event first
          await EventModel.storeFromEvent(event as unknown as IEvent);

          // Process the event based on type
          if (this.isVaultEvent(event.type)) {
            const vaultUpdated = await VaultModel.updateFromEvent(
              event as unknown as IEvent
            );
            if (vaultUpdated) {
              eventsUpdated.push(event);
            }
          }
        } catch (error) {
          console.error(`   ❌ Error processing event ${event.type}:`, error);
          throw error;
        }
      }

      // Update block tracker
      await BlockTrackerModel.findOneAndUpdate(
        {},
        {
          lastProcessedBlock: Number(blockHeight),
          lastProcessedAt: new Date(),
        }
      );

      return eventsUpdated; // Return events for logging
    } catch (error) {
      console.error('   ❌ Error fetching or processing events:', error);
      throw error;
    }
  }
}

export const eventProcessor = new EventProcessor();
