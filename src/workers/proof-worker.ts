import { initializeBindings } from 'o1js';
import { blockchain, initBlockchain } from 'zkcloudworker';
import { database } from '../services/database';
import { proof } from '../services/proof';
import { orchestrator } from '../services/orchestrator';
import config from '../config';

async function startProofGeneration() {
  try {
    console.log('Initializing proof generation system...');
    await initializeBindings();
    await initBlockchain(config.network as blockchain);
    await database.init();
    await database.clearProofs();
    await proof.init();
    await orchestrator.start();
    console.log('Proof generation system initialized and running');
  } catch (error) {
    console.error('Failed to initialize proof generation system:', error);
    process.exit(1);
  }
}

startProofGeneration();
