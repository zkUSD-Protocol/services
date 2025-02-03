import { Schema, model } from 'mongoose';
import { IProof, IProofDocument, IProofSchema } from '../types/proof';
import { UInt32, UInt64 } from 'o1js';

/**
 * Mongoose model for storing oracle price proofs.
 * Maintains a record of:
 * - Generated zk price proof
 * - Associated block heights
 * - Resulting price calculations
 */
const ProofSchema = new Schema<IProofDocument>(
  {
    // Block height for which the proof was generated
    blockHeight: {
      type: Number,
      required: true,
      index: true, // Index for faster queries
    },
    // When the proof was generated
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // The zero-knowledge proof data
    proof: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // The calculated price from oracle submissions
    price: {
      type: Schema.Types.Decimal128,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'oracle_price_proofs',
  }
);

export const ProofModel = model<IProofDocument>('Proof', ProofSchema);
