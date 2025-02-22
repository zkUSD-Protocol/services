import mongoose, { Schema, Document } from 'mongoose';
import { PublicKey, UInt32, UInt64 } from 'o1js';
import {
  VaultOwnerUpdatedEvent,
  NewVaultEvent,
  DepositCollateralEvent,
  RedeemCollateralEvent,
  MintZkUsdEvent,
  BurnZkUsdEvent,
  LiquidateEvent,
} from '@zkusd/core';

//

interface IEventBase {
  blockHeight: UInt32;
  blockHash: string;
  parentBlockHash: string;
  globalSlot: UInt32;
  chainStatus: string;
  type: string;
}

type EventData =
  | VaultOwnerUpdatedEvent
  | NewVaultEvent
  | DepositCollateralEvent
  | RedeemCollateralEvent
  | MintZkUsdEvent
  | BurnZkUsdEvent
  | LiquidateEvent;

//Combined interface for the document
interface IEvent extends IEventBase {
  event: {
    data: EventData;
    transactionInfo: {
      transactionHash: string;
      transactionStatus: string;
      transactionMemo: string;
    };
  };
}

export enum VaultEventTypes {
  NEW_VAULT = 'NewVault',
  VAULT_OWNER_UPDATED = 'VaultOwnerUpdated',
  DEPOSIT_COLLATERAL = 'DepositCollateral',
  REDEEM_COLLATERAL = 'RedeemCollateral',
  MINT_ZKUSD = 'MintZkUsd',
  BURN_ZKUSD = 'BurnZkUsd',
  LIQUIDATE = 'Liquidate',
}

export enum ProtocolEventTypes {
  EMERGENCY_STOP_TOGGLED = 'EmergencyStopToggled',
  VALID_PRICE_BLOCK_COUNT_UPDATED = 'ValidPriceBlockCountUpdated',
  ADMIN_UPDATED = 'AdminUpdated',
  ORACLE_WHITELIST_UPDATED = 'OracleWhitelistUpdated',
}

// Schema interface for MongoDB
export interface IEventSchema {
  blockHeight: number;
  blockHash: string;
  parentBlockHash: string;
  globalSlot: number;
  chainStatus: string;
  type: string;
  event: {
    data: Schema.Types.Mixed;
    transactionInfo: {
      transactionHash: string;
      transactionStatus: string;
      transactionMemo?: string;
    };
  };
}

interface IEventDocument extends Document, IEventSchema {}

export type { EventData, IEvent, IEventDocument };
