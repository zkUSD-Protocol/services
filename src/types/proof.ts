import { Document, Schema, Types } from 'mongoose';
import { JsonProof, UInt32, UInt64 } from 'o1js';
import { OraclePriceSubmissions } from 'zkusd';

export interface IProof {
  blockHeight: UInt32;
  timestamp: Date;
  proof: JsonProof;
  price: UInt64;
}

export interface IProofSchema {
  blockHeight: number;
  timestamp: Date;
  proof: Schema.Types.Mixed;
  price: Schema.Types.Decimal128;
}

export interface IGenerateProofRequest {
  blockHeight: UInt32;
  oraclePriceSubmissions: OraclePriceSubmissions;
}

export interface IProofDocument extends IProofSchema, Document {}
