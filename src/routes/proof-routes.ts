import { Router } from 'express';
import { validateRequest } from '../middleware/validate';
import * as ProofController from '../controller/proof-controller';

const router = Router();

// Get latest proof
router.get('/latest', ProofController.getLatestProof);

// Get proof by id
router.get('/:id', validateRequest.proofId, ProofController.getProofById);

export default router;
