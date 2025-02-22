import mongoose, { Schema } from 'mongoose';
import { IEvent, IEventDocument, IEventSchema } from '../types/event.js';
import { PublicKey, UInt64, UInt32, Field, Bool } from 'o1js';

/**
 * Mongoose model for storing on-chain events.
 * Tracks all relevant events from the zkUSD system including:
 * - Vault operations
 * - System configuration changes
 * - Administrative actions
 */

/**
 * Converts o1js types to MongoDB-compatible formats.
 * Handles special types:
 * - Field
 * - PublicKey
 * - UInt64
 * - UInt32
 * - Bool
 */
function convertO1jsValue(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Field
  if (value instanceof Field) {
    return value.toString();
  }

  // Handle PublicKey
  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  // Handle UInt64
  if (value instanceof UInt64) {
    return new mongoose.Types.Decimal128(value.toString());
  }

  // Handle UInt32
  if (value instanceof UInt32) {
    return Number(value.toString());
  }

  // Handle Bool
  if (value instanceof Bool) {
    return value.toBoolean();
  }

  // Handle nested objects
  if (typeof value === 'object') {
    return convertO1jsObject(value);
  }

  return value;
}

/**
 * Recursively converts o1js objects to MongoDB-compatible formats.
 * Handles nested objects and arrays.
 */
function convertO1jsObject(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertO1jsValue(item));
  }

  const converted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    converted[key] = convertO1jsValue(value);
  }
  return converted;
}

/**
 * Schema definition for blockchain events.
 * Includes comprehensive indexing for efficient querying.
 */
const EventSchema = new Schema<IEventDocument>(
  {
    // Block height where event occurred
    blockHeight: {
      type: Number,
      required: true,
      index: true,
    },
    // Hash of the block containing the event
    blockHash: {
      type: String,
      required: true,
    },
    // Hash of the parent block
    parentBlockHash: {
      type: String,
      required: true,
    },
    // Global slot number for the event
    globalSlot: {
      type: Number,
      required: true,
    },
    // Current chain status (pending/included)
    chainStatus: {
      type: String,
      required: true,
      index: true,
    },
    // Type of event (vault operations, admin actions, etc)
    type: {
      type: String,
      required: true,
      index: true,
      enum: [
        'VaultOwnerUpdated',
        'NewVault',
        'DepositCollateral',
        'RedeemCollateral',
        'MintZkUsd',
        'BurnZkUsd',
        'Liquidate',
        'AdminUpdated',
        'EmergencyStopToggled',
        'ValidPriceBlockCountUpdated',
        'OracleWhitelistUpdated',
      ],
    },
    // Event-specific data and transaction information
    event: {
      data: {
        type: Schema.Types.Mixed,
      },
      transactionInfo: {
        transactionHash: {
          type: String,
          required: true,
          index: true,
        },
        transactionStatus: {
          type: String,
          required: true,
        },
        transactionMemo: {
          type: String,
        },
      },
    },
  },
  {
    timestamps: true,
    collection: 'events',
  }
);

/**
 * The model for the event model
 */
interface EventModel extends mongoose.Model<IEventDocument> {
  storeFromEvent(event: IEvent): Promise<IEventDocument>;
}

/**
 * Indexes for the event model
 */
EventSchema.index({ type: 1, blockHeight: 1 });
EventSchema.index({ 'event.data.vaultAddress': 1, blockHeight: 1 });
EventSchema.index({ chainStatus: 1, blockHeight: 1 });
EventSchema.index(
  { 'event.transactionInfo.transactionHash': 1, chainStatus: 1 },
  { unique: true }
);

/**
 * Stores an event in the database
 */
EventSchema.statics.storeFromEvent = async function (
  event: IEvent
): Promise<IEventDocument> {
  const eventData: IEventSchema = {
    blockHeight: Number(event.blockHeight),
    blockHash: event.blockHash,
    parentBlockHash: event.parentBlockHash,
    globalSlot: Number(event.globalSlot),
    chainStatus: event.chainStatus,
    type: event.type,
    event: {
      data: convertO1jsObject(event.event.data),
      transactionInfo: event.event.transactionInfo,
    },
  };

  return await this.findOneAndUpdate(
    {
      'event.transactionInfo.transactionHash':
        event.event.transactionInfo.transactionHash,
      chainStatus: event.chainStatus,
    },
    eventData,
    {
      upsert: true,
      new: true,
    }
  );
};

export const EventModel = mongoose.model<IEventDocument, EventModel>(
  'Event',
  EventSchema
);
