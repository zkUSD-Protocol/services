import { Router } from 'express';
import proofRoutes from './proof-routes';

const router = Router();

router.use('/proofs', proofRoutes);

// Health check endpoint
router.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

export default router;
