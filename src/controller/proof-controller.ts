import { Request, Response, NextFunction } from 'express';
import { proof } from '../services/proof';
import { GenerateProofRequest } from '../types';
import { database } from '../services/database';

export const getLatestProof = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const latestProof = await database.getLatestProof();

    console.log('Providing Latest proof', latestProof);

    if (!latestProof) {
      return res.status(404).json({
        status: 'error',
        code: 'NO_PROOF_FOUND',
        message: 'No proofs generated yet',
      });
    }

    res.json({
      status: 'success',
      data: latestProof,
    });
  } catch (error) {
    next(error);
  }
};

export const getProofById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const proofById = await database.getProofById(req.params.id);

    if (!proofById) {
      return res.status(404).json({
        status: 'error',
        code: 'PROOF_NOT_FOUND',
        message: `Proof with id ${req.params.id} not found`,
      });
    }

    res.json({
      status: 'success',
      data: proof,
    });
  } catch (error) {
    next(error);
  }
};
