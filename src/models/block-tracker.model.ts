import mongoose, { Schema, Document, Model } from 'mongoose';
import { IBlockTrackerDocument } from '../types/block-tracker.js';

/**
 * Mongoose model for tracking block processing progress.
 * Maintains a single document that tracks:
 * - Last processed block
 * - Processing timestamps
 * - Error states
 * - Initial starting block
 */
const BlockTrackerSchema = new Schema<IBlockTrackerDocument>(
  {
    // Height of the last successfully processed block
    lastProcessedBlock: {
      type: Number,
      required: true,
    },
    // Timestamp of the last successful processing
    lastProcessedAt: {
      type: Date,
      required: true,
    },
    // Details of the last encountered error, if any
    lastError: {
      type: String,
    },
    // Initial block height where processing began
    startBlock: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'block_tracker',
  }
);

/**
 * Extended model interface with custom static methods
 */
interface IBlockTrackerModel extends Model<IBlockTrackerDocument> {
  getOrCreate(startBlock?: number): Promise<IBlockTrackerDocument>;
}

/**
 * Ensures a single block tracker document exists.
 * Creates one with default values if none exists.
 */
BlockTrackerSchema.statics.getOrCreate = async function (
  startBlock: number = 0
) {
  let tracker = await this.findOne();

  if (!tracker) {
    tracker = await this.create({
      lastProcessedBlock: startBlock,
      startBlock,
      lastProcessedAt: new Date(),
    });
  }

  return tracker;
};

export const BlockTrackerModel = mongoose.model<
  IBlockTrackerDocument,
  IBlockTrackerModel
>('BlockTracker', BlockTrackerSchema);
