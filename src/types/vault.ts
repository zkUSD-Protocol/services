import mongoose, { Decimal128, Document, Schema } from 'mongoose';
import { PublicKey, UInt64 } from 'o1js';

// Raw vault data
export interface IVault {
  address: PublicKey;
  owner: PublicKey;
  collateralAmount: UInt64;
  debtAmount: UInt64;
  lastUpdateBlock: number;
  lastUpdateTimestamp: Date;
}

// Schema interface for MongoDB
export interface IVaultSchema {
  address: string;
  owner: string;
  collateralAmount: mongoose.Types.Decimal128;
  debtAmount: mongoose.Types.Decimal128;
  lastUpdateBlock: number;
  lastUpdateTimestamp: Date;
  latestTransactionHash: string;
}

// Document interface for MongoDB
export interface IVaultDocument extends Document, IVaultSchema {}
