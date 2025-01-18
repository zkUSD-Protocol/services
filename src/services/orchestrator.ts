import {
  Mina,
  PublicKey,
  UInt64,
  Signature,
  fetchLastBlock,
  UInt32,
} from 'o1js';
import { proof } from './proof';
import { getNetworkKeys } from 'zkusd';
import { oracleAggregator } from './oracle-aggregator';
import { blockchain } from 'zkcloudworker';
import config from '../config';

class OrchestratorService {
  private currentBlockHeight: UInt32 = UInt32.from(0);
  private isWatching: boolean = false;
  private watchTimeout: NodeJS.Timeout | null = null;
  private networkKeys;
  private isProcessing: boolean = false;

  constructor() {
    // Initialize network keys (oracles)
    this.networkKeys = getNetworkKeys(config.network as blockchain);
  }

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

  stop() {
    if (this.watchTimeout) {
      clearTimeout(this.watchTimeout);
      this.watchTimeout = null;
    }
    this.isWatching = false;
    console.log('Orchestrator stopped');
  }

  private scheduleNextCheck() {
    if (!this.isWatching) return;

    this.watchTimeout = setTimeout(
      async () => {
        try {
          await this.checkNewBlock();
        } catch (error) {
          console.error('Error checking new block:', error);
        } finally {
          // Schedule next check only after current one is complete
          this.scheduleNextCheck();
        }
      },
      Number(config.blockCheckInterval) * 1000
    );
  }

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

      if (blockHeight > this.currentBlockHeight) {
        console.log(`New block detected: ${blockHeight}`);
        await this.handleNewBlock(blockHeight);
        this.currentBlockHeight = blockHeight;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleNewBlock(blockHeight: UInt32) {
    try {
      console.log('Collecting oracle submissions');

      const submissions =
        await oracleAggregator.collectSubmissions(blockHeight);

      console.log('Generating proof for block', blockHeight.toString());
      console.time('Proof generation');
      // Generate proof with the collected submissions
      await proof.generateProof({
        blockHeight: blockHeight,
        oraclePriceSubmissions: submissions,
      });
      console.timeEnd('Proof generation');

      console.log(
        `Proof generation completed for block ${blockHeight.toString()}`
      );
    } catch (error) {
      console.error(`Error handling block ${blockHeight}:`, error);
    }
  }
}

export const orchestrator = new OrchestratorService();
