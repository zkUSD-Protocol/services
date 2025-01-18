import { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';

const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      errors: errors.array(),
    });
  }
  next();
};

export const validateRequest = {
  proofId: [
    param('id').isUUID().withMessage('Valid proof ID is required'),
    handleValidationErrors,
  ],

  generateDummyProof: [
    body('blockHeight')
      .isInt({ min: 0 })
      .withMessage('Valid block height is required'),
    body('price')
      .isString()
      .matches(/^\d+$/)
      .withMessage('Valid price is required'),
    handleValidationErrors,
  ],
};
