import { OraclePriceSubmissions } from 'zkusd';
import { PublicKey, UInt32, UInt64 } from 'o1js';

export interface StoredProof {
  id: string;
  blockHeight: UInt32;
  timestamp: Date;
  proof: object;
  price: UInt64;
}

export interface GenerateProofRequest {
  blockHeight: UInt32;
  oraclePriceSubmissions: OraclePriceSubmissions;
}
